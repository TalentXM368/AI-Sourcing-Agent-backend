import type { ShortlistedCandidate } from '../types/input.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { RecommendationReasoning } from '../types/evaluation.types.js';
import { deriveRecommendation } from './score-adjustment.js';

export function buildReasoning(
  candidate: ShortlistedCandidate,
  jobProfile: JobProfile,
  displayScore: number,
  aiInsights: {
    explanation: string;
    summary: string;
    whyStandsOut: string[];
    risks: string[];
    careerStability: string;
    careerProgression: string;
    domainExpertise: string;
    leadershipIndicators: string;
    interviewFocus: string[];
    learningCurve: string;
    teamFit: string;
    availability: string;
    salaryFit: string;
  },
): RecommendationReasoning {
  const totalYears = candidate.candidateProfile.experience.reduce((sum, e) => sum + e.durationMonths, 0) / 12;
  const confidence = candidate.confidence;

  const recommendation = deriveRecommendation(displayScore, confidence);

  const currentRole = candidate.candidateProfile.experience.find(e => e.isCurrent);
  const experienceStr = currentRole
    ? `${totalYears.toFixed(1)} years (currently: ${currentRole.title.value} at ${currentRole.company.value})`
    : `${totalYears.toFixed(1)} years`;

  const educationStr = candidate.candidateProfile.education.length > 0
    ? candidate.candidateProfile.education.map(e => `${e.degree.value}${e.specialization?.value ? ` in ${e.specialization.value}` : ''}`).join(', ')
    : 'Not specified';

  const locationParts = [
    candidate.candidateProfile.contact.city?.value,
    candidate.candidateProfile.contact.state?.value,
    candidate.candidateProfile.contact.country?.value,
  ].filter(Boolean);
  const locationStr = locationParts.length > 0 ? locationParts.join(', ') : 'Not specified';

  return {
    recommendation,
    explanation: aiInsights.explanation,
    matchedSkills: candidate.matchedSkills.length,
    requiredSkills: jobProfile.requiredSkills.length,
    experience: experienceStr,
    education: educationStr,
    industry: jobProfile.industry?.value || 'Not specified',
    location: locationStr,
    summary: aiInsights.summary,
    whyCandidateStandsOut: aiInsights.whyStandsOut,
    potentialRisks: aiInsights.risks,
    careerStability: aiInsights.careerStability,
    careerProgression: aiInsights.careerProgression,
    domainExpertise: aiInsights.domainExpertise,
    leadershipIndicators: aiInsights.leadershipIndicators,
    suggestedInterviewFocus: aiInsights.interviewFocus,
    learningCurve: aiInsights.learningCurve,
    teamFit: aiInsights.teamFit,
    availabilityNoticePeriod: aiInsights.availability,
    salaryFit: aiInsights.salaryFit,
  };
}
