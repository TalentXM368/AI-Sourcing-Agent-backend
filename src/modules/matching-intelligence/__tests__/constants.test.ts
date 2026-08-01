import { describe, it, expect } from 'vitest';
import { MATCHING_CONSTANTS } from '../constants/index.js';

describe('MATCHING_CONSTANTS', () => {
  it('has VERSION string', () => {
    expect(typeof MATCHING_CONSTANTS.VERSION).toBe('string');
    expect(MATCHING_CONSTANTS.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has DEFAULT_TOP_K as positive integer', () => {
    expect(typeof MATCHING_CONSTANTS.DEFAULT_TOP_K).toBe('number');
    expect(MATCHING_CONSTANTS.DEFAULT_TOP_K).toBeGreaterThan(0);
  });

  it('has valid weights summing to less than 1.0', () => {
    const w = MATCHING_CONSTANTS.WEIGHTS;
    const sum = w.requiredSkills + w.semanticSimilarity + w.experience + w.education + w.industry + w.location + w.employment + w.salary;
    expect(sum).toBeLessThanOrEqual(1.0);
    expect(sum).toBeGreaterThan(0.8);
  });

  it('has quality bonus bounds', () => {
    const q = MATCHING_CONSTANTS.QUALITY_BONUS;
    expect(q.MIN_MULTIPLIER).toBeLessThan(q.MAX_MULTIPLIER);
    expect(q.MIN_MULTIPLIER).toBeGreaterThan(0);
    expect(q.MAX_MULTIPLIER).toBeLessThanOrEqual(1.1);
  });

  it('has thresholds in descending order', () => {
    const t = MATCHING_CONSTANTS.THRESHOLDS;
    expect(t.STRONG_MATCH).toBeGreaterThan(t.GOOD_MATCH);
    expect(t.GOOD_MATCH).toBeGreaterThan(t.POTENTIAL_MATCH);
    expect(t.POTENTIAL_MATCH).toBeGreaterThan(t.WEAK_MATCH);
  });

  it('has skill match weights', () => {
    const s = MATCHING_CONSTANTS.SKILL_MATCH;
    expect(s.EXACT_WEIGHT).toBeGreaterThan(s.ALIAS_WEIGHT);
    expect(s.ALIAS_WEIGHT).toBeGreaterThan(s.RELATED_WEIGHT);
  });

  it('has confidence factors summing to 1.0', () => {
    const c = MATCHING_CONSTANTS.CONFIDENCE_FACTORS;
    const sum = c.COMPLETENESS_WEIGHT + c.VALIDATION_WEIGHT + c.PARSING_WEIGHT + c.SKILL_COVERAGE_WEIGHT + c.TIMELINE_WEIGHT;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('has industry groups as non-empty record', () => {
    expect(Object.keys(MATCHING_CONSTANTS.INDUSTRY_GROUPS).length).toBeGreaterThan(0);
    for (const group of Object.values(MATCHING_CONSTANTS.INDUSTRY_GROUPS)) {
      expect(Array.isArray(group)).toBe(true);
      expect(group.length).toBeGreaterThan(0);
    }
  });

  it('has SENIORITY_LEVELS as array', () => {
    expect(Array.isArray(MATCHING_CONSTANTS.SENIORITY_LEVELS)).toBe(true);
    expect(MATCHING_CONSTANTS.SENIORITY_LEVELS.length).toBeGreaterThan(0);
  });

  it('has EMPLOYMENT_TYPES as array', () => {
    expect(Array.isArray(MATCHING_CONSTANTS.EMPLOYMENT_TYPES)).toBe(true);
    expect(MATCHING_CONSTANTS.EMPLOYMENT_TYPES).toContain('full-time');
  });

  it('has WORK_MODES as array', () => {
    expect(Array.isArray(MATCHING_CONSTANTS.WORK_MODES)).toBe(true);
    expect(MATCHING_CONSTANTS.WORK_MODES).toContain('remote');
  });
});
