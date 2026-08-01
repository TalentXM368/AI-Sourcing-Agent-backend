import type { JobProfile, JobQualityScore } from '../types/index.js';
import { validateJobCompleteness, validateJobWarnings } from './job-validators.js';

export function computeJobQualityScore(profile: JobProfile): JobQualityScore {
  const completeness = validateJobCompleteness(profile);
  const warnings = validateJobWarnings(profile);

  const fieldConfidence = computeFieldConfidence(profile);
  const errorCount = warnings.filter(w => w.severity === 'error').length;
  const warningCount = warnings.filter(w => w.severity === 'warning').length;

  const completenessScore = completeness.score;
  const confidenceScore = fieldConfidence;
  const penalty = (errorCount * 0.1) + (warningCount * 0.05);
  const overall = Math.max(0, Math.min(1, (completenessScore * 0.5 + confidenceScore * 0.5) - penalty));

  const suggestions = generateSuggestions(profile, completeness.missingFields);

  return {
    overall,
    completeness: completenessScore,
    fieldConfidence: confidenceScore,
    missingFields: completeness.missingFields,
    suggestions,
  };
}

function computeFieldConfidence(profile: JobProfile): number {
  const confidences: number[] = [];

  if (profile.title?.confidence) confidences.push(profile.title.confidence.score);
  if (profile.company?.confidence) confidences.push(profile.company.confidence.score);
  if (profile.summary?.confidence) confidences.push(profile.summary.confidence.score);
  if (profile.industry?.confidence) confidences.push(profile.industry.confidence.score);
  if (profile.seniority?.confidence) confidences.push(profile.seniority.confidence.score);
  if (profile.employmentType?.confidence) confidences.push(profile.employmentType.confidence.score);

  for (const skill of profile.requiredSkills) {
    confidences.push(skill.confidence);
  }

  if (confidences.length === 0) return 0;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

function generateSuggestions(profile: JobProfile, missingFields: string[]): string[] {
  const suggestions: string[] = [];

  if (missingFields.includes('title')) suggestions.push('Add a clear job title');
  if (missingFields.includes('company')) suggestions.push('Add the company name');
  if (missingFields.includes('requiredSkills')) suggestions.push('List the required technical and soft skills');
  if (missingFields.includes('responsibilities')) suggestions.push('Add key responsibilities for this role');
  if (missingFields.includes('summary')) suggestions.push('Add a brief role overview or summary');
  if (missingFields.includes('salary')) suggestions.push('Consider adding salary range for transparency');
  if (missingFields.includes('location')) suggestions.push('Add work location or specify remote/hybrid');
  if (missingFields.includes('benefits')) suggestions.push('List benefits and perks offered');
  if (missingFields.includes('education')) suggestions.push('Specify education requirements');
  if (missingFields.includes('experience')) suggestions.push('Add years of experience requirements');

  return suggestions;
}
