import type { HardFilters, FilterContext } from '../types/index.js';
import { SKILL_ALIASES } from '../../candidate-intelligence/constants/skill-aliases.js';

export function applyHardFilters(
  filters: HardFilters,
  context: FilterContext,
): boolean {
  if (!filters) return true;

  if (filters.requiredSkills?.length) {
    const candidateSkillsLower = context.candidateSkills.map(s => s.toLowerCase());
    const aliasesLower = Object.entries(SKILL_ALIASES).reduce((acc, [alias, canonical]) => {
      acc[alias.toLowerCase()] = canonical.toLowerCase();
      return acc;
    }, {} as Record<string, string>);

    for (const required of filters.requiredSkills) {
      const reqLower = required.toLowerCase();
      const canonical = aliasesLower[reqLower] || reqLower;
      const hasSkill = candidateSkillsLower.some(s => {
        const sAlias = aliasesLower[s] || s;
        return sAlias === canonical || s === reqLower;
      });
      if (!hasSkill) return false;
    }
  }

  if (filters.minimumExperienceYears !== undefined) {
    if (context.candidateExperienceYears < filters.minimumExperienceYears) return false;
  }

  if (filters.country) {
    if (context.candidateCountry?.toLowerCase() !== filters.country.toLowerCase()) return false;
  }

  if (filters.state) {
    if (context.candidateState?.toLowerCase() !== filters.state.toLowerCase()) return false;
  }

  if (filters.city) {
    if (context.candidateCity?.toLowerCase() !== filters.city.toLowerCase()) return false;
  }

  if (filters.employmentType) {
    if (context.candidateEmploymentType?.toLowerCase() !== filters.employmentType.toLowerCase()) return false;
  }

  if (filters.workMode) {
    if (context.candidateWorkMode?.toLowerCase() !== filters.workMode.toLowerCase()) return false;
  }

  if (filters.workAuthorization) {
    if (context.candidateWorkAuthorization?.toLowerCase() !== filters.workAuthorization.toLowerCase()) return false;
  }

  if (filters.noticePeriodDays !== undefined && context.candidateNoticePeriodDays !== undefined) {
    if (context.candidateNoticePeriodDays > filters.noticePeriodDays) return false;
  }

  if (filters.salaryRange && context.candidateExpectedSalary !== undefined) {
    if (context.candidateExpectedSalary < filters.salaryRange.min ||
        context.candidateExpectedSalary > filters.salaryRange.max) return false;
  }

  return true;
}
