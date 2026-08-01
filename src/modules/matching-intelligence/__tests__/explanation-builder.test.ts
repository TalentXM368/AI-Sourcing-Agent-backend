import { describe, it, expect } from 'vitest';
import { buildExplanation } from '../explanation/explanation-builder.js';
import type { MatchResult } from '../types/index.js';

function makeResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    candidateId: 'cand-1',
    jobId: 'job-1',
    overallScore: 75,
    semanticScore: 80,
    skillScore: 85,
    experienceScore: 70,
    educationScore: 60,
    industryScore: 50,
    locationScore: 90,
    employmentScore: 80,
    salaryScore: 70,
    matchedSkills: ['javascript', 'react'],
    missingSkills: ['rust'],
    additionalSkills: ['python'],
    hardFilterPassed: true,
    confidence: 0.85,
    ...overrides,
  };
}

describe('buildExplanation', () => {
  it('returns strengths and weaknesses arrays', () => {
    const result = buildExplanation(makeResult());
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.weaknesses)).toBe(true);
  });

  it('returns valid recommendation type', () => {
    const result = buildExplanation(makeResult());
    expect(['strong_match', 'good_match', 'potential_match', 'weak_match']).toContain(result.recommendation);
  });

  it('identifies strong skill alignment', () => {
    const result = buildExplanation(makeResult({ skillScore: 90 }));
    expect(result.strengths.some(s => s.includes('skill'))).toBe(true);
  });

  it('identifies missing skills as weakness', () => {
    const result = buildExplanation(makeResult({ skillScore: 30, missingSkills: ['rust', 'go'] }));
    expect(result.weaknesses.some(w => w.includes('Missing'))).toBe(true);
  });

  it('identifies strong experience', () => {
    const result = buildExplanation(makeResult({ experienceScore: 90 }));
    expect(result.strengths.some(s => s.includes('Experience'))).toBe(true);
  });

  it('identifies weak experience', () => {
    const result = buildExplanation(makeResult({ experienceScore: 30 }));
    expect(result.weaknesses.some(w => w.includes('Experience'))).toBe(true);
  });

  it('identifies strong education', () => {
    const result = buildExplanation(makeResult({ educationScore: 90 }));
    expect(result.strengths.some(s => s.includes('Education'))).toBe(true);
  });

  it('identifies weak education', () => {
    const result = buildExplanation(makeResult({ educationScore: 30 }));
    expect(result.weaknesses.some(w => w.includes('Education'))).toBe(true);
  });

  it('identifies good location', () => {
    const result = buildExplanation(makeResult({ locationScore: 90 }));
    expect(result.strengths.some(s => s.includes('Location'))).toBe(true);
  });

  it('identifies bad location', () => {
    const result = buildExplanation(makeResult({ locationScore: 30 }));
    expect(result.weaknesses.some(w => w.includes('Location'))).toBe(true);
  });

  it('classifies strong_match correctly', () => {
    const result = buildExplanation(makeResult({ overallScore: 90 }));
    expect(result.recommendation).toBe('strong_match');
  });

  it('classifies good_match correctly', () => {
    const result = buildExplanation(makeResult({ overallScore: 75 }));
    expect(result.recommendation).toBe('good_match');
  });

  it('classifies potential_match correctly', () => {
    const result = buildExplanation(makeResult({ overallScore: 55 }));
    expect(result.recommendation).toBe('potential_match');
  });

  it('classifies weak_match correctly', () => {
    const result = buildExplanation(makeResult({ overallScore: 30 }));
    expect(result.recommendation).toBe('weak_match');
  });

  it('identifies high confidence', () => {
    const result = buildExplanation(makeResult({ confidence: 0.9 }));
    expect(result.strengths.some(s => s.includes('confidence'))).toBe(true);
  });

  it('identifies low confidence', () => {
    const result = buildExplanation(makeResult({ confidence: 0.3 }));
    expect(result.weaknesses.some(w => w.includes('confidence'))).toBe(true);
  });
});
