import type { SourceTracking, ProcessedSection, ExtractedJobExperience } from '../types/index.js';
import { st } from '../utils/index.js';

const EXP_PATTERNS = [
  /(\d+)[\s\-\+to]+(\d+)\s*years?/i,
  /(\d+)[\s\+]*(?:years?|yrs?|y\.?o\.?)\s*(?:of)?\s*(?:experience|exp)/i,
  /minimum\s*(?:of)?\s*(\d+)\s*years?/i,
  /at\s*least\s*(\d+)\s*years?/i,
  /up\s*to\s*(\d+)\s*years?/i,
  /(\d+)\s*(?:to|–|-)\s*(\d+)\s*years/i,
  /(\d+)\+?\s*years?/i,
];

export function extractJobExperience(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobExperience {
  const expSection = sections.find(s => s.normalizedName === 'experience');
  const reqSection = sections.find(s => s.normalizedName === 'requirements');
  const searchSections = [expSection, reqSection].filter(Boolean).map(s => s!.content);
  const searchText = searchSections.length > 0 ? searchSections.join('\n') : fullText;

  const ranges = extractYearRanges(searchText);
  const singleYears = extractSingleYears(searchText);

  let minimumYears: SourceTracking | null = null;
  let maximumYears: SourceTracking | null = null;
  let preferredYears: SourceTracking | null = null;

  if (ranges.length > 0) {
    const bestRange = ranges[0];
    minimumYears = st(
      String(bestRange.min),
      'experience-extractor',
      expSection ? 'experience' : 'requirements',
      0.85,
    );
    maximumYears = st(
      String(bestRange.max),
      'experience-extractor',
      expSection ? 'experience' : 'requirements',
      0.85,
    );
  } else if (singleYears.length > 0) {
    const years = singleYears.sort((a, b) => a - b);
    minimumYears = st(
      String(years[0]),
      'experience-extractor',
      expSection ? 'experience' : 'requirements',
      0.7,
    );
    if (years.length > 1) {
      maximumYears = st(
        String(years[years.length - 1]),
        'experience-extractor',
        expSection ? 'experience' : 'requirements',
        0.6,
      );
    }
  }

  return {
    minimumYears,
    maximumYears,
    preferredYears: null,
  };
}

interface YearRange {
  min: number;
  max: number;
}

function extractYearRanges(text: string): YearRange[] {
  const ranges: YearRange[] = [];

  for (const pattern of EXP_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (match[2] && !isNaN(parseInt(match[1])) && !isNaN(parseInt(match[2]))) {
        const min = parseInt(match[1]);
        const max = parseInt(match[2]);
        if (min <= max && min >= 0 && max <= 50) {
          ranges.push({ min, max });
        }
      } else if (match[1] && !match[2]) {
        const val = parseInt(match[1]);
        if (val >= 0 && val <= 50) {
          if (pattern.source.includes('up\\s*to') || pattern.source.includes('maximum')) {
            ranges.push({ min: 0, max: val });
          } else {
            ranges.push({ min: val, max: val });
          }
        }
      }
    }
  }

  return ranges;
}

function extractSingleYears(text: string): number[] {
  const years: number[] = [];
  const pattern = /(\d+)\+?\s*years?/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const val = parseInt(match[1]);
    if (val >= 0 && val <= 50) {
      years.push(val);
    }
  }

  return [...new Set(years)];
}
