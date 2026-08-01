import type { FieldCandidate, ConsensusResult } from '../interfaces/index.js';
import { getConfidenceLevel } from '../constants/index.js';

export function computeConfidence<T>(
  result: ConsensusResult<T>,
  allCandidates: FieldCandidate<T>[],
): { confidence: number; level: string; reasons: string[] } {
  const reasons: string[] = [...result.reasons];
  let score = 0;

  if (allCandidates.length === 0) {
    return { confidence: 0, level: 'low', reasons: ['No candidates'] };
  }

  // Factor 1: Source agreement (0-0.4)
  const matchingCount = allCandidates.filter(
    c => String(c.value) === String(result.selected)
  ).length;
  const agreementRatio = matchingCount / allCandidates.length;
  score += agreementRatio * 0.4;
  if (matchingCount > 1) {
    reasons.push(`${matchingCount}/${allCandidates.length} sources agree`);
  } else {
    reasons.push('Single source only');
  }

  // Factor 2: Source priority (0-0.3)
  const maxPriority = Math.max(...allCandidates.map(c => c.priority));
  const priorityScore = maxPriority > 0 ? maxPriority / 5 : 0;
  score += priorityScore * 0.3;
  const bestSource = allCandidates.find(c => c.priority === maxPriority);
  if (bestSource) {
    reasons.push(`Highest priority source: ${bestSource.source} (priority ${maxPriority})`);
  }

  // Factor 3: Normalization match (0-0.2)
  const normalizedMatch = String(result.normalized) !== String(result.selected);
  if (normalizedMatch) {
    score += 0.2;
    reasons.push('Value normalized via knowledge dictionary');
  } else {
    score += 0.1;
    reasons.push('No knowledge dictionary match (raw value used)');
  }

  // Factor 4: Conflict penalty (0-0.1)
  if (result.conflictDetected) {
    score -= 0.1;
    reasons.push('Conflict penalty applied');
  }

  const finalScore = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const level = getConfidenceLevel(finalScore);

  return { confidence: finalScore, level, reasons };
}
