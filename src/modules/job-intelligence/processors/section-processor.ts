import type { StructuredDocument, ProcessedSection } from '../types/index.js';
import { JD_SECTION_ALIASES } from '../constants/index.js';

const HEADER_SKIP_PATTERNS = [
  /^\d+[\s.)]/,
  /^[#@*>\-|=]+/,
  /^\(.*\)$/,
  /^page \d+/i,
  /^confidential/i,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}/,
  /^ref:/i,
  /^date:/i,
  /^to:/i,
  /^from:/i,
  /^subject:/i,
];

type SectionType = string;

function normalizeSectionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function scoreSectionMatch(normalizedName: string, alias: string): number {
  if (normalizedName === alias) return 1.0;
  if (normalizedName.includes(alias)) return 0.8;
  const normalWords = normalizedName.split(/\s+/);
  const aliasWords = alias.split(/\s+/);
  const overlap = normalWords.filter(w => aliasWords.includes(w)).length;
  if (overlap > 0) return (overlap / aliasWords.length) * 0.6;
  return 0;
}

function matchSectionType(normalizedLine: string): SectionType | null {
  let bestType: SectionType | null = null;
  let bestScore = 0;

  for (const [type, aliases] of Object.entries(JD_SECTION_ALIASES)) {
    for (const alias of aliases) {
      const score = scoreSectionMatch(normalizedLine, alias);
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }
  }

  return bestScore >= 0.6 ? bestType : null;
}

function getHeaderSectionType(normalizedLine: string): SectionType | null {
  for (const pattern of HEADER_SKIP_PATTERNS) {
    if (pattern.test(normalizedLine)) return null;
  }
  return matchSectionType(normalizedLine);
}

function flushSection(
  sections: ProcessedSection[],
  currentType: string | null,
  currentContent: string[],
  pageNumber?: number,
): void {
  if (currentType && currentContent.length > 0) {
    sections.push({
      originalName: currentType,
      normalizedName: currentType,
      content: currentContent.join('\n'),
      level: 1,
      pageNumber,
    });
  }
}

export function processJDSections(doc: StructuredDocument): ProcessedSection[] {
  const sections: ProcessedSection[] = [];
  let currentType: string | null = null;
  const currentContent: string[] = [];

  if (!doc.sections || doc.sections.length === 0) {
    if (doc.plainText || doc.markdown) {
      const text = doc.plainText || doc.markdown;
      sections.push({
        originalName: 'uncategorized',
        normalizedName: 'uncategorized',
        content: text,
        level: 0,
      });
    }
    return sections;
  }

  for (const section of doc.sections) {
    const sectionType = getHeaderSectionType(section.name.toLowerCase());

    if (sectionType) {
      flushSection(sections, currentType, currentContent, section.pageNumber);
      currentType = sectionType;
      currentContent.length = 0;
      currentContent.push(section.content);
    } else if (currentType) {
      currentContent.push(section.content);
    } else {
      flushSection(sections, currentType, currentContent, section.pageNumber);
      currentType = null;
      currentContent.length = 0;
      sections.push({
        originalName: section.name,
        normalizedName: 'uncategorized',
        content: section.content,
        level: section.level || 0,
        pageNumber: section.pageNumber,
      });
    }
  }

  flushSection(sections, currentType, currentContent);

  if (sections.length === 0 && (doc.plainText || doc.markdown)) {
    sections.push({
      originalName: 'uncategorized',
      normalizedName: 'uncategorized',
      content: doc.plainText || doc.markdown,
      level: 0,
    });
  }

  return sections;
}

export function getSummary(sections: ProcessedSection[]): string {
  const summary = sections.find(s => s.normalizedName === 'summary');
  return summary?.content || '';
}

export function getSectionContent(sections: ProcessedSection[], type: string): string {
  const section = sections.find(s => s.normalizedName === type);
  return section?.content || '';
}

export function hasSection(sections: ProcessedSection[], type: string): boolean {
  return sections.some(s => s.normalizedName === type);
}
