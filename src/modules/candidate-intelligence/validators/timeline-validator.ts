import type { ValidationWarning } from '../types/profile.types.js';
import type { ExtractedExperience, ExtractedEducation } from '../types/extracted.types.js';

export function validateTimeline(
  experience: ExtractedExperience[],
  education: ExtractedEducation[],
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const exp of experience) {
    if (exp.startDateRaw && exp.endDateRaw && !exp.isCurrent) {
      const start = new Date(exp.startDateRaw);
      const end = new Date(exp.endDateRaw);
      if (start > end) {
        warnings.push({
          field: 'experience',
          message: `Start date (${exp.startDateRaw}) is after end date (${exp.endDateRaw})`,
          severity: 'error',
        });
      }
    }
  }

  for (const edu of education) {
    if (edu.graduationYearRaw) {
      const year = parseInt(edu.graduationYearRaw);
      if (year < 1950 || year > new Date().getFullYear() + 5) {
        warnings.push({
          field: 'education',
          message: `Graduation year ${year} seems invalid`,
          severity: 'warning',
        });
      }
    }
  }

  return warnings;
}
