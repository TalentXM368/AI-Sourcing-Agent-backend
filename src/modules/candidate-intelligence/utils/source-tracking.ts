import type { SourceTracking, Confidence } from '../types/common.types.js';

export function sourceTracking(
  raw: string,
  extractor: string,
  sourceSection: string,
  confidence: Confidence,
): SourceTracking {
  return { raw, value: raw, extractor, sourceSection, confidence };
}

export function nullSourceTracking(): null {
  return null;
}

export function mergeSourceTracking(a: SourceTracking, b: SourceTracking): SourceTracking {
  if (a.confidence.score >= b.confidence.score) return a;
  return b;
}
