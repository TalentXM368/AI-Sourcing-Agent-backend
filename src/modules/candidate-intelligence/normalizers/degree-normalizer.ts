import { DEGREE_ALIASES, EDUCATION_LEVEL_MAP } from '../constants/degree-aliases.js';

export function normalizeDegree(degree: string | null): string | null {
  if (!degree) return null;
  const lower = degree.toLowerCase().trim();

  // Try exact match
  if (DEGREE_ALIASES[lower]) return DEGREE_ALIASES[lower];

  // Try partial match
  for (const [alias, normalized] of Object.entries(DEGREE_ALIASES)) {
    if (lower.includes(alias)) return normalized;
  }

  return degree;
}

export function normalizeEducationLevel(degree: string | null): string | null {
  if (!degree) return null;
  const lower = degree.toLowerCase();

  for (const [keyword, level] of Object.entries(EDUCATION_LEVEL_MAP)) {
    if (lower.includes(keyword)) return level;
  }

  return null;
}
