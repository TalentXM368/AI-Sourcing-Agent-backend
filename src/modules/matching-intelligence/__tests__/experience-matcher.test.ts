import { describe, it, expect } from 'vitest';
import { matchExperience } from '../matchers/experience-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(minYears?: number, maxYears?: number, title?: string): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st(title || 'Software Engineer'), summary: st(''), company: st(''),
    industry: st('technology'), domain: null, department: null,
    employmentType: st('full-time'), workMode: st('onsite'), seniority: st('mid'),
    experience: {
      minimumYears: minYears !== undefined ? st(String(minYears)) : null,
      maximumYears: maxYears !== undefined ? st(String(maxYears)) : null,
      preferredYears: null,
    },
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

function makeCandidate(months: number, title?: string, summary?: string): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: summary || '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [],
    experience: [{
      company: st('ACME'), title: st(title || 'Software Engineer'),
      employmentType: null, startDate: null, endDate: null, isCurrent: true,
      durationMonths: months, responsibilities: [],
    }],
    education: [], projects: [], certifications: [], languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
    metadata: { resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false, sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '' },
    processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.8, missingFields: [], presentFields: [] },
  };
}

describe('matchExperience', () => {
  it('returns positive score for basic candidate', () => {
    const result = matchExperience(makeJob(), makeCandidate(24));
    expect(result.score).toBeGreaterThan(0);
    expect(result.totalYears).toBe(2);
  });

  it('meets minimum when years exceed requirement', () => {
    const result = matchExperience(makeJob(2), makeCandidate(36));
    expect(result.meetsMinimum).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('does not meet minimum when years below requirement', () => {
    const result = matchExperience(makeJob(5), makeCandidate(12));
    expect(result.meetsMinimum).toBe(false);
    expect(result.score).toBeLessThan(70);
  });

  it('detects seniority match', () => {
    const result = matchExperience(makeJob(2, 5, 'Senior Engineer'), makeCandidate(48, 'Senior Engineer'));
    expect(result.seniorityMatch).toBe(true);
  });

  it('detects seniority mismatch', () => {
    const result = matchExperience(makeJob(2, 5, 'Senior Engineer'), makeCandidate(48, 'Junior Engineer'));
    expect(result.seniorityMatch).toBe(false);
  });

  it('detects domain relevance', () => {
    const result = matchExperience(makeJob(), makeCandidate(24, 'Engineer', 'software developer at a tech company'));
    expect(result.domainRelevant).toBe(true);
  });

  it('clamps score between 0 and 100', () => {
    const result = matchExperience(makeJob(10), makeCandidate(6));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('handles no minimum requirement', () => {
    const result = matchExperience(makeJob(), makeCandidate(12));
    expect(result.meetsMinimum).toBe(true);
  });

  it('returns totalYears as 0 for empty experience', () => {
    const candidate = makeCandidate(0);
    candidate.experience = [];
    const result = matchExperience(makeJob(), candidate);
    expect(result.totalYears).toBe(0);
  });
});
