import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../../engines/confidence.engine.js';
import type { FieldCandidate, ConsensusResult } from '../../interfaces/index.js';

function makeConsensus(selected: string, alternatives: string[] = [], conflictDetected = false): ConsensusResult<string> {
  return {
    selected,
    normalized: selected.toLowerCase(),
    alternatives,
    confidence: 0.5,
    confidenceLevel: 'medium',
    reasons: [],
    sources: ['test'],
    conflictDetected,
  };
}

describe('computeConfidence', () => {
  it('returns 0 for empty candidates', () => {
    const consensus = makeConsensus('test');
    const result = computeConfidence(consensus, []);
    expect(result.confidence).toBe(0);
    expect(result.level).toBe('low');
  });

  it('gives higher score when multiple sources agree', () => {
    const consensus = makeConsensus('Google');
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 's1', sourceSection: 'sec1', confidence: 0.9, priority: 4 },
      { value: 'Google', source: 's2', sourceSection: 'sec2', confidence: 0.9, priority: 4 },
      { value: 'Google', source: 's3', sourceSection: 'sec3', confidence: 0.9, priority: 4 },
    ];
    const result = computeConfidence(consensus, candidates);
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.reasons.some(r => r.includes('sources agree'))).toBe(true);
  });

  it('applies conflict penalty', () => {
    const consensus = makeConsensus('google', ['alphabet'], true);
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 's1', sourceSection: 'sec1', confidence: 0.9, priority: 4 },
      { value: 'Alphabet', source: 's2', sourceSection: 'sec2', confidence: 0.9, priority: 4 },
    ];
    const result = computeConfidence(consensus, candidates);
    expect(result.reasons.some(r => r.includes('Conflict penalty'))).toBe(true);
  });

  it('gives higher score for higher priority sources', () => {
    const consensus = makeConsensus('google');
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 's1', sourceSection: 'sec1', confidence: 0.9, priority: 5 },
    ];
    const result = computeConfidence(consensus, candidates);
    expect(result.reasons.some(r => r.includes('Highest priority source'))).toBe(true);
  });

  it('clamps score between 0 and 1', () => {
    const consensus = makeConsensus('test');
    const candidates: FieldCandidate<string>[] = [
      { value: 'Test', source: 's1', sourceSection: 'sec1', confidence: 1, priority: 5 },
    ];
    const result = computeConfidence(consensus, candidates);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
