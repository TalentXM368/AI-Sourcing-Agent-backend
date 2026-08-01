export interface Confidence {
  score: number;
  reasons: string[];
}

export interface SourceTracking {
  raw: string;
  value: string;
  extractor: string;
  sourceSection: string;
  confidence: Confidence;
}

export type ConfidenceBuilder = {
  score: number;
  reasons: string[];
};

export function createConfidence(score: number, ...reasons: string[]): Confidence {
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export function createSourceTracking(
  raw: string,
  extractor: string,
  sourceSection: string,
  confidence: Confidence,
): SourceTracking {
  return { raw, value: raw, extractor, sourceSection, confidence };
}
