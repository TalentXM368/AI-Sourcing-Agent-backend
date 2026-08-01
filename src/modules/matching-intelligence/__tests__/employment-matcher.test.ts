import { describe, it, expect } from 'vitest';
import { matchEmployment } from '../matchers/employment-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(type?: string, mode?: string): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''), industry: st(''),
    domain: null, department: null,
    employmentType: st(type || 'full-time'),
    workMode: st(mode || 'onsite'),
    seniority: st('mid'),
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

function makeCandidate(type?: string, isCurrent?: boolean, summary?: string): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: summary || '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [],
    experience: [{
      company: st('ACME'), title: st('Engineer'),
      employmentType: type ? st(type) : null,
      startDate: null, endDate: null,
      isCurrent: isCurrent !== undefined ? isCurrent : true,
      durationMonths: 24, responsibilities: [],
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

describe('matchEmployment', () => {
  it('returns 100 when both type and mode match', () => {
    const result = matchEmployment(makeJob('full-time', 'onsite'), makeCandidate('full-time', true));
    expect(result.score).toBe(100);
    expect(result.typeCompatible).toBe(true);
    expect(result.modeCompatible).toBe(true);
  });

  it('returns 75 when only type matches', () => {
    const result = matchEmployment(makeJob('full-time', 'remote'), makeCandidate('full-time', true));
    expect(result.score).toBe(75);
    expect(result.typeCompatible).toBe(true);
    expect(result.modeCompatible).toBe(false);
  });

  it('returns 75 when only mode matches', () => {
    const result = matchEmployment(makeJob('part-time', 'onsite'), makeCandidate('full-time', true));
    expect(result.score).toBe(75);
    expect(result.typeCompatible).toBe(false);
    expect(result.modeCompatible).toBe(true);
  });

  it('returns 50 when neither matches', () => {
    const result = matchEmployment(makeJob('part-time', 'remote'), makeCandidate('full-time', true));
    expect(result.score).toBe(50);
    expect(result.typeCompatible).toBe(false);
    expect(result.modeCompatible).toBe(false);
  });

  it('detects remote mode from candidate summary', () => {
    const result = matchEmployment(makeJob('full-time', 'remote'), makeCandidate('full-time', true, 'experienced remote engineer'));
    expect(result.modeCompatible).toBe(true);
  });

  it('handles flexible work mode', () => {
    const result = matchEmployment(makeJob(undefined, 'flexible'), makeCandidate());
    expect(result.modeCompatible).toBe(true);
  });

  it('handles contract type', () => {
    const result = matchEmployment(makeJob('contract'), makeCandidate('freelance', true));
    expect(result.typeCompatible).toBe(true);
  });

  it('defaults to full-time when no type specified', () => {
    const result = matchEmployment(makeJob(), makeCandidate());
    expect(result.typeCompatible).toBe(true);
  });
});
