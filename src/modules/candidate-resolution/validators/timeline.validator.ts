import type { ResolvedCandidateProfile } from '../types/index.js';

export function validateTimeline(profile: ResolvedCandidateProfile): string[] {
  const warnings: string[] = [];

  for (const exp of profile.experience) {
    if (exp.startDate?.value && exp.endDate?.value && !exp.isCurrent) {
      const start = new Date(exp.startDate.value);
      const end = new Date(exp.endDate.value);
      if (start > end) {
        warnings.push(`Experience: start date ${exp.startDate.value} after end date ${exp.endDate.value}`);
      }
    }
  }

  const currentRoles = profile.experience.filter(e => e.isCurrent);
  if (currentRoles.length > 1) {
    warnings.push(`Multiple current roles: ${currentRoles.map(r => r.company.value).join(', ')}`);
  }

  return warnings;
}
