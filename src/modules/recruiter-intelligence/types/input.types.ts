import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export interface RecruiterAIInput {
  jobProfile: JobProfile;
  shortlistedCandidates: ShortlistedCandidate[];
}

export interface ShortlistedCandidate {
  candidateProfile: CandidateProfile;
  matchScore: number;
  semanticScore: number;
  skillScore: number;
  experienceScore: number;
  educationScore: number;
  locationScore: number;
  industryScore: number;
  employmentScore: number;
  salaryScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  additionalSkills: string[];
  hardFilterPassed: boolean;
  confidence: number;
}

export interface RecruiterAIRequest {
  input: RecruiterAIInput;
  options?: RecruiterAIOptions;
}

export interface RecruiterAIOptions {
  maxCandidates?: number;
  reranker?: 'cohere' | 'local-bge' | 'local-jina' | 'none';
  provider?: 'openai' | 'claude' | 'gemini' | 'groq' | 'auto';
  includeMetadata?: boolean;
}
