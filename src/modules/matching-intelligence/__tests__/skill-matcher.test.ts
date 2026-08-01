import { describe, it, expect } from 'vitest';
import { matchSkills } from '../matchers/skill-matcher.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';

const st = (val: string): SourceTracking => ({
  raw: val, value: val, extractor: 'test', sourceSection: 'test', confidence: { score: 1, reasons: [] },
});

function makeJob(required: string[], preferred: string[] = []): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: 'job-1',
    title: st('Software Engineer'),
    summary: st(''),
    company: st(''), industry: st(''), domain: null, department: null,
    employmentType: st('full-time'), workMode: st('onsite'), seniority: st('mid'),
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: null, state: null, country: null, raw: null },
    requiredSkills: required.map(s => ({ canonical: s, raw: s, category: 'other', confidence: 0.8 })),
    preferredSkills: preferred.map(s => ({ canonical: s, raw: s, category: 'other', confidence: 0.7 })),
    certifications: [], languages: [], responsibilities: [], benefits: [],
    technologies: [], tools: [], workAuthorization: null, visaSponsorship: null,
    travelRequirements: null, shift: null,
    metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
    processing: { pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.8, completeness: 0.7, fieldConfidence: 0.8, missingFields: [], suggestions: [] },
  };
}

function makeCandidate(skills: string[]): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: 'cand-1',
    personal: { name: st('Test'), headline: null, summary: '' },
    contact: { email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null, city: null, state: null, country: null },
    skills: skills.map(s => ({ canonical: s, raw: s, category: 'other', confidence: { score: 0.8, reasons: [] } })),
    experience: [], education: [], projects: [], certifications: [], languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
    metadata: { resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false, sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '' },
    processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.8, missingFields: [], presentFields: [] },
  };
}

describe('matchSkills', () => {
  it('returns score 100 when no required skills', () => {
    const result = matchSkills(makeJob([]), makeCandidate([]));
    expect(result.score).toBe(100);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('returns perfect score for exact match', () => {
    const result = matchSkills(makeJob(['javascript', 'react']), makeCandidate(['javascript', 'react', 'node.js']));
    expect(result.score).toBe(100);
    expect(result.matched).toEqual(['javascript', 'react']);
    expect(result.missing).toEqual([]);
  });

  it('returns 0 when no skills match', () => {
    const result = matchSkills(makeJob(['rust', 'go']), makeCandidate(['javascript', 'react']));
    expect(result.score).toBe(0);
    expect(result.missing).toEqual(['rust', 'go']);
  });

  it('handles alias matching', () => {
    const result = matchSkills(makeJob(['typescript']), makeCandidate(['ts']));
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('handles related skill matching', () => {
    const result = matchSkills(makeJob(['javascript']), makeCandidate(['react']));
    expect(result.relatedMatched.length).toBe(1);
    expect(result.score).toBe(70);
  });

  it('tracks additional candidate skills', () => {
    const result = matchSkills(makeJob(['javascript']), makeCandidate(['javascript', 'python', 'rust']));
    expect(result.additional).toEqual(['python', 'rust']);
  });

  it('combines exact and related matches', () => {
    const result = matchSkills(makeJob(['javascript', 'react']), makeCandidate(['javascript', 'vue']));
    expect(result.matched).toContain('javascript');
    expect(result.relatedMatched.length).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeGreaterThan(50);
  });

  it('clamps score at max 100', () => {
    const result = matchSkills(makeJob(['javascript']), makeCandidate(['javascript', 'react', 'typescript']));
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('is case-insensitive', () => {
    const result = matchSkills(makeJob(['JavaScript']), makeCandidate(['javascript']));
    expect(result.matched).toContain('javascript');
    expect(result.score).toBe(100);
  });
});
