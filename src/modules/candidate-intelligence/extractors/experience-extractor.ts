import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedExperience } from '../types/extracted.types.js';
import { DATE_PATTERNS, EMPLOYMENT_TYPES } from '../constants/index.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';
import { isPresentOrCurrent, extractDateRange } from '../utils/text-utils.js';

function extractTitleCompany(line: string): { title: string | null; company: string | null } {
  const patterns = [
    /(.+?)\s+(?:at|@)\s+(.+)/i,
    /(.+?)\s*[-–|,]\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const stripped = line.replace(DATE_PATTERNS[0]?.source || '', '')
      .replace(DATE_PATTERNS[1]?.source || '', '')
      .trim();
    const match = stripped.match(pattern);
    if (match) {
      return { title: match[1].trim(), company: match[2].trim() };
    }
  }

  return { title: line, company: null };
}

function detectEmploymentType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const type of EMPLOYMENT_TYPES) {
    if (lower.includes(type)) return type;
  }
  return null;
}

function extractResponsibilities(lines: string[]): string[] {
  const responsibilities: string[] = [];
  for (const line of lines) {
    if (/^[•\-▸▪]/.test(line)) {
      responsibilities.push(line.replace(/^[•\-▸▪]\s*/, ''));
    } else if (line.length > 15) {
      responsibilities.push(line);
    }
  }
  return responsibilities;
}

export function extractExperience(sections: ProcessedSection[]): ExtractedExperience[] {
  const expSection = sections.find(s => s.normalizedName === 'experience');
  if (!expSection) return [];

  const entries: ExtractedExperience[] = [];
  const lines = expSection.content.split('\n').map(l => l.trim()).filter(Boolean);
  let current: Partial<ExtractedExperience> | null = null;

  for (const line of lines) {
    let hasDateRange = false;
    let startRaw: string | null = null;
    let endRaw: string | null = null;

    for (const pattern of DATE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        hasDateRange = true;
        startRaw = m[1];
        endRaw = m[2] || 'Present';
        break;
      }
    }

    if (hasDateRange) {
      if (current?.title && current?.company) {
        entries.push(current as ExtractedExperience);
      }

      const { title, company } = extractTitleCompany(line);
      const employmentType = detectEmploymentType(line);

      current = {
        company: company || 'Unknown',
        title: title || 'Unknown',
        employmentType,
        startDateRaw: startRaw,
        endDateRaw: endRaw,
        isCurrent: isPresentOrCurrent(endRaw || ''),
        responsibilities: [],
        sourceSection: 'experience',
        confidence: mediumConfidence('Date range detected'),
      };
    } else if (current) {
      const newResponsibilities = extractResponsibilities([line]);
      current.responsibilities = [...(current.responsibilities || []), ...newResponsibilities];
    }
  }

  if (current?.title && current?.company) {
    entries.push(current as ExtractedExperience);
  }

  return entries.slice(0, 15);
}
