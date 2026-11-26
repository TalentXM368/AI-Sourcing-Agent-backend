import { createHash } from 'crypto';
import { jaroWinkler, normalizeForComparison } from '../../candidate-resolution/utils/string-similarity.js';
import { looksLikePersonName } from '../../../parsers/deterministic-resume-parser.js';
import { MIN_CONTENT_LINE_LENGTH } from '../constants.js';

const PLACEHOLDER_EMAIL = /(^|[.@])(example|test|noreply|no-reply|donotreply|sample|domain|email)\b/i;

/** Lower-cased email, or null when it is missing or looks like parser junk (e.g. "2002@gmail.com"). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  const m = email.match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/);
  if (!m) return null;
  const local = m[1];
  if (local.length < 3 || /^\d+$/.test(local)) return null;
  if (PLACEHOLDER_EMAIL.test(email)) return null;
  return email;
}

export interface NormalizedPhone {
  /** Last 10 digits: the comparison key. */
  key: string;
  /** Country code, only when the number was written with a leading "+". */
  countryCode: string | null;
}

export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  const key = digits.slice(-10);
  if (/^(\d)\1+$/.test(key) || key === '1234567890' || key === '0123456789') return null;
  const explicitPlus = /^\s*\+/.test(raw);
  const countryCode = explicitPlus && digits.length > 10 ? digits.slice(0, digits.length - 10) : null;
  return { key, countryCode };
}

/** LinkedIn personal-profile slug ("linkedin.com/in/<slug>"), or null. */
export function linkedinSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  slug = slug.toLowerCase().replace(/\/+$/, '');
  return slug.length >= 3 ? slug : null;
}

const GITHUB_RESERVED = new Set(['orgs', 'about', 'features', 'pricing', 'login', 'join', 'topics', 'explore', 'marketplace', 'settings', 'sponsors']);

/** GitHub username from a profile/repo URL, or null. */
export function githubUser(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:[/?#\s]|$)/i);
  if (!m) return null;
  const user = m[1].toLowerCase();
  return GITHUB_RESERVED.has(user) ? null : user;
}

export type NameMatch = 'same' | 'different' | 'unknown';

const NAME_SUFFIXES = new Set([
  'mba', 'phd', 'pmp', 'cpa', 'md', 'rn', 'bsn', 'msn', 'np', 'jr', 'sr', 'ii', 'iii', 'iv', 'cissp', 'csm', 'cspo',
  'pe', 'ms', 'msc', 'bsc', 'ba', 'be', 'btech', 'mtech', 'mca', 'ca', 'cfa', 'shrm', 'cp', 'scp', 'esq', 'dr', 'mr', 'mrs', 'ms.',
]);

/** Strips credentials, honorifics and trailing junk ("Mark Sivilich MBA --" → "Mark Sivilich"). */
export function cleanPersonName(raw: string): string {
  const head = raw.split(/\s(?:--|\||•|–|—)\s?|,/)[0];
  return head
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t && !NAME_SUFFIXES.has(t.toLowerCase().replace(/\.$/, '')) && !/^[-.']+$/.test(t))
    .join(' ')
    .trim();
}

function nameTokens(name: string): string[] {
  return normalizeForComparison(name).split(' ').filter(Boolean);
}

/**
 * Whether two names probably belong to the same person. 'unknown' when either
 * name is not a usable person name (parser junk, a heading, an email, etc.).
 */
export function compareNames(rawA: string | null | undefined, rawB: string | null | undefined): NameMatch {
  const a = rawA ? cleanPersonName(rawA) : '';
  const b = rawB ? cleanPersonName(rawB) : '';
  if (!a || !b || !looksLikePersonName(a) || !looksLikePersonName(b)) return 'unknown';
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 'unknown';
  const na = ta.join(' ');
  const nb = tb.join(' ');
  if (na === nb || jaroWinkler(na, nb) >= 0.92) return 'same';
  // Reordered names ("Smith John" / "John Smith").
  if (jaroWinkler([...ta].sort().join(' '), [...tb].sort().join(' ')) >= 0.92) return 'same';

  const fullA = ta.filter(t => t.length > 1);
  const fullB = tb.filter(t => t.length > 1);
  const shared = fullA.filter(t => fullB.includes(t));
  if (shared.length >= 2) return 'same';
  if (shared.length === 1) {
    // Single-word name contained in the other ("Rohan" / "Rohan Kumar").
    if (fullA.length === 1 || fullB.length === 1) return 'same';
    // Initial + shared surname ("J Smith" / "John Smith").
    if (ta[0][0] === tb[0][0]) return 'same';
  }
  return 'different';
}

export function sha16(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/** Hashes of long resume lines, used to find text copied between resumes. */
export function contentLineHashes(lines: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    const norm = normalizeForComparison(line);
    if (norm.length < MIN_CONTENT_LINE_LENGTH) continue;
    out.add(sha16(norm));
  }
  return [...out];
}

const YEARS_CLAIM = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\.?\s*(?:of\s+)?(?:total\s+|overall\s+|professional\s+|industry\s+|it\s+|hands[\s-]on\s+|work\s+|relevant\s+)*(?:experience|exp\b)/gi;

/** Largest explicit "N years of experience" claim in the text (capped at 45), or null. */
export function extractClaimedYears(text: string | null | undefined): number | null {
  if (!text) return null;
  let best: number | null = null;
  for (const m of text.slice(0, 6000).matchAll(YEARS_CLAIM)) {
    const n = parseFloat(m[1]);
    if (n > 0 && n <= 45 && (best === null || n > best)) best = n;
  }
  return best;
}
