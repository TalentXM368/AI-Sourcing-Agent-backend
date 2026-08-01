import {
  EMPLOYMENT_TYPE_KEYWORDS,
  WORK_MODE_KEYWORDS,
  type EmploymentType,
  type WorkMode,
} from '../constants/index.js';

export function normalizeEmploymentType(text: string): EmploymentType {
  const lower = text.toLowerCase();

  for (const [type, keywords] of Object.entries(EMPLOYMENT_TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return type as EmploymentType;
    }
  }

  return 'full-time';
}

export function normalizeWorkMode(text: string): WorkMode {
  const lower = text.toLowerCase();

  for (const [mode, keywords] of Object.entries(WORK_MODE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return mode as WorkMode;
    }
  }

  return 'onsite';
}

export function detectEmploymentTypeFromSections(sections: string[]): EmploymentType {
  const combined = sections.join(' ').toLowerCase();

  if (/\b(intern|internship|co-op|trainee)\b/i.test(combined)) return 'internship';
  if (/\b(part[- ]?time)\b/i.test(combined)) return 'part-time';
  if (/\b(contract|contractor|1099)\b/i.test(combined)) return 'contract';
  if (/\b(freelance|freelancer)\b/i.test(combined)) return 'freelance';
  if (/\b(consultant|consulting)\b/i.test(combined)) return 'consultant';
  if (/\b(temp|temporary|seasonal)\b/i.test(combined)) return 'temporary';
  if (/\b(temp[- ]?to[- ]?hire|contract[- ]?to[- ]?hire)\b/i.test(combined)) return 'temporary-to-hire';

  return 'full-time';
}
