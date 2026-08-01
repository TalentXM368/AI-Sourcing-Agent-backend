import type { EmploymentMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';

const TYPE_COMPATIBILITY: Record<string, string[]> = {
  'full-time': ['full-time'],
  'part-time': ['part-time'],
  'contract': ['contract', 'freelance'],
  'internship': ['internship'],
  'freelance': ['freelance', 'contract'],
};

const MODE_COMPATIBILITY: Record<string, string[]> = {
  'remote': ['remote', 'flexible'],
  'hybrid': ['hybrid', 'remote', 'flexible'],
  'onsite': ['onsite'],
  'flexible': ['remote', 'hybrid', 'onsite', 'flexible'],
};

export function matchEmployment(
  job: JobProfile,
  candidate: CandidateProfile,
): EmploymentMatchResult {
  const jobType = (job.employmentType.value || 'full-time').toLowerCase();
  const jobMode = (job.workMode.value || 'onsite').toLowerCase();

  const candidateCurrentType = candidate.experience.find(e => e.isCurrent)?.employmentType?.value?.toLowerCase()
    || (candidate.experience.length > 0 ? 'full-time' : 'full-time');

  const typeCompatible = TYPE_COMPATIBILITY[jobType]?.includes(candidateCurrentType) || false;

  const candidateRemote = candidate.experience.some(e =>
    e.responsibilities.some(r => r.toLowerCase().includes('remote')),
  ) || (candidate.personal.summary || '').toLowerCase().includes('remote');

  const candidateMode = candidateRemote ? 'remote' : 'onsite';
  const modeCompatible = MODE_COMPATIBILITY[jobMode]?.includes(candidateMode) || false;

  let score = 50;
  if (typeCompatible) score += 25;
  if (modeCompatible) score += 25;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    typeCompatible,
    modeCompatible,
  };
}
