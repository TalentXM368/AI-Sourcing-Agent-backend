import type { SourceTracking, ProcessedSection, ExtractedJobClassification } from '../types/index.js';
import { st } from '../utils/index.js';
import { normalizeEmploymentType, classifyIndustryFromText } from '../normalizers/index.js';

export function extractJobClassification(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobClassification {
  const empSection = sections.find(s => s.normalizedName === 'employment');
  const empText = empSection?.content || fullText;

  const employmentType = normalizeEmploymentType(empText);
  const industry = classifyIndustryFromText(fullText);

  const workAuth = extractWorkAuthorization(fullText);
  const visa = extractVisaSponsorship(fullText);
  const travel = extractTravel(fullText);
  const shift = extractShift(fullText);

  return {
    employmentType: st(employmentType, 'classification-extractor', empSection ? 'employment' : 'document', 0.8),
    workMode: null,
    industry: st(industry.industry, 'classification-extractor', 'document', industry.confidence),
    domain: null,
    seniority: null,
    workAuthorization: workAuth,
    visaSponsorship: visa,
    travelRequirements: travel,
    shift,
  };
}

function extractWorkAuthorization(text: string): SourceTracking | null {
  const patterns = [
    /(?:work authorization|right to work|authorized to work)[:\s]*([^\n.]+)/i,
    /(?:must be authorized|must have work authorization|authorized in)/i,
    /(?:us work authorization|uscis|visa status)[:\s]*([^\n.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1]?.trim() || match[0].trim();
      return st(value, 'classification-extractor', 'workAuth', 0.8);
    }
  }

  return null;
}

function extractVisaSponsorship(text: string): SourceTracking | null {
  const lower = text.toLowerCase();

  if (/\b(no\s+visa\s+sponsorship|unable\s+to\s+sponsor|cannot\s+sponsor|not\s+sponsor)\b/i.test(lower)) {
    return st('No visa sponsorship', 'classification-extractor', 'workAuth', 0.85);
  }
  if (/\b(visa\s+sponsorship\s+available|we\s+sponsor|h1b\s+sponsorship|will\s+sponsor)\b/i.test(lower)) {
    return st('Visa sponsorship available', 'classification-extractor', 'workAuth', 0.85);
  }

  return null;
}

function extractTravel(text: string): SourceTracking | null {
  const patterns = [
    /(?:travel\s+(?:requirements?|percentage|policy))[:\s]*(\d+[\s\-]*(?:%|percent))/i,
    /(?:travel)[:\s]*(?:up\s+to\s+)?(\d+[\s\-]*(?:%|percent))/i,
    /(\d+[\s\-]*(?:%|percent))\s*travel/i,
    /(?:occasional|frequent|required|up\s+to)\s+travel/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1]?.trim() || match[0].trim();
      return st(value, 'classification-extractor', 'travel', 0.75);
    }
  }

  return null;
}

function extractShift(text: string): SourceTracking | null {
  const patterns = [
    /(?:shift|work schedule|hours|working hours)[:\s]*([^\n.]+)/i,
    /\b(day shift|night shift|swing shift|rotating shift|flexible hours|9[- ]?to[- ]?5|business hours)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1]?.trim() || match[0].trim();
      return st(value, 'classification-extractor', 'shift', 0.7);
    }
  }

  return null;
}
