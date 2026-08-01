import type { SourceTracking, ProcessedSection, ExtractedJobEducation } from '../types/index.js';
import { st } from '../utils/index.js';
import { normalizeDegree, normalizeEducationLevel } from '../normalizers/index.js';

const DEGREE_KEYWORDS = [
  'bachelor', 'master', 'phd', 'doctorate', 'mba', 'b.s.', 'm.s.', 'b.a.', 'm.a.',
  'b.tech', 'm.tech', 'b.e.', 'b.sc.', 'm.sc.', 'associate', 'diploma',
  'certification', 'certificate', 'degree',
];

const SCHOOL_KEYWORDS = [
  'university', 'college', 'institute', 'school', 'academy',
  'iit', 'nit', 'mit', 'stanford', 'harvard', 'berkeley',
  'bootcamp', 'coursera', 'udemy', 'edx', 'pluralsight',
];

export function extractJobEducation(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobEducation {
  const eduSection = sections.find(s => s.normalizedName === 'education');
  const reqSection = sections.find(s => s.normalizedName === 'requirements');
  const searchText = eduSection?.content || reqSection?.content || fullText;

  const degree = extractDegree(searchText);
  const specialization = extractSpecialization(searchText);
  const educationLevel = degree ? normalizeEducationLevel(degree) : null;

  return {
    degree: degree
      ? st(degree, 'education-extractor', eduSection ? 'education' : 'requirements', 0.75)
      : null,
    specialization: specialization
      ? st(specialization, 'education-extractor', eduSection ? 'education' : 'requirements', 0.6)
      : null,
    educationLevel: educationLevel
      ? st(educationLevel, 'education-extractor', eduSection ? 'education' : 'requirements', 0.7)
      : null,
  };
}

function extractDegree(text: string): string | null {
  const lower = text.toLowerCase();

  for (const keyword of DEGREE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      const normalized = normalizeDegree(keyword);
      if (normalized) return normalized;
    }
  }

  const degreePatterns = [
    /(?:bachelor(?:'s)?|b\.?s\.?|b\.?a\.?|b\.?tech|b\.?e\.?)\s*(?:of|in)?\s*([^\n,]+)/i,
    /(?:master(?:'s)?|m\.?s\.?|m\.?a\.?|m\.?ba|m\.?tech|m\.?eng)\s*(?:of|in)?\s*([^\n,]+)/i,
    /(?:ph\.?d|doctorate|doctoral)\s*(?:in)?\s*([^\n,]+)/i,
  ];

  for (const pattern of degreePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  return null;
}

function extractSpecialization(text: string): string | null {
  const patterns = [
    /(?:in|of)\s+(computer science|engineering|business|data science|information technology|mathematics|physics|design|marketing|finance|accounting)/i,
    /(?:major|specialization|focus|concentration)\s*(?:in|:)?\s*([^\n,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1]?.trim() || null;
    }
  }

  return null;
}
