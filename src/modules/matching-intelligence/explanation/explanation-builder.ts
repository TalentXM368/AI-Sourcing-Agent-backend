import type { MatchResult } from '../types/index.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

export function buildExplanation(result: MatchResult): {
  strengths: string[];
  weaknesses: string[];
  recommendation: 'strong_match' | 'good_match' | 'potential_match' | 'weak_match';
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (result.skillScore >= 80) {
    strengths.push(`Strong skill alignment (${result.matchedSkills.length} skills matched)`);
  } else if (result.skillScore >= 50) {
    strengths.push(`Moderate skill alignment (${result.matchedSkills.length} skills matched)`);
  } else {
    weaknesses.push(`Missing ${result.missingSkills.length} required skills`);
  }

  if (result.experienceScore >= 80) {
    strengths.push('Experience level well-aligned with requirements');
  } else if (result.experienceScore < 50) {
    weaknesses.push('Experience level may not meet requirements');
  }

  if (result.educationScore >= 80) {
    strengths.push('Education requirements met');
  } else if (result.educationScore < 50) {
    weaknesses.push('Education requirements may not be met');
  }

  if (result.locationScore >= 80) {
    strengths.push('Location compatible');
  } else if (result.locationScore < 50) {
    weaknesses.push('Location may require relocation or remote arrangement');
  }

  if (result.semanticScore >= 80) {
    strengths.push('Strong semantic similarity to job requirements');
  } else if (result.semanticScore < 50) {
    weaknesses.push('Low semantic similarity to job requirements');
  }

  if (result.industryScore >= 80) {
    strengths.push('Industry experience aligns with role');
  } else if (result.industryScore < 50) {
    weaknesses.push('Limited industry-specific experience');
  }

  if (result.confidence >= 0.8) {
    strengths.push('High confidence in match assessment');
  } else if (result.confidence < 0.5) {
    weaknesses.push('Low confidence due to incomplete candidate data');
  }

  let recommendation: 'strong_match' | 'good_match' | 'potential_match' | 'weak_match';
  if (result.overallScore >= MATCHING_CONSTANTS.THRESHOLDS.STRONG_MATCH) {
    recommendation = 'strong_match';
  } else if (result.overallScore >= MATCHING_CONSTANTS.THRESHOLDS.GOOD_MATCH) {
    recommendation = 'good_match';
  } else if (result.overallScore >= MATCHING_CONSTANTS.THRESHOLDS.POTENTIAL_MATCH) {
    recommendation = 'potential_match';
  } else {
    recommendation = 'weak_match';
  }

  return { strengths, weaknesses, recommendation };
}
