import type { MatchingWeights } from '../types/index.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

export function calculateMatchScore(
  scores: {
    skillScore: number;
    semanticScore: number;
    experienceScore: number;
    educationScore: number;
    industryScore: number;
    locationScore: number;
    employmentScore: number;
    salaryScore: number;
  },
  qualityMultiplier: number,
  weights?: Partial<MatchingWeights>,
): number {
  const w = { ...MATCHING_CONSTANTS.WEIGHTS, ...weights };

  const weightedSum =
    scores.skillScore * w.requiredSkills +
    scores.semanticScore * w.semanticSimilarity +
    scores.experienceScore * w.experience +
    scores.educationScore * w.education +
    scores.industryScore * w.industry +
    scores.locationScore * w.location +
    scores.employmentScore * w.employment +
    scores.salaryScore * w.salary;

  const maxPossible = w.requiredSkills + w.semanticSimilarity + w.experience +
    w.education + w.industry + w.location + w.employment + w.salary;

  const normalized = maxPossible > 0 ? (weightedSum / maxPossible) : 0;

  const finalScore = Math.round(normalized * qualityMultiplier);

  return Math.max(0, Math.min(100, finalScore));
}
