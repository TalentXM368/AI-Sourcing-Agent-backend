import { normalizeCompanyName } from '../../candidate-resolution/utils/string-similarity.js';
import { githubUser, linkedinSlug, normalizeEmail, normalizePhone, sha16 } from '../utils/normalize.js';
import { parseResumeDate } from '../utils/dates.js';
import type { TrustCandidate } from '../types.js';

export type IdentityKind = 'email' | 'phone' | 'linkedin' | 'github' | 'text' | 'work' | 'line';

/** The comparison keys for one candidate. */
export function identityKeys(c: TrustCandidate): Partial<Record<Exclude<IdentityKind, 'line'>, string>> {
  const keys: Partial<Record<Exclude<IdentityKind, 'line'>, string>> = {};
  const email = normalizeEmail(c.email);
  if (email) keys.email = email;
  const phone = normalizePhone(c.phone);
  if (phone) keys.phone = phone.key;
  const li = linkedinSlug(c.linkedinUrl);
  if (li) keys.linkedin = li;
  const gh = githubUser(c.githubUrl);
  if (gh) keys.github = gh;
  if (c.textHash) keys.text = c.textHash;
  const work = workFingerprint(c);
  if (work) keys.work = work;
  return keys;
}

/** Fingerprint of the dated work history (employer + start + end). Needs at least 2 dated roles. */
export function workFingerprint(c: TrustCandidate): string | null {
  const parts: string[] = [];
  for (const w of c.workHistory) {
    const company = normalizeCompanyName(w.company || '');
    const from = parseResumeDate(w.from);
    const to = parseResumeDate(w.to || (w.is_current ? 'Present' : ''));
    if (!company || !from || !to) continue;
    parts.push(`${company}|${from.month}|${to.isPresent ? 'present' : to.month}`);
  }
  if (parts.length < 2) return null;
  return sha16(parts.sort().join('\n'));
}

/**
 * In-memory index of every candidate's identity keys, scoped by organization so
 * one tenant's records are never compared with another's.
 */
export class IdentityIndex {
  private readonly candidates = new Map<string, TrustCandidate>();
  private readonly buckets = new Map<string, string[]>();

  private bucketKey(org: string | null, kind: IdentityKind, value: string): string {
    return `${org ?? '-'}|${kind}|${value}`;
  }

  private push(key: string, id: string): void {
    const list = this.buckets.get(key);
    if (list) list.push(id);
    else this.buckets.set(key, [id]);
  }

  add(c: TrustCandidate): void {
    this.candidates.set(c.id, c);
    for (const [kind, value] of Object.entries(identityKeys(c))) {
      this.push(this.bucketKey(c.organizationId, kind as IdentityKind, value), c.id);
    }
    for (const h of c.contentHashes) this.push(this.bucketKey(c.organizationId, 'line', h), c.id);
  }

  get(id: string): TrustCandidate | undefined {
    return this.candidates.get(id);
  }

  get size(): number {
    return this.candidates.size;
  }

  all(): IterableIterator<TrustCandidate> {
    return this.candidates.values();
  }

  /** Other candidates (same org) sharing this key, excluding `selfId`. */
  lookup(org: string | null, kind: IdentityKind, value: string, selfId: string): TrustCandidate[] {
    const ids = this.buckets.get(this.bucketKey(org, kind, value)) ?? [];
    const out: TrustCandidate[] = [];
    for (const id of ids) {
      if (id === selfId) continue;
      const c = this.candidates.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  /**
   * Database-wide line counts. A partial index (only the candidates related to
   * the ones being checked) cannot count lines itself, so the caller supplies them.
   */
  private readonly spreadOverride = new Map<string, number>();

  setLineSpread(org: string | null, hash: string, count: number): void {
    this.spreadOverride.set(this.bucketKey(org, 'line', hash), count);
  }

  /** How many candidates contain this content line (used to skip boilerplate). */
  lineSpread(org: string | null, hash: string): number {
    const key = this.bucketKey(org, 'line', hash);
    return this.spreadOverride.get(key) ?? this.buckets.get(key)?.length ?? 0;
  }
}
