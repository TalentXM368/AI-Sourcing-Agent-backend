import { tokenSetRatio, normalizeCompanyName } from '../../../candidate-resolution/utils/string-similarity.js';
import {
  CONCURRENT_OK_TITLE, MIN_GAP_MONTHS, MIN_OVERLAP_MONTHS, MIN_OVERLAP_MONTHS_YEAR_PRECISION,
  MIN_QUALITY_FOR_TIMELINE, MIN_QUALITY_FOR_EXPERIENCE_CLAIM, CLAIM_EXCESS_RATIO, CLAIM_EXCESS_YEARS,
} from '../../constants.js';
import { formatMonth, nowMonth, parseResumeDate } from '../../utils/dates.js';
import type { TrustCandidate, TrustSignal } from '../../types.js';

export interface DatedRole {
  index: number;
  title: string;
  company: string;
  start: number;
  end: number;
  yearPrecision: boolean;
  isCurrent: boolean;
  rawFrom: string;
  rawTo: string;
}

export interface TimelineParse {
  dated: DatedRole[];
  undated: number;
  invalid: Array<{ index: number; title: string; company: string; from: string; to: string; reason: string }>;
}

export function parseTimeline(c: TrustCandidate, now: Date = new Date()): TimelineParse {
  const dated: DatedRole[] = [];
  const invalid: TimelineParse['invalid'] = [];
  let undated = 0;
  const current = nowMonth(now);

  c.workHistory.forEach((w, index) => {
    const from = parseResumeDate(w.from, now);
    const toRaw = w.to || (w.is_current ? 'Present' : '');
    const to = parseResumeDate(toRaw, now);
    const base = { index, title: w.title || '', company: w.company || '', from: w.from || '', to: toRaw };
    if (!from) { undated++; return; }
    // A start date without an end date is a parse gap, not evidence; skip it.
    if (!to) { undated++; return; }
    const end = to.precision === 'year' && !to.isPresent ? to.month + 11 : to.month;
    if (end < from.month) { invalid.push({ ...base, reason: 'end date is before start date' }); return; }
    if (from.month > current + 1) { invalid.push({ ...base, reason: 'start date is in the future' }); return; }
    if (from.month < 1960 * 12) { invalid.push({ ...base, reason: 'start date is before 1960' }); return; }
    dated.push({
      index, title: base.title, company: base.company, start: from.month, end: Math.min(end, current),
      yearPrecision: from.precision === 'year' || to.precision === 'year',
      isCurrent: to.isPresent, rawFrom: base.from, rawTo: toRaw,
    });
  });
  return { dated, undated, invalid };
}

function sameEmployer(a: DatedRole, b: DatedRole): boolean {
  const ca = normalizeCompanyName(a.company);
  const cb = normalizeCompanyName(b.company);
  if (!ca || !cb) return false;
  if (ca === cb || tokenSetRatio(ca, cb) >= 0.85) return true;
  // "Capgemini Technology Services" vs "Capgemini Technology Services as Team Lead".
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return shorter.length >= 4 && (longer.startsWith(`${shorter} `) || longer.includes(` ${shorter} `));
}

/** Education programs, courses and trainings parsed as jobs; holding them alongside a job is normal. */
const NOT_A_JOB = /\b(universit|college|institute|school|academy|program(me)?|course|certificat|training|bootcamp|education)/i;

function concurrentOk(r: DatedRole): boolean {
  return CONCURRENT_OK_TITLE.test(r.title) || NOT_A_JOB.test(r.title) || NOT_A_JOB.test(r.company);
}

function roleLabel(r: DatedRole): string {
  return `${r.title || 'Role'} at ${r.company || 'unknown company'} (${r.rawFrom} – ${r.rawTo})`;
}

/** Most distinct employers held at once (full-time-type roles, overlapping by more than the minimum). */
function maxConcurrentEmployers(dated: DatedRole[]): number {
  const eligible = dated.filter(r => !concurrentOk(r));
  let best = 1;
  for (const r of eligible) {
    const employers: DatedRole[] = [];
    for (const o of eligible) {
      const minimum = o.yearPrecision || r.yearPrecision ? MIN_OVERLAP_MONTHS_YEAR_PRECISION : MIN_OVERLAP_MONTHS;
      const active = o === r || (o.start <= r.start && o.end - r.start > minimum);
      if (active && !employers.some(e => sameEmployer(e, o))) employers.push(o);
    }
    best = Math.max(best, employers.length);
  }
  return best;
}

/** Union of role intervals in months. */
export function totalMonths(roles: DatedRole[]): number {
  const iv = roles.map(r => [r.start, r.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of iv) {
    if (!cur) { cur = [s, e]; continue; }
    if (s <= cur[1]) cur[1] = Math.max(cur[1], e);
    else { total += cur[1] - cur[0]; cur = [s, e]; }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

export function timelineChecks(c: TrustCandidate, now: Date = new Date()): TrustSignal[] {
  const signals: TrustSignal[] = [];
  if ((c.dataQualityScore ?? 0) < MIN_QUALITY_FOR_TIMELINE) return signals;
  const { dated, undated, invalid } = parseTimeline(c, now);

  // Invalid dates: usually a typo or a parse issue; worth a look, never a red flag.
  for (const inv of invalid) {
    signals.push({
      section: 'resume', signalType: 'invalid_role_dates', severity: 'info',
      fingerprint: `invalid_role_dates:${inv.index}:${inv.from}|${inv.to}`,
      title: 'Role dates do not make sense',
      explanation: `${inv.title || 'A role'} at ${inv.company || 'unknown company'} (${inv.from} – ${inv.to}): ${inv.reason}. May be a resume typo or a parsing error.`,
      evidence: inv, relatedCandidateIds: [],
    });
  }

  if (undated > 0 && c.workHistory.length > 0) {
    signals.push({
      section: 'resume', signalType: 'missing_role_dates', severity: 'info',
      fingerprint: 'missing_role_dates',
      title: 'Roles without dates',
      explanation: `${undated} of ${c.workHistory.length} roles have no usable start/end dates. Ask the candidate for dates if the timeline matters for this role.`,
      evidence: { undated, totalRoles: c.workHistory.length }, relatedCandidateIds: [],
    });
  }

  if (dated.length < 2) return signals;

  // Overlapping full-time roles at different employers.
  const overlaps: Array<{ a: DatedRole; b: DatedRole; months: number }> = [];
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (sameEmployer(a, b)) continue;
      if (concurrentOk(a) || concurrentOk(b)) continue;
      const months = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      const minimum = a.yearPrecision || b.yearPrecision ? MIN_OVERLAP_MONTHS_YEAR_PRECISION : MIN_OVERLAP_MONTHS;
      if (months > minimum) overlaps.push({ a, b, months });
    }
  }
  if (overlaps.length) {
    // Three or more roles at the same time is rarer than one long overlap.
    const maxConcurrent = maxConcurrentEmployers(dated);
    const longest = Math.max(...overlaps.map(o => o.months));
    signals.push({
      section: 'resume', signalType: 'overlapping_roles',
      severity: maxConcurrent >= 3 ? 'medium' : 'low',
      fingerprint: `overlapping_roles:${overlaps.map(o => `${o.a.index}-${o.b.index}`).join(',')}`,
      title: maxConcurrent >= 3 ? `${maxConcurrent} jobs held at the same time` : 'Overlapping jobs',
      explanation: overlaps.slice(0, 3).map(o => `${roleLabel(o.a)} overlaps ${roleLabel(o.b)} by ${o.months} months.`).join(' ')
        + ' Could be legitimate (side work, notice period, contract role); ask the candidate to clarify.',
      evidence: { overlaps: overlaps.map(o => ({ roleA: o.a.index, roleB: o.b.index, months: o.months })), maxConcurrent, longestMonths: longest },
      relatedCandidateIds: [],
    });
  }

  // Gaps between consecutive roles.
  const sorted = [...dated].sort((x, y) => x.start - y.start);
  let coveredUntil = sorted[0].end;
  const gaps: Array<{ after: DatedRole; before: DatedRole; months: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const gap = r.start - coveredUntil;
    const minimum = r.yearPrecision ? MIN_GAP_MONTHS + 11 : MIN_GAP_MONTHS;
    if (gap >= minimum) {
      const prev = sorted.slice(0, i).reduce((p, q) => (q.end > p.end ? q : p));
      gaps.push({ after: prev, before: r, months: gap });
    }
    coveredUntil = Math.max(coveredUntil, r.end);
  }
  if (gaps.length) {
    signals.push({
      section: 'resume', signalType: 'employment_gap', severity: 'info',
      fingerprint: `employment_gap:${gaps.map(g => `${g.after.index}-${g.before.index}`).join(',')}`,
      title: gaps.length === 1 ? 'Employment gap' : `${gaps.length} employment gaps`,
      explanation: gaps.map(g => `${g.months} months between ${formatMonth(g.after.end)} and ${formatMonth(g.before.start)}.`).join(' ')
        + ' Gaps are common and not a concern on their own; worth a question if relevant.',
      evidence: { gaps: gaps.map(g => ({ afterRole: g.after.index, beforeRole: g.before.index, months: g.months })) },
      relatedCandidateIds: [],
    });
  }

  return signals;
}

export function experienceClaimCheck(c: TrustCandidate, now: Date = new Date()): TrustSignal[] {
  if (c.claimedYears === null) return [];
  if ((c.dataQualityScore ?? 0) < MIN_QUALITY_FOR_EXPERIENCE_CLAIM) return [];
  const { dated, undated, invalid } = parseTimeline(c, now);
  // Only compare when every role is dated; otherwise the computed total is a guess.
  if (dated.length < 2 || undated > 0 || invalid.length > 0) return [];
  const computed = Math.round((totalMonths(dated) / 12) * 10) / 10;
  const claimed = c.claimedYears;
  if (claimed - computed < CLAIM_EXCESS_YEARS || claimed < computed * CLAIM_EXCESS_RATIO) return [];
  return [{
    section: 'resume', signalType: 'experience_claim_mismatch', severity: 'low',
    fingerprint: `experience_claim_mismatch:${claimed}`,
    title: 'Claimed experience is longer than the listed jobs',
    explanation: `The resume claims ${claimed} years of experience, but the ${dated.length} dated roles add up to about ${computed} years. Earlier roles may simply be left off the resume; ask the candidate.`,
    evidence: { claimedYears: claimed, computedYears: computed, datedRoles: dated.length },
    relatedCandidateIds: [],
  }];
}
