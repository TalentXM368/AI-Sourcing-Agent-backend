import type { ResolvedCandidateProfile, QualityScore } from '../types/index.js';
import { validateCompleteness } from './completeness.validator.js';
import { validateDuplicates } from './duplicate.validator.js';
import { validateTimeline } from './timeline.validator.js';

export function computeQualityScore(profile: ResolvedCandidateProfile): QualityScore {
  const allFields: number[] = [];

  if (profile.personal?.name) allFields.push(profile.personal.name.confidence);
  if (profile.personal?.headline) allFields.push(profile.personal.headline.confidence);
  if (profile.contact?.email) allFields.push(profile.contact.email.confidence);
  if (profile.contact?.phone) allFields.push(profile.contact.phone.confidence);
  if (profile.contact?.linkedin) allFields.push(profile.contact.linkedin.confidence);
  if (profile.contact?.github) allFields.push(profile.contact.github.confidence);
  if (profile.contact?.city) allFields.push(profile.contact.city.confidence);
  if (profile.contact?.state) allFields.push(profile.contact.state.confidence);
  if (profile.contact?.country) allFields.push(profile.contact.country.confidence);

  for (const skill of profile.skills) allFields.push(skill.confidence);
  for (const exp of profile.experience) {
    allFields.push(exp.company.confidence);
    allFields.push(exp.title.confidence);
  }
  for (const edu of profile.education) {
    allFields.push(edu.degree.confidence);
    allFields.push(edu.university.confidence);
  }

  const fieldConfidence = allFields.length > 0
    ? allFields.reduce((a, b) => a + b, 0) / allFields.length
    : 0;

  const missingFields = validateCompleteness(profile);
  const duplicateWarnings = validateDuplicates(profile);
  const timelineWarnings = validateTimeline(profile);
  const totalWarnings = duplicateWarnings.length + timelineWarnings.length;

  const resolvedCount = allFields.length;
  const overall = (fieldConfidence * 0.4)
    + (Math.max(0, 1 - missingFields.length / 10) * 0.3)
    + (Math.max(0, 1 - totalWarnings / Math.max(resolvedCount, 1)) * 0.3);

  return {
    overall: Math.round(overall * 100) / 100,
    fieldConfidence: Math.round(fieldConfidence * 100) / 100,
    conflictCount: totalWarnings,
    resolvedCount,
    missingFields,
    validationWarningCount: totalWarnings,
  };
}
