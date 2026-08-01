import type { StructuredDocument, ProcessedSection, DoclingSection } from '../types/input.types.js';
import { SECTION_ALIASES } from '../constants/section-aliases.js';
import { normalizeText } from '../utils/text-utils.js';

const HEADER_SKIP_PATTERNS = [
  /^\d+/, /^\(/, /@/, /resume/i, /cv/i, /curriculum/i,
  /phone/i, /email/i, /address/i, /linkedin/i, /github/i,
  /http/i, /www\./i, /location/i,
];

function scoreSectionMatch(normalizedName: string, alias: string): number {
  if (normalizedName === alias) return 1.0;
  if (normalizedName.includes(alias)) return 0.8;
  const aliasWords = alias.split(/\s+/);
  const nameWords = normalizedName.split(/\s+/);
  const overlap = aliasWords.filter(w => nameWords.includes(w)).length;
  if (overlap > 0) return (overlap / aliasWords.length) * 0.6;
  return 0;
}

function matchSectionType(normalizedName: string): string | null {
  let bestType: string | null = null;
  let bestScore = 0;

  for (const [type, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      const score = scoreSectionMatch(normalizedName, alias);
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }
  }

  return bestScore >= 0.6 ? bestType : null;
}

export function processSections(doc: StructuredDocument): ProcessedSection[] {
  const sections: ProcessedSection[] = [];
  const docSections = doc.sections;

  if (!docSections || docSections.length === 0) {
    if (doc.plainText) {
      sections.push({
        originalName: 'uncategorized',
        normalizedName: 'uncategorized',
        content: doc.plainText,
        level: 0,
        pageNumber: 1,
      });
    }
    return sections;
  }

  let currentSectionType: string | null = null;
  let currentContent: string[] = [];

  function flushSection() {
    if (currentSectionType && currentContent.length > 0) {
      const originalName = docSections.find(s =>
        matchSectionType(normalizeText(s.name)) === currentSectionType
      )?.name || currentSectionType;

      sections.push({
        originalName,
        normalizedName: currentSectionType,
        content: currentContent.join('\n\n'),
        level: 0,
        pageNumber: undefined,
      });
    }
    currentContent = [];
  }

  for (const section of docSections) {
    const normalizedName = normalizeText(section.name);

    // Match against section aliases first
    let sectionType = matchSectionType(normalizedName);

    // Only apply skip patterns if no alias matched
    if (!sectionType && HEADER_SKIP_PATTERNS.some(p => p.test(normalizedName))) {
      sectionType = null;
    }

    if (sectionType) {
      flushSection();
      currentSectionType = sectionType;
    }

    currentContent.push(section.content);
  }

  flushSection();

  // If no sections were detected, treat the whole doc as uncategorized
  if (sections.length === 0 && doc.plainText) {
    sections.push({
      originalName: 'uncategorized',
      normalizedName: 'uncategorized',
      content: doc.plainText,
      level: 0,
      pageNumber: undefined,
    });
  }

  return sections;
}

export function getSummary(sections: ProcessedSection[]): string {
  const summarySection = sections.find(s => s.normalizedName === 'summary');
  return summarySection?.content || '';
}

export function getSectionContent(sections: ProcessedSection[], type: string): string {
  const section = sections.find(s => s.normalizedName === type);
  return section?.content || '';
}

export function hasSection(sections: ProcessedSection[], type: string): boolean {
  return sections.some(s => s.normalizedName === type);
}
