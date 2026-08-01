import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

export function calculateConfidence(
  candidate: CandidateProfile,
  job: JobProfile,
  requiredSkillCoverage: number,
): number {
  const { CONFIDENCE_FACTORS } = MATCHING_CONSTANTS;

  const completeness = candidate.completeness?.score || 0;

  let validationScore = 1.0;
  if (candidate.validation?.warnings?.length) {
    const errors = candidate.validation.warnings.filter(w => w.severity === 'error').length;
    const warnings = candidate.validation.warnings.filter(w => w.severity === 'warning').length;
    validationScore = Math.max(0.3, 1.0 - (errors * 0.3) - (warnings * 0.1));
  }

  const processingWarnings = candidate.processing?.warnings?.length || 0;
  const processingErrors = candidate.processing?.errors?.length || 0;
  const parsingReliability = Math.max(0.3, 1.0 - (processingWarnings * 0.05) - (processingErrors * 0.1));

  const skillCoverage = Math.max(0, Math.min(1, requiredSkillCoverage));

  const hasTimeline = candidate.experience.length > 0;
  const timelineConsistency = hasTimeline ? 1.0 : 0.5;

  const confidence =
    completeness * CONFIDENCE_FACTORS.COMPLETENESS_WEIGHT +
    validationScore * CONFIDENCE_FACTORS.VALIDATION_WEIGHT +
    parsingReliability * CONFIDENCE_FACTORS.PARSING_WEIGHT +
    skillCoverage * CONFIDENCE_FACTORS.SKILL_COVERAGE_WEIGHT +
    timelineConsistency * CONFIDENCE_FACTORS.TIMELINE_WEIGHT;

  return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
}
