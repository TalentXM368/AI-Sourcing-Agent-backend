import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedContact } from '../types/extracted.types.js';
import type { SourceTracking } from '../types/common.types.js';
import { sourceTracking, highConfidence, mediumConfidence, lowConfidence } from '../utils/index.js';

function extractEmail(text: string): string | null {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m?.[0] || null;
}

function extractPhone(text: string): string | null {
  const patterns = [
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+?\d{10,12}/,
    /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

function extractLinkedin(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_.+]+(?:\/[a-zA-Z0-9\-_.]+)*/i);
  return m?.[0] || null;
}

function extractGithub(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9\-_.]+(?:\/[a-zA-Z0-9\-_.]+)*/i);
  return m?.[0] || null;
}

function extractPortfolio(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.(?:com|dev|io|net|org)(?:\/[^\s]*)?/i);
  if (m && !m[0].includes('linkedin') && !m[0].includes('github')) {
    return m[0];
  }
  return null;
}

function extractCityStateCountry(text: string): { city: string | null; state: string | null; country: string | null } {
  const cityStateMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/);
  if (cityStateMatch) {
    return { city: cityStateMatch[1], state: cityStateMatch[2], country: null };
  }
  const locationMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/);
  if (locationMatch) {
    return { city: locationMatch[1], state: null, country: null };
  }
  return { city: null, state: null, country: null };
}

function st(raw: string | null, section: string, confidence: number, reason: string): SourceTracking | null {
  if (!raw) return null;
  return sourceTracking(raw, 'contact', section, { score: confidence, reasons: [reason] });
}

export function extractContact(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedContact {
  const contactSection = sections.find(s => s.normalizedName === 'contact');
  const headerSection = sections.slice(0, 3).map(s => s.content).join(' ');
  const searchText = [contactSection?.content || '', headerSection, fullText].join(' ');

  const email = extractEmail(searchText);
  const phone = extractPhone(searchText);
  const linkedin = extractLinkedin(searchText);
  const github = extractGithub(searchText);
  const portfolio = extractPortfolio(searchText);
  const { city, state, country } = extractCityStateCountry(headerSection);

  return {
    email: st(email, 'contact', email ? 1 : 0, email ? 'Email regex match' : 'No email found'),
    phone: st(phone, 'contact', phone ? 0.95 : 0, phone ? 'Phone regex match' : 'No phone found'),
    linkedin: st(linkedin, 'contact', linkedin ? 0.95 : 0, linkedin ? 'LinkedIn URL match' : 'No LinkedIn found'),
    github: st(github, 'contact', github ? 0.95 : 0, github ? 'GitHub URL match' : 'No GitHub found'),
    portfolio: st(portfolio, 'contact', portfolio ? 0.85 : 0, portfolio ? 'Portfolio URL match' : 'No portfolio found'),
    website: st(null, 'contact', 0, 'Not extracted'),
    city: city ? sourceTracking(city, 'contact', 'header', { score: 0.7, reasons: ['City from header'] }) : null,
    state: state ? sourceTracking(state, 'contact', 'header', { score: 0.7, reasons: ['State from header'] }) : null,
    country: country ? sourceTracking(country, 'contact', 'header', { score: 0.7, reasons: ['Country from header'] }) : null,
  };
}
