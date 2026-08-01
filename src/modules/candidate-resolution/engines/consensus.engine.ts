import type { FieldCandidate, ConsensusResult } from '../interfaces/index.js';
import { CONFLICT_MARGIN } from '../constants/index.js';

export function runConsensus<T>(
  candidates: FieldCandidate<T>[],
  normalizer: (value: T) => T,
): ConsensusResult<T> {
  if (candidates.length === 0) {
    return {
      selected: null as unknown as T,
      normalized: null as unknown as T,
      alternatives: [],
      confidence: 0,
      confidenceLevel: 'low',
      reasons: ['No candidates provided'],
      sources: [],
      conflictDetected: false,
    };
  }

  if (candidates.length === 1) {
    const normalized = normalizer(candidates[0].value);
    return {
      selected: candidates[0].value,
      normalized,
      alternatives: [],
      confidence: candidates[0].confidence * 0.7,
      confidenceLevel: 'medium',
      reasons: ['Single source only'],
      sources: [candidates[0].source],
      conflictDetected: false,
    };
  }

  const groups = new Map<string, { values: T[]; totalWeight: number; sources: string[] }>();
  for (const candidate of candidates) {
    const normalizedKey = String(normalizer(candidate.value));
    const existing = groups.get(normalizedKey);
    const weight = candidate.priority * candidate.confidence;
    if (existing) {
      existing.values.push(candidate.value);
      existing.totalWeight += weight;
      existing.sources.push(candidate.source);
    } else {
      groups.set(normalizedKey, {
        values: [candidate.value],
        totalWeight: weight,
        sources: [candidate.source],
      });
    }
  }

  let bestKey = '';
  let bestWeight = -1;
  let secondBestWeight = 0;

  for (const [key, group] of groups) {
    if (group.totalWeight > bestWeight) {
      secondBestWeight = bestWeight;
      bestWeight = group.totalWeight;
      bestKey = key;
    } else if (group.totalWeight > secondBestWeight) {
      secondBestWeight = group.totalWeight;
    }
  }

  const bestGroup = groups.get(bestKey)!;
  const normalized = normalizer(bestGroup.values[0]);
  const totalWeight = Array.from(groups.values()).reduce((sum, g) => sum + g.totalWeight, 0);
  const confidence = totalWeight > 0 ? bestWeight / totalWeight : 0;

  const alternatives = candidates
    .filter(c => String(normalizer(c.value)) !== bestKey)
    .map(c => c.value);

  const allSources = candidates.map(c => c.source);
  const uniqueSources = [...new Set(allSources)];

  const margin = totalWeight > 0 ? (bestWeight - secondBestWeight) / totalWeight : 1;
  const conflictDetected = margin < CONFLICT_MARGIN && groups.size > 1;

  const reasons: string[] = [];
  if (candidates.length > 1) reasons.push(`${candidates.length} candidates resolved`);
  if (uniqueSources.length > 1) reasons.push(`${uniqueSources.length} unique sources`);
  if (conflictDetected) reasons.push('Conflict detected between top candidates');

  return {
    selected: bestGroup.values[0],
    normalized,
    alternatives,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLevel: '',
    reasons,
    sources: uniqueSources,
    conflictDetected,
    conflictDetails: conflictDetected
      ? `Margin ${(margin * 100).toFixed(1)}% below threshold ${(CONFLICT_MARGIN * 100).toFixed(0)}%`
      : undefined,
  };
}
