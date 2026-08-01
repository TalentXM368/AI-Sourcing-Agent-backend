import type { QualityBonusResult } from '../types/index.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

export function calculateQualityBonus(
  candidate: CandidateProfile,
): QualityBonusResult {
  const completeness = candidate.completeness?.score || 0;

  let validationScore = 1.0;
  if (candidate.validation?.warnings?.length > 0) {
    const errorCount = candidate.validation.warnings.filter(w => w.severity === 'error').length;
    const warningCount = candidate.validation.warnings.filter(w => w.severity === 'warning').length;
    validationScore = Math.max(0.3, 1.0 - (errorCount * 0.3) - (warningCount * 0.1));
  }

  const warningCount = candidate.processing?.warnings?.length || 0;
  const errorCount = candidate.processing?.errors?.length || 0;
  const parsingReliability = Math.max(0.3, 1.0 - (warningCount * 0.05) - (errorCount * 0.1));

  const average = (completeness + validationScore + parsingReliability) / 3;

  const { MIN_MULTIPLIER, MAX_MULTIPLIER, MAX_BONUS_RANGE } = MATCHING_CONSTANTS.QUALITY_BONUS;
  const multiplier = MIN_MULTIPLIER + (average * MAX_BONUS_RANGE);

  return {
    multiplier: Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, multiplier)),
    completeness,
    validationScore,
    parsingReliability,
  };
}
