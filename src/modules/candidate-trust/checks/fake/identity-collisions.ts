import {
  COPIED_LINES_HIGH, COPIED_LINES_MEDIUM, MAX_CONTENT_LINE_SPREAD, VENDOR_CONTACT_MIN_PEOPLE,
} from '../../constants.js';
import { identityKeys, type IdentityIndex } from '../../engine/identity-index.js';
import { compareNames, sha16 } from '../../utils/normalize.js';
import type { TrustCandidate, TrustSeverity, TrustSignal, TrustSignalType } from '../../types.js';

const CONTACT_LABEL = { email: 'email address', phone: 'phone number', linkedin: 'LinkedIn profile', github: 'GitHub account' } as const;
type ContactKind = keyof typeof CONTACT_LABEL;
const MAX_LISTED = 50;

function ref(c: TrustCandidate): { id: string; name: string } {
  return { id: c.id, name: c.name };
}

/** True when two records most likely belong to the same person (a resume version / duplicate record). */
export function sameIdentity(a: TrustCandidate, b: TrustCandidate): boolean {
  const names = compareNames(a.name, b.name);
  if (names === 'same') return true;
  if (names === 'different') return false;
  // Names unusable: fall back to shared contact details.
  const ka = identityKeys(a);
  const kb = identityKeys(b);
  return (!!ka.email && ka.email === kb.email) || (!!ka.phone && ka.phone === kb.phone)
    || (!!ka.linkedin && ka.linkedin === kb.linkedin);
}

function sharedContactKinds(a: ReturnType<typeof identityKeys>, b: ReturnType<typeof identityKeys>): number {
  return (['email', 'phone', 'linkedin', 'github'] as const).filter(k => a[k] && a[k] === b[k]).length;
}

/** Groups records into distinct people by name, so "John Smith" twice counts once. */
function countDistinctPeople(people: TrustCandidate[]): number {
  const reps: TrustCandidate[] = [];
  for (const p of people) {
    if (!reps.some(r => compareNames(r.name, p.name) === 'same')) reps.push(p);
  }
  return reps.length;
}

export function identityCollisionChecks(c: TrustCandidate, index: IdentityIndex): TrustSignal[] {
  const signals: TrustSignal[] = [];
  const duplicates = new Map<string, TrustCandidate>();
  const keys = identityKeys(c);

  // 1. Shared contact details / profiles.
  for (const kind of ['email', 'phone', 'linkedin', 'github'] as ContactKind[]) {
    const value = keys[kind];
    if (!value) continue;
    const others = index.lookup(c.organizationId, kind, value, c.id);
    if (!others.length) continue;

    const different: TrustCandidate[] = [];
    const unknown: TrustCandidate[] = [];
    for (const o of others) {
      const m = compareNames(c.name, o.name);
      if (m === 'same') duplicates.set(o.id, o);
      else if (m === 'different') different.push(o);
      // Names unusable but two or more contact details match: same person.
      else if (sharedContactKinds(keys, identityKeys(o)) >= 2) duplicates.set(o.id, o);
      else unknown.push(o);
    }
    if (!different.length && !unknown.length) continue;

    const label = CONTACT_LABEL[kind];
    const people = countDistinctPeople([c, ...different, ...unknown]);
    const listed = [...different, ...unknown].slice(0, MAX_LISTED);
    const names = listed.slice(0, 5).map(o => o.name).join(', ');

    if ((kind === 'email' || kind === 'phone') && people >= VENDOR_CONTACT_MIN_PEOPLE) {
      signals.push({
        section: 'fake', signalType: 'shared_vendor_contact', severity: 'medium',
        fingerprint: `shared_vendor_contact:${kind}:${sha16(value)}`,
        title: `This ${label} is on ${people} different people's resumes`,
        explanation: `The same ${label} appears on resumes for ${people} different people (e.g. ${names}). It is probably an agency or vendor contact, so the candidate's own contact details are unknown. Get direct contact details before relying on this record.`,
        evidence: { kind, value, people, records: listed.map(ref) },
        relatedCandidateIds: listed.map(o => o.id),
      });
      continue;
    }

    const confirmedDifferent = different.length > 0;
    const severity: TrustSeverity = confirmedDifferent ? 'high' : 'low';
    signals.push({
      section: 'fake', signalType: `shared_${kind}` as TrustSignalType, severity,
      fingerprint: `shared_${kind}:${sha16(value)}`,
      title: confirmedDifferent ? `Same ${label} as a different person` : `Same ${label} as another record`,
      explanation: confirmedDifferent
        ? `This ${label} is also on the resume of ${names}, which is a different name. Confirm the candidate's identity before submitting.`
        : `This ${label} is also on ${listed.length} other record(s) (${names}) whose names could not be compared. Check whether they are the same person.`,
      evidence: { kind, value, records: listed.map(ref) },
      relatedCandidateIds: listed.map(o => o.id),
    });
  }

  // 2. Same resume file / same work history under another identity.
  const contentChecks: Array<{ kind: 'text' | 'work'; type: TrustSignalType; title: string; what: string }> = [
    { kind: 'text', type: 'duplicate_resume_file', title: 'Identical resume under another identity', what: 'exactly the same resume text' },
    { kind: 'work', type: 'duplicate_work_history', title: 'Same work history as another identity', what: 'the same employers with the same dates' },
  ];
  for (const chk of contentChecks) {
    const value = keys[chk.kind];
    if (!value) continue;
    const others = index.lookup(c.organizationId, chk.kind, value, c.id);
    const foreign: TrustCandidate[] = [];
    for (const o of others) {
      if (sameIdentity(c, o)) duplicates.set(o.id, o);
      else foreign.push(o);
    }
    if (!foreign.length) continue;
    const confirmed = foreign.some(o => compareNames(c.name, o.name) === 'different');
    const listed = foreign.slice(0, MAX_LISTED);
    signals.push({
      section: 'fake', signalType: chk.type, severity: confirmed ? 'high' : 'medium',
      fingerprint: `${chk.type}:${value}`,
      title: chk.title,
      explanation: `${listed.slice(0, 5).map(o => o.name).join(', ')} ${listed.length === 1 ? 'has' : 'have'} ${chk.what}, under a different name and contact details. The same resume being used by more than one person is a strong sign one of the profiles is not genuine.`,
      evidence: { records: listed.map(ref) },
      relatedCandidateIds: listed.map(o => o.id),
    });
  }

  // 3. Copied resume content (distinctive lines shared with another identity).
  const sharedCounts = new Map<string, number>();
  for (const h of c.contentHashes) {
    const spread = index.lineSpread(c.organizationId, h);
    if (spread < 2 || spread > MAX_CONTENT_LINE_SPREAD) continue;
    for (const o of index.lookup(c.organizationId, 'line', h, c.id)) {
      sharedCounts.set(o.id, (sharedCounts.get(o.id) ?? 0) + 1);
    }
  }
  const copiedFrom: Array<{ other: TrustCandidate; lines: number }> = [];
  for (const [id, lines] of sharedCounts) {
    if (lines < COPIED_LINES_MEDIUM) continue;
    const o = index.get(id);
    if (!o) continue;
    if (sameIdentity(c, o)) { duplicates.set(o.id, o); continue; }
    // Already reported as a full duplicate above.
    if (keys.text && keys.text === o.textHash) continue;
    copiedFrom.push({ other: o, lines });
  }
  if (copiedFrom.length) {
    copiedFrom.sort((a, b) => b.lines - a.lines);
    const top = copiedFrom[0];
    signals.push({
      section: 'fake', signalType: 'copied_resume_content',
      severity: top.lines >= COPIED_LINES_HIGH ? 'high' : 'medium',
      fingerprint: 'copied_resume_content',
      title: 'Resume text copied from another candidate',
      explanation: `${top.lines} distinctive lines in this resume also appear word-for-word in ${top.other.name}'s resume${copiedFrom.length > 1 ? ` (and ${copiedFrom.length - 1} other resume(s))` : ''}. Could be a shared template or a fabricated resume; ask about these projects in screening.`,
      evidence: { matches: copiedFrom.slice(0, MAX_LISTED).map(m => ({ ...ref(m.other), sharedLines: m.lines })) },
      relatedCandidateIds: copiedFrom.slice(0, MAX_LISTED).map(m => m.other.id),
    });
  }

  // 4. Same person stored more than once (not fraud; a cleanup item).
  if (duplicates.size) {
    const listed = [...duplicates.values()].slice(0, MAX_LISTED);
    signals.push({
      section: 'fake', signalType: 'duplicate_record', severity: 'info',
      fingerprint: 'duplicate_record',
      title: 'Possible duplicate record of the same person',
      explanation: `${listed.length} other record(s) look like the same person (matching name and contact details or resume). Likely an older resume version; compare them for changes between versions.`,
      evidence: { records: listed.map(ref) },
      relatedCandidateIds: listed.map(o => o.id),
    });
  }

  return signals;
}
