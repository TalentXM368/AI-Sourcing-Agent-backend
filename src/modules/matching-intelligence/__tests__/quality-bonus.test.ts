import { describe, it, expect } from 'vitest';
import { calculateQualityBonus } from '../matchers/quality-bonus.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

function makeCandidate(overrides: Partial<{
  completenessScore: number;
  validationWarnings: Array<{ field: string; severity: 'error' | 'warning' | 'info'; message: string }>;
  processingWarnings: string[];
  processingErrors: string[];
}> = {}): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: 'cand-1',
    personal: {
      name: { raw: 'Test', value: 'Test', extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] } },
      headline: null, summary: '',
    },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [],
    experience: [],
    education: [], projects: [], certifications: [], languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
    metadata: { resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false, sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '' },
    processing: {
      parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 0,
      processedAt: new Date().toISOString(),
      warnings: overrides.processingWarnings || [],
      errors: overrides.processingErrors || [],
      extractorsRun: [], normalizersRun: [], resolversRun: [],
    },
    validation: { warnings: overrides.validationWarnings || [], isValid: true },
    completeness: {
      score: overrides.completenessScore || 0.8,
      missingFields: [],
      presentFields: [],
    },
  };
}

describe('calculateQualityBonus', () => {
  it('returns multiplier within bounds', () => {
    const result = calculateQualityBonus(makeCandidate());
    expect(result.multiplier).toBeGreaterThanOrEqual(MATCHING_CONSTANTS.QUALITY_BONUS.MIN_MULTIPLIER);
    expect(result.multiplier).toBeLessThanOrEqual(MATCHING_CONSTANTS.QUALITY_BONUS.MAX_MULTIPLIER);
  });

  it('returns higher multiplier for high-quality candidate', () => {
    const high = calculateQualityBonus(makeCandidate({ completenessScore: 1.0 }));
    const low = calculateQualityBonus(makeCandidate({ completenessScore: 0.2 }));
    expect(high.multiplier).toBeGreaterThanOrEqual(low.multiplier);
  });

  it('reduces multiplier for validation errors', () => {
    const clean = calculateQualityBonus(makeCandidate());
    const withErrors = calculateQualityBonus(makeCandidate({
      validationWarnings: [
        { field: 'email', severity: 'error', message: 'Invalid email' },
        { field: 'phone', severity: 'error', message: 'Invalid phone' },
      ],
    }));
    expect(withErrors.multiplier).toBeLessThanOrEqual(clean.multiplier);
  });

  it('reduces multiplier for processing warnings', () => {
    const clean = calculateQualityBonus(makeCandidate());
    const withWarnings = calculateQualityBonus(makeCandidate({
      processingWarnings: ['warn1', 'warn2', 'warn3'],
    }));
    expect(withWarnings.multiplier).toBeLessThanOrEqual(clean.multiplier);
  });

  it('reduces multiplier for processing errors', () => {
    const clean = calculateQualityBonus(makeCandidate());
    const withErrors = calculateQualityBonus(makeCandidate({
      processingErrors: ['error1', 'error2'],
    }));
    expect(withErrors.multiplier).toBeLessThanOrEqual(clean.multiplier);
  });

  it('reports completeness score', () => {
    const result = calculateQualityBonus(makeCandidate({ completenessScore: 0.75 }));
    expect(result.completeness).toBe(0.75);
  });

  it('returns validation score', () => {
    const result = calculateQualityBonus(makeCandidate());
    expect(result.validationScore).toBeGreaterThanOrEqual(0);
    expect(result.validationScore).toBeLessThanOrEqual(1);
  });

  it('returns parsing reliability', () => {
    const result = calculateQualityBonus(makeCandidate());
    expect(result.parsingReliability).toBeGreaterThanOrEqual(0);
    expect(result.parsingReliability).toBeLessThanOrEqual(1);
  });
});
