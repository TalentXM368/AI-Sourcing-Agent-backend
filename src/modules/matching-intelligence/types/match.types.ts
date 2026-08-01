import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export interface MatchResult {
  candidateId: string;
  jobId: string;

  overallScore: number;
  semanticScore: number;
  skillScore: number;
  experienceScore: number;
  educationScore: number;
  industryScore: number;
  locationScore: number;
  employmentScore: number;
  salaryScore: number;

  matchedSkills: string[];
  missingSkills: string[];
  additionalSkills: string[];

  hardFilterPassed: boolean;

  confidence: number;
}

export interface MatchContext {
  candidate: CandidateProfile;
  job: JobProfile;
  semanticScore: number;
  weights: import('./config.types.js').MatchingWeights;
}

export interface SkillMatchResult {
  matched: string[];
  missing: string[];
  additional: string[];
  aliasMatched: string[];
  relatedMatched: string[];
  score: number;
}

export interface ExperienceMatchResult {
  score: number;
  totalYears: number;
  meetsMinimum: boolean;
  seniorityMatch: boolean;
  domainRelevant: boolean;
}

export interface EducationMatchResult {
  score: number;
  levelMatch: boolean;
  specializationMatch: boolean;
  certificationsMet: boolean;
}

export interface IndustryMatchResult {
  score: number;
  exactMatch: boolean;
  domainRelevant: boolean;
}

export interface LocationMatchResult {
  score: number;
  countryMatch: boolean;
  stateMatch: boolean;
  cityMatch: boolean;
  remoteCompatible: boolean;
}

export interface EmploymentMatchResult {
  score: number;
  typeCompatible: boolean;
  modeCompatible: boolean;
}

export interface SalaryMatchResult {
  score: number;
  overlap: boolean;
  overlapPercentage: number;
}

export interface QualityBonusResult {
  multiplier: number;
  completeness: number;
  validationScore: number;
  parsingReliability: number;
}
