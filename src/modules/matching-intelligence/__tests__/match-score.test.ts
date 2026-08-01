import { describe, it, expect } from 'vitest';
import { calculateMatchScore } from '../scoring/match-score.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

describe('calculateMatchScore', () => {
  const defaultScores = {
    skillScore: 80,
    semanticScore: 75,
    experienceScore: 70,
    educationScore: 60,
    industryScore: 50,
    locationScore: 90,
    employmentScore: 80,
    salaryScore: 70,
  };

  it('returns a number between 0 and 100', () => {
    const score = calculateMatchScore(defaultScores, 1.0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('applies quality multiplier', () => {
    const base = calculateMatchScore(defaultScores, 1.0);
    const boosted = calculateMatchScore(defaultScores, 1.05);
    expect(boosted).toBeGreaterThanOrEqual(base);
  });

  it('reduces score with lower quality multiplier', () => {
    const base = calculateMatchScore(defaultScores, 1.0);
    const reduced = calculateMatchScore(defaultScores, 0.95);
    expect(reduced).toBeLessThanOrEqual(base);
  });

  it('uses default weights when none provided', () => {
    const score = calculateMatchScore(defaultScores, 1.0);
    expect(score).toBeGreaterThan(0);
  });

  it('allows custom weights', () => {
    const customWeights = { requiredSkills: 0.5, semanticSimilarity: 0.5 };
    const score = calculateMatchScore(defaultScores, 1.0, customWeights);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns 0 when all scores are 0', () => {
    const zeroScores = {
      skillScore: 0, semanticScore: 0, experienceScore: 0, educationScore: 0,
      industryScore: 0, locationScore: 0, employmentScore: 0, salaryScore: 0,
    };
    const score = calculateMatchScore(zeroScores, 1.0);
    expect(score).toBe(0);
  });

  it('returns high score when all scores are 100', () => {
    const perfectScores = {
      skillScore: 100, semanticScore: 100, experienceScore: 100, educationScore: 100,
      industryScore: 100, locationScore: 100, employmentScore: 100, salaryScore: 100,
    };
    const score = calculateMatchScore(perfectScores, 1.0);
    expect(score).toBe(100);
  });

  it('weights skills most heavily', () => {
    const allZero = {
      skillScore: 0, semanticScore: 0, experienceScore: 0, educationScore: 0,
      industryScore: 0, locationScore: 0, employmentScore: 0, salaryScore: 0,
    };
    const highSkill = calculateMatchScore({ ...allZero, skillScore: 100 }, 1.0);
    const highSemantic = calculateMatchScore({ ...allZero, semanticScore: 100 }, 1.0);
    expect(highSkill).toBeGreaterThan(highSemantic);
  });

  it('rounds to integer', () => {
    const score = calculateMatchScore(defaultScores, 1.0);
    expect(Number.isInteger(score)).toBe(true);
  });
});
