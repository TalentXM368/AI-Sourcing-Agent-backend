import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedLanguage } from '../types/extracted.types.js';
import { KNOWN_LANGUAGES, PROFICIENCY_KEYWORDS } from '../constants/language-list.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';

function detectProficiency(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, level] of Object.entries(PROFICIENCY_KEYWORDS)) {
    if (lower.includes(keyword)) return level;
  }
  return null;
}

function isKnownLanguage(text: string): boolean {
  return KNOWN_LANGUAGES.includes(text.toLowerCase().trim());
}

export function extractLanguages(sections: ProcessedSection[]): ExtractedLanguage[] {
  const langSection = sections.find(s => s.normalizedName === 'languages');
  if (!langSection) return [];

  const languages: ExtractedLanguage[] = [];

  for (const line of langSection.content.split('\n')) {
    const parts = line.split(/[,•\-|]/).map(p => p.trim()).filter(Boolean);

    for (const part of parts) {
      if (part.length < 2 || part.length > 40) continue;

      const profMatch = part.match(/(.+?)\s*[-–(]\s*(.+?)\)?$/);
      let name: string;
      let proficiency: string | null = null;

      if (profMatch) {
        name = profMatch[1].trim();
        proficiency = profMatch[2].trim();
      } else {
        name = part;
      }

      // Check if it's a known language or a common language name
      const isKnown = isKnownLanguage(name);
      const confidence = isKnown ? 0.9 : 0.5;
      const reason = isKnown ? `Known language: ${name}` : `Potential language: ${name}`;

      languages.push({
        name,
        proficiency,
        sourceSection: 'languages',
        confidence: { score: confidence, reasons: [reason] },
      });
    }
  }

  return languages.slice(0, 10);
}
