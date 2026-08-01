import { BASE_SYSTEM_PROMPT } from './base-prompt.js';
import type { ShortlistedCandidate } from '../types/input.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export function buildDetailSummaryPrompt(
  jobProfile: JobProfile,
  candidate: ShortlistedCandidate,
  crossEncoderScore: number,
  displayScore: number,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

## Your Task
Generate a detailed recruiter explanation for the candidate detail page.

## Rules
- Include: overall fit, why matched, missing requirements, potential risks, key strengths, interview focus, final recommendation
- Be specific: reference actual skills, companies, experience
- Actionable: recruiter should be able to make a decision
- Base ONLY on provided data

## Response Schema
Respond with valid JSON:
{
  "detailSummary": {
    "overallFit": "Overall fit assessment",
    "whyMatched": "Why this candidate matches the role",
    "missingRequirements": "What requirements are not met",
    "potentialRisks": "Risks associated with hiring this candidate",
    "keyStrengths": "Key strengths of this candidate",
    "interviewFocus": "What to focus on during interviews",
    "finalRecommendation": "Final recommendation with reasoning"
  }
}`;

  const totalYears = candidate.candidateProfile.experience.reduce((sum, e) => sum + e.durationMonths, 0) / 12;

  const userPrompt = `## Job Profile
${JSON.stringify({
    title: jobProfile.title.value,
    company: jobProfile.company.value,
    industry: jobProfile.industry.value,
    seniority: jobProfile.seniority.value,
    requiredSkills: jobProfile.requiredSkills.map(s => s.canonical),
    preferredSkills: jobProfile.preferredSkills.map(s => s.canonical),
    experience: {
      min: jobProfile.experience.minimumYears?.value,
      max: jobProfile.experience.maximumYears?.value,
    },
    location: {
      city: jobProfile.location.city?.value,
      state: jobProfile.location.state?.value,
      country: jobProfile.location.country?.value,
    },
  }, null, 2)}

## Candidate Profile
${JSON.stringify({
    name: candidate.candidateProfile.personal.name.value,
    headline: candidate.candidateProfile.personal.headline?.value,
    summary: candidate.candidateProfile.personal.summary,
    skills: candidate.candidateProfile.skills.map(s => s.canonical),
    experience: candidate.candidateProfile.experience.map(e => ({
      company: e.company.value,
      title: e.title.value,
      durationMonths: e.durationMonths,
      isCurrent: e.isCurrent,
      responsibilities: e.responsibilities,
    })),
    education: candidate.candidateProfile.education.map(e => ({
      degree: e.degree.value,
      specialization: e.specialization?.value,
      university: e.university.value,
    })),
    location: {
      city: candidate.candidateProfile.contact.city?.value,
      state: candidate.candidateProfile.contact.state?.value,
      country: candidate.candidateProfile.contact.country?.value,
    },
  }, null, 2)}

## Match Analysis
- Total Experience: ${totalYears.toFixed(1)} years
- Match Score: ${candidate.matchScore}%
- Display Score: ${displayScore}%
- Cross-Encoder Score: ${crossEncoderScore.toFixed(4)}
- Matched Skills (${candidate.matchedSkills.length}): ${candidate.matchedSkills.join(', ')}
- Missing Skills (${candidate.missingSkills.length}): ${candidate.missingSkills.join(', ')}
- Skill Score: ${candidate.skillScore}%
- Experience Score: ${candidate.experienceScore}%
- Education Score: ${candidate.educationScore}%

Generate a detailed recruiter summary with all sections.`;

  return { systemPrompt, userPrompt };
}
