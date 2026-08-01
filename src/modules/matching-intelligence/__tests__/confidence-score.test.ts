import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../confidence/confidence-score.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeCandidate(overrides: Partial<{
  completenessScore: number;
  validationWarnings: Array<{ field: string; severity: 'error' | 'warning' | 'info'; message: string }>;
  processingWarnings: string[];
  processingErrors: string[];
  experienceCount: number;
}> = {}): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [],
    experience: Array(overrides.experienceCount || 0).fill(null).map((_, i) => ({
      company: st(`Company ${i}`), title: st('Engineer'),
      employmentType: null, startDate: null, endDate: null, isCurrent: true,
      durationMonths: 12, responsibilities: [],
    })),
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

function makeJob(): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''), industry: st(''),
    domain: null, department: null,
    employmentType: st('full-time'), workMode: st('onsite'), seniority: st('mid'),
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: null, state: null, country: null, raw: null },
    requiredSkills: [], preferredSkills: [],
    certifications: [], languages: [], responsibilities: [], benefits: [],
    technologies: [], tools: [], workAuthorization: null, visaSponsorship: null,
    travelRequirements: null, shift: null,
    metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
    processing: { pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.8, completeness: 0.7, fieldConfidence: 0.8, missingFields: [], suggestions: [] },
  };
}

describe('calculateConfidence', () => {
  it('returns value between 0 and 1', () => {
    const result = calculateConfidence(makeCandidate(), makeJob(), 0.8);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns higher confidence for complete candidates', () => {
    const high = calculateConfidence(makeCandidate({ completenessScore: 1.0, experienceCount: 3 }), makeJob(), 1.0);
    const low = calculateConfidence(makeCandidate({ completenessScore: 0.2, experienceCount: 0 }), makeJob(), 0.2);
    expect(high).toBeGreaterThan(low);
  });

  it('reduces confidence for validation errors', () => {
    const clean = calculateConfidence(makeCandidate(), makeJob(), 0.8);
    const withErrors = calculateConfidence(makeCandidate({
      validationWarnings: [{ field: 'email', severity: 'error', message: 'Invalid' }],
    }), makeJob(), 0.8);
    expect(withErrors).toBeLessThanOrEqual(clean);
  });

  it('reduces confidence for processing errors', () => {
    const clean = calculateConfidence(makeCandidate(), makeJob(), 0.8);
    const withErrors = calculateConfidence(makeCandidate({
      processingErrors: ['parse failed'],
    }), makeJob(), 0.8);
    expect(withErrors).toBeLessThanOrEqual(clean);
  });

  it('rewards skill coverage', () => {
    const high = calculateConfidence(makeCandidate(), makeJob(), 1.0);
    const low = calculateConfidence(makeCandidate(), makeJob(), 0.0);
    expect(high).toBeGreaterThan(low);
  });

  it('rewards having experience timeline', () => {
    const withExp = calculateConfidence(makeCandidate({ experienceCount: 2 }), makeJob(), 0.8);
    const noExp = calculateConfidence(makeCandidate({ experienceCount: 0 }), makeJob(), 0.8);
    expect(withExp).toBeGreaterThanOrEqual(noExp);
  });

  it('returns rounded to 2 decimal places', () => {
    const result = calculateConfidence(makeCandidate(), makeJob(), 0.5);
    const decimalPart = result.toString().split('.')[1];
    expect(decimalPart ? decimalPart.length : 0).toBeLessThanOrEqual(2);
  });
});
