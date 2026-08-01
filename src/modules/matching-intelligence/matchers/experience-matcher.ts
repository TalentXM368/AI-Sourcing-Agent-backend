import type { ExperienceMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';

const SENIORITY_MAP: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  principal: 5,
  staff: 5,
  director: 6,
  vp: 7,
  'c-level': 8,
  executive: 8,
};

function getCandidateTotalYears(candidate: CandidateProfile): number {
  const totalMonths = candidate.experience.reduce((sum, exp) => sum + exp.durationMonths, 0);
  return Math.round((totalMonths / 12) * 10) / 10;
}

function detectSeniority(title: string): number {
  const lower = title.toLowerCase();
  for (const [level, score] of Object.entries(SENIORITY_MAP)) {
    if (lower.includes(level)) return score;
  }
  return 2;
}

function hasDomainRelevance(candidate: CandidateProfile, job: JobProfile): boolean {
  const jobIndustry = job.industry.value?.toLowerCase() || '';
  const candidateSummary = candidate.personal.summary?.toLowerCase() || '';
  const candidateHeadline = candidate.personal.headline?.value?.toLowerCase() || '';
  const candidateText = `${candidateSummary} ${candidateHeadline}`;

  if (!jobIndustry) return true;

  const industryKeywords: Record<string, string[]> = {
    technology: ['software', 'tech', 'engineering', 'developer', 'engineer'],
    healthcare: ['health', 'medical', 'clinical', 'hospital'],
    finance: ['finance', 'banking', 'financial', 'trading'],
    retail: ['retail', 'ecommerce', 'consumer', 'commerce'],
    education: ['education', 'teaching', 'academic', 'learning'],
  };

  const keywords = industryKeywords[jobIndustry] || [];
  return keywords.some(k => candidateText.includes(k));
}

export function matchExperience(
  job: JobProfile,
  candidate: CandidateProfile,
): ExperienceMatchResult {
  const totalYears = getCandidateTotalYears(candidate);

  const minRequired = job.experience.minimumYears?.value
    ? parseInt(job.experience.minimumYears.value, 10) || 0
    : 0;
  const maxPreferred = job.experience.maximumYears?.value
    ? parseInt(job.experience.maximumYears.value, 10) || 99
    : 99;

  const meetsMinimum = totalYears >= minRequired;
  const withinPreferred = totalYears <= maxPreferred;

  const jobSeniority = detectSeniority(job.title.value);
  const candidateSeniority = candidate.experience.length > 0
    ? detectSeniority(candidate.experience[0].title.value)
    : 0;
  const seniorityMatch = Math.abs(jobSeniority - candidateSeniority) <= 1;

  const domainRelevant = hasDomainRelevance(candidate, job);

  let score = 50;

  if (meetsMinimum) {
    score += 30;
    if (withinPreferred) score += 10;
    else score += 5;
  } else {
    const deficit = minRequired - totalYears;
    score -= deficit * 10;
  }

  if (seniorityMatch) score += 10;
  if (domainRelevant) score += 5;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    totalYears,
    meetsMinimum,
    seniorityMatch,
    domainRelevant,
  };
}
