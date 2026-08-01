import type { IndustryMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';

function getIndustryGroup(industry: string): string | null {
  const lower = industry.toLowerCase();
  for (const [group, keywords] of Object.entries(MATCHING_CONSTANTS.INDUSTRY_GROUPS)) {
    if (keywords.some(k => lower.includes(k))) return group;
  }
  return null;
}

export function matchIndustry(
  job: JobProfile,
  candidate: CandidateProfile,
): IndustryMatchResult {
  const jobIndustry = job.industry.value || '';
  const jobDomain = job.domain?.value || '';

  const candidateText = [
    candidate.personal.summary,
    candidate.personal.headline?.value,
    ...candidate.experience.map(e => e.company.value),
    ...candidate.experience.map(e => e.title.value),
  ].filter(Boolean).join(' ').toLowerCase();

  if (!jobIndustry && !jobDomain) {
    return { score: 70, exactMatch: false, domainRelevant: true };
  }

  const jobIndustryLower = jobIndustry.toLowerCase();
  const exactMatch = candidateText.includes(jobIndustryLower);

  const jobGroup = getIndustryGroup(jobIndustry);
  const candidateGroup = getIndustryGroup(candidateText);

  const domainRelevant = jobGroup && candidateGroup
    ? jobGroup === candidateGroup
    : exactMatch;

  let score = 40;
  if (exactMatch) score += 40;
  else if (domainRelevant) score += 25;

  if (jobDomain && candidateText.includes(jobDomain.toLowerCase())) {
    score += 15;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    exactMatch,
    domainRelevant,
  };
}
