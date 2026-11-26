import {
  fictionalPhone, placeholderEmail, placeholderLocation, placeholderName, type PlaceholderFinding,
} from '../../utils/placeholders.js';
import type { TrustCandidate, TrustSignal } from '../../types.js';

/** All sample/template findings for a candidate, before deciding whether they count. */
export function placeholderFindings(c: TrustCandidate): PlaceholderFinding[] {
  const found = [placeholderName(c.name), placeholderEmail(c.email), fictionalPhone(c.phone), placeholderLocation(c.location)]
    .filter((f): f is PlaceholderFinding => !!f);
  if (c.templatePhrases.length) {
    found.push({ field: 'text', strong: true, reason: `template instructions left in the text (${c.templatePhrases.map(p => `"${p}"`).join(', ')})` });
  }
  return found;
}

/**
 * Sample / placeholder details left over from a resume template.
 *  - template text, or a strong finding plus anything else → high
 *  - one strong finding, or two supporting ones           → medium
 *  - a single supporting finding                          → nothing (too many innocent causes)
 */
export function placeholderChecks(c: TrustCandidate): TrustSignal[] {
  const found = placeholderFindings(c);
  const strong = found.filter(f => f.strong).length;
  let severity: 'high' | 'medium' | null = null;
  if (c.templatePhrases.length || (strong >= 1 && found.length >= 2)) severity = 'high';
  else if (strong === 1 || found.length >= 2) severity = 'medium';
  if (!severity) return [];

  const sentence = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
  return [{
    section: 'fake', signalType: 'placeholder_details', severity,
    fingerprint: `placeholder_details:${found.map(f => f.field).sort().join(',')}`,
    title: severity === 'high' ? 'Resume uses template / sample details' : 'Sample detail on the resume',
    explanation: `${found.map(f => sentence(f.reason)).join('. ')}. `
      + (severity === 'high'
        ? 'Real resumes almost never contain sample details like these. This looks like a filled-in template, not a genuine candidate profile.'
        : 'This may be a leftover from a resume template. Ask the candidate for their real details.'),
    evidence: { found },
    relatedCandidateIds: [],
  }];
}
