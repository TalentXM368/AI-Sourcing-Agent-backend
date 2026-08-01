import { describe, it, expect } from 'vitest';
import { matchLocation } from '../matchers/location-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string | null | undefined): SourceTracking => ({
  raw: val || '', value: val || '', extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(country?: string | null, state?: string | null, city?: string | null, workMode?: string): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''), industry: st(''),
    domain: null, department: null,
    employmentType: st('full-time'),
    workMode: st(workMode || 'onsite'),
    seniority: st('mid'),
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: city !== undefined ? st(city) : null, state: state !== undefined ? st(state) : null, country: country !== undefined ? st(country) : null, raw: null },
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

function makeCandidate(country?: string | null, state?: string | null, city?: string | null, summary?: string): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: summary || '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: city !== undefined ? st(city) : null, state: state !== undefined ? st(state) : null, country: country !== undefined ? st(country) : null },
    skills: [], experience: [],
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

describe('matchLocation', () => {
  it('returns high score for remote job', () => {
    const result = matchLocation(makeJob('US', null, null, 'remote'), makeCandidate('UK'));
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.remoteCompatible).toBe(true);
  });

  it('returns high score for exact city match', () => {
    const result = matchLocation(makeJob('US', 'CA', 'SF'), makeCandidate('US', 'CA', 'SF'));
    expect(result.score).toBe(100);
    expect(result.cityMatch).toBe(true);
  });

  it('returns 80 for state match', () => {
    const result = matchLocation(makeJob('US', 'CA', 'NYC'), makeCandidate('US', 'CA', 'LA'));
    expect(result.score).toBe(80);
    expect(result.stateMatch).toBe(true);
    expect(result.cityMatch).toBe(false);
  });

  it('returns 60 for country-only match', () => {
    const result = matchLocation(makeJob('US', 'CA', 'SF'), makeCandidate('US', 'NY', 'NYC'));
    expect(result.score).toBe(60);
    expect(result.countryMatch).toBe(true);
    expect(result.stateMatch).toBe(false);
  });

  it('returns low score for mismatched country when city and state are specified', () => {
    const result = matchLocation(makeJob('US', 'CA', 'SF'), makeCandidate('UK', 'NY', 'NYC'));
    expect(result.score).toBe(20);
    expect(result.countryMatch).toBe(false);
  });

  it('returns high score when no location requirement', () => {
    const result = matchLocation(makeJob(), makeCandidate('UK'));
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('handles remote work mode', () => {
    const result = matchLocation(makeJob(null, null, null, 'remote'), makeCandidate());
    expect(result.remoteCompatible).toBe(true);
  });

  it('handles flexible work mode', () => {
    const result = matchLocation(makeJob(null, null, null, 'flexible'), makeCandidate());
    expect(result.remoteCompatible).toBe(true);
  });

  it('detects remote from candidate summary', () => {
    const result = matchLocation(makeJob('US'), makeCandidate(null, null, null, 'experienced remote software engineer'));
    expect(result.remoteCompatible).toBe(true);
  });
});
