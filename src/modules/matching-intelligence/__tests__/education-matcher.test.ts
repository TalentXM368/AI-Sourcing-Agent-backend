import { describe, it, expect } from 'vitest';
import { matchEducation } from '../matchers/education-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(eduLevel?: string, degree?: string, spec?: string): JobProfile {
  return {
    schemaVersion: '1.0', jobId: 'job-1',
    title: st('Engineer'), summary: st(''), company: st(''), industry: st(''),
    domain: null, department: null,
    employmentType: st('full-time'), workMode: st('onsite'), seniority: st('mid'),
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: {
      degree: degree ? st(degree) : null,
      specialization: spec ? st(spec) : null,
      educationLevel: eduLevel ? st(eduLevel) : null,
    },
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

function makeCandidate(degrees: string[], specs?: string[]): CandidateProfile {
  return {
    schemaVersion: '1.0', candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: [], experience: [],
    education: degrees.map((d, i) => ({
      degree: st(d),
      specialization: specs?.[i] ? st(specs[i]) : null,
      university: st('Uni'),
      graduationYear: null, educationLevel: null,
    })),
    projects: [], certifications: [], languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
    metadata: { resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false, sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '' },
    processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.8, missingFields: [], presentFields: [] },
  };
}

describe('matchEducation', () => {
  it('returns positive score for any candidate', () => {
    const result = matchEducation(makeJob(), makeCandidate(['B.S. Computer Science']));
    expect(result.score).toBeGreaterThan(0);
  });

  it('meets bachelor level requirement', () => {
    const result = matchEducation(makeJob('bachelor'), makeCandidate(['B.S. Computer Science']));
    expect(result.levelMatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('does not meet masters requirement with bachelor only', () => {
    const result = matchEducation(makeJob('master'), makeCandidate(['B.S. Computer Science']));
    expect(result.levelMatch).toBe(false);
    expect(result.score).toBeLessThan(80);
  });

  it('meets masters requirement with masters', () => {
    const result = matchEducation(makeJob('master'), makeCandidate(['M.S. Computer Science']));
    expect(result.levelMatch).toBe(true);
  });

  it('matches specialization', () => {
    const result = matchEducation(makeJob(undefined, undefined, 'computer science'), makeCandidate(['B.S.'], ['computer science']));
    expect(result.specializationMatch).toBe(true);
  });

  it('handles no education requirement', () => {
    const result = matchEducation(makeJob(), makeCandidate([]));
    expect(result.score).toBeGreaterThan(0);
    expect(result.levelMatch).toBe(true);
  });

  it('clamps score between 0 and 100', () => {
    const result = matchEducation(makeJob('doctorate'), makeCandidate(['Associate']));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('handles doctorate level', () => {
    const result = matchEducation(makeJob('doctorate'), makeCandidate(['PhD Computer Science']));
    expect(result.levelMatch).toBe(true);
  });
});
