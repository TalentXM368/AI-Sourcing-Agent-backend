import type { Confidence } from '../types/common.types.js';

export function highConfidence(reason: string): Confidence {
  return { score: 0.9, reasons: [reason] };
}

export function mediumConfidence(reason: string): Confidence {
  return { score: 0.7, reasons: [reason] };
}

export function lowConfidence(reason: string): Confidence {
  return { score: 0.4, reasons: [reason] };
}

export function noConfidence(reason: string): Confidence {
  return { score: 0.0, reasons: [reason] };
}

export function mergeConfidence(a: Confidence, b: Confidence): Confidence {
  return {
    score: Math.min(1, (a.score + b.score) / 2),
    reasons: [...a.reasons, ...b.reasons],
  };
}

export function boostConfidence(base: Confidence, boost: number): Confidence {
  return {
    score: Math.min(1, base.score + boost),
    reasons: base.reasons,
  };
}

export function confidenceFromCount(found: number, expected: number, reason: string): Confidence {
  const score = expected > 0 ? Math.min(1, found / expected) : 0;
  return { score: Math.round(score * 100) / 100, reasons: [reason] };
}

export function confidenceFromLength(text: string, minLength: number, reason: string): Confidence {
  const score = text.length >= minLength ? 1 : text.length / minLength;
  return { score: Math.round(score * 100) / 100, reasons: [reason] };
}
