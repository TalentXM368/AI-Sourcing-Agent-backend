import {
  SENIORITY_KEYWORDS,
  type SeniorityLevel,
} from '../constants/index.js';

const SENIORITY_ORDER: SeniorityLevel[] = [
  'intern', 'junior', 'mid', 'senior', 'lead', 'staff',
  'principal', 'architect', 'director', 'vp', 'executive',
];

export function detectSeniorityFromTitle(title: string): SeniorityLevel | null {
  const lower = title.toLowerCase();

  for (const level of SENIORITY_ORDER) {
    const keywords = SENIORITY_KEYWORDS[level];
    for (const kw of keywords) {
      if (lower.includes(kw)) return level;
    }
  }

  return null;
}

export function detectSeniorityFromText(text: string): SeniorityLevel | null {
  const lower = text.toLowerCase();

  for (const level of SENIORITY_ORDER) {
    const keywords = SENIORITY_KEYWORDS[level];
    for (const kw of keywords) {
      const pattern = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
      if (pattern.test(lower)) return level;
    }
  }

  return null;
}

export function normalizeSeniority(raw: string): SeniorityLevel {
  const detected = detectSeniorityFromTitle(raw) || detectSeniorityFromText(raw);
  return detected || 'mid';
}

export function getSeniorityOrder(level: SeniorityLevel): number {
  return SENIORITY_ORDER.indexOf(level);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
