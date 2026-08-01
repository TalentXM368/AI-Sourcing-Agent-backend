import { describe, it, expect } from 'vitest';
import { runConsensus } from '../../engines/consensus.engine.js';
import type { FieldCandidate } from '../../interfaces/index.js';

describe('runConsensus', () => {
  const normalizer = (v: string) => v.toLowerCase().trim();

  it('returns empty result for no candidates', () => {
    const result = runConsensus([], normalizer);
    expect(result.confidence).toBe(0);
    expect(result.conflictDetected).toBe(false);
    expect(result.reasons).toContain('No candidates provided');
  });

  it('returns single candidate with reduced confidence', () => {
    const candidates: FieldCandidate<string>[] = [
      { value: 'John Doe', source: 'header', sourceSection: 'header', confidence: 0.9, priority: 3 },
    ];
    const result = runConsensus(candidates, normalizer);
    expect(result.normalized).toBe('john doe');
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.conflictDetected).toBe(false);
    expect(result.reasons).toContain('Single source only');
  });

  it('selects value with highest weight when multiple agree', () => {
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 'experience', sourceSection: 'experience', confidence: 0.9, priority: 4 },
      { value: 'Google', source: 'contact', sourceSection: 'contact', confidence: 0.8, priority: 3 },
      { value: 'Google', source: 'header', sourceSection: 'header', confidence: 0.7, priority: 2 },
    ];
    const result = runConsensus(candidates, normalizer);
    expect(result.normalized).toBe('google');
    expect(result.conflictDetected).toBe(false);
    expect(result.sources).toContain('experience');
  });

  it('detects conflict when candidates are close in weight', () => {
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 's1', sourceSection: 'sec1', confidence: 0.5, priority: 3 },
      { value: 'Alphabet', source: 's2', sourceSection: 'sec2', confidence: 0.5, priority: 3 },
    ];
    const result = runConsensus(candidates, normalizer);
    expect(result.conflictDetected).toBe(true);
  });

  it('does not detect conflict when one candidate dominates', () => {
    const candidates: FieldCandidate<string>[] = [
      { value: 'Google', source: 's1', sourceSection: 'sec1', confidence: 0.9, priority: 5 },
      { value: 'Alphabet', source: 's2', sourceSection: 'sec2', confidence: 0.3, priority: 1 },
    ];
    const result = runConsensus(candidates, normalizer);
    expect(result.conflictDetected).toBe(false);
  });
});
