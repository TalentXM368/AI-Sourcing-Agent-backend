export { SECTION_ALIASES } from './section-aliases.js';
export { SKILL_CATEGORIES, SKILL_ALIASES } from './skill-aliases.js';
export { DEGREE_ALIASES, EDUCATION_LEVEL_MAP } from './degree-aliases.js';
export { KNOWN_LANGUAGES, PROFICIENCY_LEVELS, PROFICIENCY_KEYWORDS } from './language-list.js';

export const DATE_PATTERNS = [
  // "Jan 2020 - Present", "January 2020 - Current"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*(?:[-–—]|to)+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current|now)/i,
  // "2020 - Present", "2020 - 2023"
  /(\d{4})\s*(?:[-–—]|to)+\s*(\d{4}|present|current|now)/i,
  // "01/2020 - 06/2023"
  /(\d{1,2}\/\d{4})\s*(?:[-–—]|to)+\s*(\d{1,2}\/\d{4}|present|current|now)/i,
  // "2020-Present"
  /(\d{4})\s*[-–]\s*(present|current|now|\d{4})/i,
  // "Jan 2020 to Present"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s+to\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current)/i,
  // European: "15/03/2020 - 20/12/2023"
  /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[-–—]|to)+\s*(\d{1,2}\/\d{1,2}\/\d{4}|present|current)/i,
  // ISO 8601: "2020-03-15 - 2023-12-20"
  /(\d{4}-\d{2}-\d{2})\s*(?:[-–—]|to)+\s*(\d{4}-\d{2}-\d{2}|present|current)/i,
  // Quarter: "Q1 2022 - Q3 2023"
  /(Q[1-4]\s+\d{4})\s*(?:[-–—]|to)+\s*(Q[1-4]\s+\d{4}|present|current)/i,
  // Full month: "March 2020 - December 2023"
  /((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})\s*(?:[-–—]|to)+\s*((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}|present|current)/i,
  // Standalone: "Jan 2020", "2021"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})/i,
];

export const MONTH_MAP: Record<string, number> = {
  'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
  'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
  'january': 0, 'february': 1, 'march': 2, 'april': 3, 'june': 5,
  'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
};

export const EMPLOYMENT_TYPES: string[] = [
  'full-time', 'part-time', 'contract', 'freelance', 'internship', 'temporary',
  'consultant', 'self-employed', 'volunteer',
];

export const PIPELINE_VERSION = '2.1.0';
export const PARSER_VERSION = 'docling-2.115.0';
