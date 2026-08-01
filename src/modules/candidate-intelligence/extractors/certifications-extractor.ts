import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedCertification } from '../types/extracted.types.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';

function extractYearFromCert(s: string): string | null {
  const m = s.match(/(20\d{2}|19\d{2})/);
  return m?.[1] || null;
}

function parseCertificationLine(line: string): ExtractedCertification {
  const parts = line.split(/[-–|,]+/).map(p => p.trim()).filter(Boolean);

  let name = parts[0];
  let issuer: string | null = null;
  let dateRaw: string | null = null;

  if (parts.length >= 3) {
    issuer = parts[1];
    dateRaw = extractYearFromCert(parts[parts.length - 1]);
  } else if (parts.length === 2) {
    const lastIsYear = /\b(20\d{2}|19\d{2})\b/.test(parts[1]);
    if (lastIsYear) {
      dateRaw = extractYearFromCert(parts[1]);
    } else {
      issuer = parts[1];
    }
  }

  return {
    name: name || 'Unknown',
    issuer,
    dateRaw,
    sourceSection: 'certifications',
    confidence: mediumConfidence('Cert section line parse'),
  };
}

export function extractCertifications(sections: ProcessedSection[]): ExtractedCertification[] {
  const certSection = sections.find(s => s.normalizedName === 'certifications');
  if (!certSection) return [];

  return certSection.content.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3)
    .map(line => parseCertificationLine(line))
    .filter(c => c.name.length > 2)
    .slice(0, 8);
}
