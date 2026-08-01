export interface HardFilters {
  requiredSkills?: string[];
  minimumExperienceYears?: number;
  country?: string;
  state?: string;
  city?: string;
  employmentType?: string;
  workMode?: string;
  workAuthorization?: string;
  noticePeriodDays?: number;
  salaryRange?: { min: number; max: number };
}

export interface FilterContext {
  candidateCountry?: string;
  candidateState?: string;
  candidateCity?: string;
  candidateExperienceYears: number;
  candidateSkills: string[];
  candidateEmploymentType?: string;
  candidateWorkMode?: string;
  candidateWorkAuthorization?: string;
  candidateNoticePeriodDays?: number;
  candidateExpectedSalary?: number;
}
