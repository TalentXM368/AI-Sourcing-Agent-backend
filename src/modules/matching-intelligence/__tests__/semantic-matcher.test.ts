import { describe, it, expect } from 'vitest';
import { matchSemantic } from '../matchers/semantic-matcher.js';

describe('matchSemantic', () => {
  it('returns 0 for score 0', () => {
    expect(matchSemantic(0)).toBe(0);
  });

  it('returns 100 for score 1', () => {
    expect(matchSemantic(1)).toBe(100);
  });

  it('returns 50 for score 0.5', () => {
    expect(matchSemantic(0.5)).toBe(50);
  });

  it('clamps negative scores to 0', () => {
    expect(matchSemantic(-0.5)).toBe(0);
  });

  it('clamps scores above 1 to 100', () => {
    expect(matchSemantic(1.5)).toBe(100);
  });

  it('rounds to integer', () => {
    const result = matchSemantic(0.333);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('scales linearly', () => {
    expect(matchSemantic(0.25)).toBe(25);
    expect(matchSemantic(0.75)).toBe(75);
  });
});
