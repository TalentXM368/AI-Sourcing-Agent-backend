import type { LocationMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';

function normalizeLocation(s: string | null | undefined): string {
  return (s || '').toLowerCase().trim();
}

export function matchLocation(
  job: JobProfile,
  candidate: CandidateProfile,
): LocationMatchResult {
  const jobCountry = normalizeLocation(job.location.country?.value);
  const jobState = normalizeLocation(job.location.state?.value);
  const jobCity = normalizeLocation(job.location.city?.value);
  const jobWorkMode = normalizeLocation(job.workMode.value);

  const candCountry = normalizeLocation(candidate.contact.country?.value);
  const candState = normalizeLocation(candidate.contact.state?.value);
  const candCity = normalizeLocation(candidate.contact.city?.value);

  const isRemote = jobWorkMode === 'remote' || jobWorkMode === 'flexible';
  const candidateRemote = candidate.experience.some(e =>
    e.responsibilities.some(r => r.toLowerCase().includes('remote')),
  ) || (candidate.personal.summary || '').toLowerCase().includes('remote');

  const countryMatch = !jobCountry || !candCountry || jobCountry === candCountry;
  const stateMatch = !jobState || !candState || jobState === candState;
  const cityMatch = !jobCity || !candCity || jobCity === candCity;

  const remoteCompatible = isRemote || candidateRemote;

  let score = 50;

  if (isRemote) {
    score = 85;
    if (countryMatch) score += 10;
    if (stateMatch) score += 5;
  } else {
    if (cityMatch) score = 100;
    else if (stateMatch) score = 80;
    else if (countryMatch) score = 60;
    else score = 20;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    countryMatch,
    stateMatch,
    cityMatch,
    remoteCompatible,
  };
}
