import type { SourceTracking, ProcessedSection, ExtractedJobContent } from '../types/index.js';
import { st } from '../utils/index.js';
import { KNOWN_LANGUAGES } from '../../candidate-intelligence/constants/language-list.js';

export function extractJobContent(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobContent {
  const summarySection = sections.find(s => s.normalizedName === 'summary');
  const respSection = sections.find(s => s.normalizedName === 'responsibilities');
  const certSection = sections.find(s => s.normalizedName === 'certifications');

  const summary = summarySection
    ? st(cleanContent(summarySection.content), 'content-extractor', 'summary', 0.8)
    : null;

  const responsibilities = respSection
    ? extractListItems(respSection.content)
    : extractResponsibilitiesFromText(fullText);

  const certifications = certSection
    ? extractListItems(certSection.content)
    : [];

  const languages = extractLanguages(fullText);

  return {
    summary,
    responsibilities,
    certifications,
    languages,
  };
}

function extractListItems(content: string): string[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const items: string[] = [];

  for (const line of lines) {
    const cleaned = line
      .replace(/^[-•*▪▸→]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();

    if (cleaned.length > 5 && cleaned.length < 300) {
      items.push(cleaned);
    }
  }

  return items.slice(0, 25);
}

function extractResponsibilitiesFromText(text: string): string[] {
  const patterns = [
    /(?:responsibilities|what you(?:'ll| will) do|key responsibilities)[:\s]*([\s\S]*?)(?:(?:requirements|qualifications|must have|nice to have|benefits|about us)[:\s]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return extractListItems(match[1]);
    }
  }

  return [];
}

function extractLanguages(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();

  for (const lang of KNOWN_LANGUAGES) {
    const pattern = new RegExp(`\\b${escapeRegex(lang.toLowerCase())}\\b`, 'i');
    if (pattern.test(lower)) {
      found.push(lang);
    }
  }

  return [...new Set(found)];
}

function cleanContent(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 1000);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
