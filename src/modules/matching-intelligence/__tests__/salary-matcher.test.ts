import { describe, it, expect } from 'vitest';
import { matchSalary, matchSalaryWithExpectation } from '../matchers/salary-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(min?: number, max?: number): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''), industry: st(''),
    domain: null, department: null,
    employmentType: st('full-time'), workMode: st('onsite'), seniority: st('mid'),
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: {
      currency: min !== undefined ? st('USD') : null,
      minimum: min !== undefined ? st(String(min)) : null,
      maximum: max !== undefined ? st(String(max)) : null,
      period: null, raw: null,
    },
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

describe('matchSalary', () => {
  it('returns default score when no salary specified', () => {
    const result = matchSalary(makeJob());
    expect(result.score).toBe(70);
    expect(result.overlap).toBe(true);
    expect(result.overlapPercentage).toBe(100);
  });

  it('returns default score when salary is specified', () => {
    const result = matchSalary(makeJob(80000, 120000));
    expect(result.score).toBe(70);
    expect(result.overlap).toBe(true);
  });
});

describe('matchSalaryWithExpectation', () => {
  it('returns default score when no salary specified', () => {
    const result = matchSalaryWithExpectation(makeJob(), 100000, 150000);
    expect(result.score).toBe(70);
    expect(result.overlap).toBe(true);
  });

  it('returns good score for overlapping range', () => {
    const result = matchSalaryWithExpectation(makeJob(80000, 120000), 100000, 150000);
    expect(result.overlap).toBe(true);
    expect(result.overlapPercentage).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(50);
  });

  it('returns low score for non-overlapping range', () => {
    const result = matchSalaryWithExpectation(makeJob(50000, 70000), 100000, 150000);
    expect(result.overlap).toBe(false);
    expect(result.overlapPercentage).toBe(0);
    expect(result.score).toBe(20);
  });

  it('returns high score for exact match', () => {
    const result = matchSalaryWithExpectation(makeJob(100000, 150000), 100000, 150000);
    expect(result.overlap).toBe(true);
    expect(result.overlapPercentage).toBe(100);
    expect(result.score).toBe(100);
  });

  it('handles partial overlap', () => {
    const result = matchSalaryWithExpectation(makeJob(80000, 120000), 110000, 160000);
    expect(result.overlap).toBe(true);
    expect(result.overlapPercentage).toBeGreaterThan(0);
    expect(result.overlapPercentage).toBeLessThan(100);
  });

  it('clamps score between 0 and 100', () => {
    const result = matchSalaryWithExpectation(makeJob(200000, 300000), 50000, 80000);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
