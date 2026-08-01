import type { MatchResult } from '../../../matching-intelligence/types/match.types.js';

export function createMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    candidateId: overrides.candidateId || 'bench-candidate-001',
    jobId: overrides.jobId || 'bench-job-001',
    overallScore: overrides.overallScore ?? 82,
    semanticScore: overrides.semanticScore ?? 0.85,
    skillScore: overrides.skillScore ?? 90,
    experienceScore: overrides.experienceScore ?? 78,
    educationScore: overrides.educationScore ?? 85,
    industryScore: overrides.industryScore ?? 70,
    locationScore: overrides.locationScore ?? 100,
    employmentScore: overrides.employmentScore ?? 100,
    salaryScore: overrides.salaryScore ?? 60,
    matchedSkills: overrides.matchedSkills || ['Python', 'FastAPI', 'PostgreSQL'],
    missingSkills: overrides.missingSkills || ['Kubernetes'],
    additionalSkills: overrides.additionalSkills || ['React'],
    hardFilterPassed: overrides.hardFilterPassed ?? true,
    confidence: overrides.confidence ?? 0.82,
  };
}
