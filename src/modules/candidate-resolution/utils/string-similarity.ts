const LEGAL_SUFFIXES = new Set([
  'llc', 'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'co', 'company', 'gmbh', 'ag', 'kg', 'ohg', 'sa', 'sas', 'sarl',
  'pty ltd', 'bv', 'nv', 'spa', 'ab', 'plc', 'llp', 'lp',
]);

const NOISE_WORDS = new Set(['the', 'and', 'of', 'at', 'for', 'in', 'on']);

export function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompanyName(raw: string): string {
  const normalized = normalizeForComparison(raw);
  const tokens = normalized.split(' ').filter(t => t.length > 1 && !LEGAL_SUFFIXES.has(t) && !NOISE_WORDS.has(t));
  return tokens.join(' ').trim();
}

export function normalizeName(raw: string): string {
  return normalizeForComparison(raw)
    .split(' ')
    .filter(t => t.length > 1)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ')
    .trim();
}

export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  if (matchWindow < 0) return 0;

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

export function jaroWinkler(s1: string, s2: string, prefixScale: number = 0.1): number {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(normalizeForComparison(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeForComparison(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;

  const shared = [...ta].filter(t => tb.has(t)).length;
  const total = ta.size + tb.size - shared;
  const jaccard = shared / total;

  const drift = (ta.size + tb.size - 2 * shared) / (ta.size + tb.size);
  return Math.round(jaccard * (1 - 0.35 * drift) * 100) / 100;
}

export function findDuplicates<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const item of items) {
    if (seen.has(item)) dupes.add(item);
    seen.add(item);
  }
  return Array.from(dupes);
}
