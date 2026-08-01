import type { ResolvedCandidateProfile } from '../types/index.js';
import { findDuplicates } from '../utils/string-similarity.js';

export function validateDuplicates(profile: ResolvedCandidateProfile): string[] {
  const warnings: string[] = [];

  const skillNames = profile.skills.map(s => s.value.toLowerCase());
  const skillDupes = findDuplicates(skillNames);
  if (skillDupes.length) warnings.push(`Duplicate skills: ${skillDupes.join(', ')}`);

  const companies = profile.experience.map(e => e.company.value.toLowerCase());
  const companyDupes = findDuplicates(companies);
  if (companyDupes.length) warnings.push(`Duplicate companies: ${companyDupes.join(', ')}`);

  return warnings;
}
