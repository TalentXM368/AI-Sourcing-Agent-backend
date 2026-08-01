import { describe, it, expect } from 'vitest';
import { matchIndustry } from '../matchers/industry-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(industry?: string, domain?: string): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''),
    industry: st(industry || ''), domain: domain ? st(domain) : null,
    department: null,
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

function makeCandidate(text: string): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: st(text), summary: text },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [],
    experience: [{ company: st(text), title: st(text), employmentType: null, startDate: null, endDate: null, isCurrent: true, durationMonths: 12, responsibilities: [] }],
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

describe('matchIndustry', () => {
  it('returns default score when no industry specified', () => {
    const result = matchIndustry(makeJob(), makeCandidate('software engineer'));
    expect(result.score).toBe(70);
    expect(result.domainRelevant).toBe(true);
  });

  it('detects exact industry match', () => {
    const result = matchIndustry(makeJob('technology'), makeCandidate('software engineer at a technology company'));
    expect(result.exactMatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('detects domain relevance via industry groups', () => {
    const result = matchIndustry(makeJob('software'), makeCandidate('software developer at a saas company'));
    expect(result.domainRelevant).toBe(true);
  });

  it('returns lower score for unrelated industry', () => {
    const result = matchIndustry(makeJob('healthcare'), makeCandidate('software engineer at a tech company'));
    expect(result.score).toBeLessThan(70);
  });

  it('clamps score between 0 and 100', () => {
    const result = matchIndustry(makeJob('technology'), makeCandidate('unrelated field'));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('handles domain field', () => {
    const result = matchIndustry(makeJob('', 'fintech'), makeCandidate('fintech developer'));
    expect(result.score).toBeGreaterThan(40);
  });
});
