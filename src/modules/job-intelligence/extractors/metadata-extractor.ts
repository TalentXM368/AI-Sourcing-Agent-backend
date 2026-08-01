import type { SourceTracking, ProcessedSection } from '../types/index.js';
import { st } from '../utils/index.js';
import { normalizeName } from '../../candidate-intelligence/utils/text-utils.js';

export function extractJobMetadata(
  sections: ProcessedSection[],
  fullText: string,
): { title: SourceTracking | null; company: SourceTracking | null; department: SourceTracking | null } {
  return {
    title: extractTitle(sections, fullText),
    company: extractCompany(sections, fullText),
    department: extractDepartment(sections, fullText),
  };
}

function extractTitle(sections: ProcessedSection[], fullText: string): SourceTracking | null {
  const titleSection = sections.find(s => s.normalizedName === 'title');
  if (titleSection) {
    const title = cleanTitle(titleSection.content.split('\n')[0]);
    if (title) return st(title, 'metadata-extractor', 'title', 0.9);
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const titleKeywords = [
    'engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior',
    'staff', 'principal', 'director', 'analyst', 'designer', 'scientist',
    'consultant', 'specialist', 'coordinator', 'administrator', 'officer',
  ];

  for (const line of lines.slice(0, 10)) {
    if (line.length < 80 && line.length > 5) {
      const lower = line.toLowerCase();
      if (titleKeywords.some(kw => lower.includes(kw))) {
        const cleaned = line.replace(/[^a-zA-Z0-9\s\-\.\/]/g, '').trim();
        if (cleaned) return st(cleaned, 'metadata-extractor', 'header', 0.75);
      }
    }
  }

  for (const line of lines.slice(0, 5)) {
    if (line.length > 5 && line.length < 60) {
      const cleaned = line.replace(/[^a-zA-Z0-9\s\-\.\/]/g, '').trim();
      if (cleaned) return st(cleaned, 'metadata-extractor', 'header', 0.5);
    }
  }

  return null;
}

function extractCompany(sections: ProcessedSection[], fullText: string): SourceTracking | null {
  const companySection = sections.find(s => s.normalizedName === 'company');
  if (companySection) {
    const firstLine = companySection.content.split('\n')[0]?.trim();
    if (firstLine && firstLine.length > 2 && firstLine.length < 100) {
      return st(normalizeName(firstLine), 'metadata-extractor', 'company', 0.85);
    }
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const companyIndicators = ['inc', 'llc', 'corp', 'ltd', 'technologies', 'labs', 'group', 'company', 'co.'];

  for (const line of lines.slice(0, 10)) {
    const lower = line.toLowerCase();
    if (companyIndicators.some(ind => lower.includes(ind))) {
      const cleaned = line.replace(/[^a-zA-Z0-9\s\.\-]/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 80) {
        return st(cleaned, 'metadata-extractor', 'header', 0.65);
      }
    }
  }

  return null;
}

function extractDepartment(sections: ProcessedSection[], fullText: string): SourceTracking | null {
  const deptSection = sections.find(s => s.normalizedName === 'department');
  if (deptSection) {
    const dept = deptSection.content.split('\n')[0]?.trim();
    if (dept) return st(normalizeName(dept), 'metadata-extractor', 'department', 0.8);
  }

  const deptPatterns = [
    /(?:department|team|division)[:\s]+([^\n,]+)/i,
    /(?:engineering|product|design|marketing|sales|finance|hr|operations|data)\s+(?:team|department|division)/i,
  ];

  for (const pattern of deptPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return st(normalizeName(match[1] || match[0]), 'metadata-extractor', 'document', 0.5);
    }
  }

  return null;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\s\-\.\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
