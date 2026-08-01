import { RECRUITER_CONSTANTS } from '../constants/index.js';

export interface ScoreAdjustmentResult {
  crossEncoderAdjustment: number;
  displayScore: number;
}

export function calculateDisplayScore(
  matchScore: number,
  crossEncoderRawScore: number,
): ScoreAdjustmentResult {
  const { baseline, scale, maxAdjustment, minAdjustment } = RECRUITER_CONSTANTS.scoreAdjustment;

  const adjustment = Math.round((crossEncoderRawScore - baseline) * scale);
  const clampedAdjustment = Math.max(minAdjustment, Math.min(maxAdjustment, adjustment));
  const displayScore = Math.max(0, Math.min(100, matchScore + clampedAdjustment));

  return {
    crossEncoderAdjustment: clampedAdjustment,
    displayScore,
  };
}

export function deriveRecommendation(
  displayScore: number,
  confidence: number,
): 'Strong Hire' | 'Good Hire' | 'Consider' | 'Maybe' | 'Not Recommended' {
  const { strongHire, goodHire, consider, maybe } = RECRUITER_CONSTANTS.recommendationThresholds;

  const adjustedScore = displayScore * confidence;

  if (adjustedScore >= strongHire) return 'Strong Hire';
  if (adjustedScore >= goodHire) return 'Good Hire';
  if (adjustedScore >= consider) return 'Consider';
  if (adjustedScore >= maybe) return 'Maybe';
  return 'Not Recommended';
}

export function deriveConfidenceLevel(
  confidenceScore: number,
): { level: 'High' | 'Medium' | 'Low'; score: number } {
  const { high, medium } = RECRUITER_CONSTANTS.confidenceThresholds;

  let level: 'High' | 'Medium' | 'Low';
  if (confidenceScore >= high) {
    level = 'High';
  } else if (confidenceScore >= medium) {
    level = 'Medium';
  } else {
    level = 'Low';
  }

  return { level, score: confidenceScore };
}
