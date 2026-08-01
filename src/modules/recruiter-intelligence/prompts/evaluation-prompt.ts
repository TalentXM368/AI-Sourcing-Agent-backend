import { BASE_SYSTEM_PROMPT } from './base-prompt.js';
import type { ShortlistedCandidate } from '../types/input.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export function buildEvaluationPrompt(
  jobProfile: JobProfile,
  candidate: ShortlistedCandidate,
  crossEncoderScore: number,
  crossEncoderAdjustment: number,
  displayScore: number,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

## Your Task
Analyze this candidate-job match and generate a comprehensive recruiter evaluation.

## Rules
- NEVER invent or modify the matchScore — it comes from the Matching Engine
- The displayScore is already calculated: matchScore + crossEncoderAdjustment = displayScore
- Base your reasoning ONLY on the provided data
- Be specific: reference actual skills, companies, years of experience
- If information is missing, say so explicitly
- Recommend specific interview topics based on gaps

## Response Schema
Respond with valid JSON matching this structure:
{
  "cardSummary": "2-3 sentence recruiter summary for candidate card display",
  "detailSummary": {
    "overallFit": "Overall fit assessment",
    "whyMatched": "Why this candidate matches the role",
    "missingRequirements": "What requirements are not met",
    "potentialRisks": "Risks associated with hiring this candidate",
    "keyStrengths": "Key strengths of this candidate",
    "interviewFocus": "What to focus on during interviews",
    "finalRecommendation": "Final recommendation with reasoning"
  },
  "reasoning": {
    "recommendation": "Strong Hire | Good Hire | Consider | Maybe | Not Recommended",
    "explanation": "Detailed explanation of recommendation",
    "summary": "Brief summary of the match",
    "whyCandidateStandsOut": ["reason1", "reason2"],
    "potentialRisks": ["risk1", "risk2"],
    "careerStability": "Assessment of career stability",
    "careerProgression": "Assessment of career progression",
    "domainExpertise": "Assessment of domain expertise",
    "leadershipIndicators": "Leadership potential indicators",
    "suggestedInterviewFocus": ["topic1", "topic2"],
    "learningCurve": "Expected learning curve",
    "teamFit": "Team fit assessment",
    "availabilityNoticePeriod": "Availability and notice period assessment",
    "salaryFit": "Salary fit assessment if information available"
  }
}`;

  const userPrompt = `## Job Profile
${JSON.stringify({
    title: jobProfile.title.value,
    company: jobProfile.company.value,
    industry: jobProfile.industry.value,
    seniority: jobProfile.seniority.value,
    employmentType: jobProfile.employmentType.value,
    workMode: jobProfile.workMode.value,
    experience: {
      min: jobProfile.experience.minimumYears?.value,
      max: jobProfile.experience.maximumYears?.value,
    },
    requiredSkills: jobProfile.requiredSkills.map(s => s.canonical),
    preferredSkills: jobProfile.preferredSkills.map(s => s.canonical),
    location: {
      city: jobProfile.location.city?.value,
      state: jobProfile.location.state?.value,
      country: jobProfile.location.country?.value,
    },
    salary: {
      min: jobProfile.salary.minimum?.value,
      max: jobProfile.salary.maximum?.value,
      currency: jobProfile.salary.currency?.value,
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

## Deterministic Scores (from Matching Engine — DO NOT override)
- Match Score: ${candidate.matchScore}%
- Skill Score: ${candidate.skillScore}%
- Experience Score: ${candidate.experienceScore}%
- Education Score: ${candidate.educationScore}%
- Location Score: ${candidate.locationScore}%
- Industry Score: ${candidate.industryScore}%
- Matched Skills (${candidate.matchedSkills.length}): ${candidate.matchedSkills.join(', ')}
- Missing Skills (${candidate.missingSkills.length}): ${candidate.missingSkills.join(', ')}
- Additional Skills: ${candidate.additionalSkills.join(', ')}

## Cross-Encoder Analysis
- Raw Cross-Encoder Score: ${crossEncoderScore.toFixed(4)}
- Score Adjustment: ${crossEncoderAdjustment >= 0 ? '+' : ''}${crossEncoderAdjustment}%
- Final Display Score: ${displayScore}%

## Instructions
Generate a comprehensive recruiter evaluation with:
1. cardSummary: 2-3 sentence summary for candidate card display
2. detailSummary: Detailed assessment for candidate detail page
3. reasoning: Structured reasoning with all fields populated

Be specific, reference actual data, and provide actionable insights for recruiters.`;

  return { systemPrompt, userPrompt };
}

export function buildBatchEvaluationPrompt(
  jobProfile: JobProfile,
  candidates: ShortlistedCandidate[],
  crossEncoderScores: Map<string, { rawScore: number; adjustment: number; displayScore: number }>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

## Your Task
Analyze these candidate-job matches and generate comprehensive recruiter evaluations for each candidate.

## Rules
- NEVER invent or modify matchScores — they come from the Matching Engine
- displayScore = matchScore + crossEncoderAdjustment for each candidate
- Base ALL reasoning on provided data only
- Be specific: reference actual skills, companies, years of experience
- If information is missing, state it explicitly

## Response Schema
Respond with valid JSON matching this structure:
{
  "evaluations": [
    {
      "candidateId": "uuid",
      "cardSummary": "2-3 sentence summary",
      "detailSummary": {
        "overallFit": "...",
        "whyMatched": "...",
        "missingRequirements": "...",
        "potentialRisks": "...",
        "keyStrengths": "...",
        "interviewFocus": "...",
        "finalRecommendation": "..."
      },
      "reasoning": {
        "recommendation": "Strong Hire | Good Hire | Consider | Maybe | Not Recommended",
        "explanation": "...",
        "summary": "...",
        "whyCandidateStandsOut": ["..."],
        "potentialRisks": ["..."],
        "careerStability": "...",
        "careerProgression": "...",
        "domainExpertise": "...",
        "leadershipIndicators": "...",
        "suggestedInterviewFocus": ["..."],
        "learningCurve": "...",
        "teamFit": "...",
        "availabilityNoticePeriod": "...",
        "salaryFit": "..."
      }
    }
  ]
}`;

  const candidatesData = candidates.map(c => {
    const scores = crossEncoderScores.get(c.candidateProfile.candidateId) || { rawScore: 0.5, adjustment: 0, displayScore: c.matchScore };
    return {
      candidateId: c.candidateProfile.candidateId,
      name: c.candidateProfile.personal.name.value,
      headline: c.candidateProfile.personal.headline?.value,
      summary: c.candidateProfile.personal.summary,
      skills: c.candidateProfile.skills.map(s => s.canonical),
      experience: c.candidateProfile.experience.map(e => ({
        company: e.company.value,
        title: e.title.value,
        durationMonths: e.durationMonths,
        isCurrent: e.isCurrent,
      })),
      education: c.candidateProfile.education.map(e => ({
        degree: e.degree.value,
        specialization: e.specialization?.value,
        university: e.university.value,
      })),
      location: {
        city: c.candidateProfile.contact.city?.value,
        state: c.candidateProfile.contact.state?.value,
        country: c.candidateProfile.contact.country?.value,
      },
      scores: {
        matchScore: c.matchScore,
        skillScore: c.skillScore,
        experienceScore: c.experienceScore,
        educationScore: c.educationScore,
        locationScore: c.locationScore,
        industryScore: c.industryScore,
      },
      matchedSkills: c.matchedSkills,
      missingSkills: c.missingSkills,
      crossEncoder: {
        rawScore: scores.rawScore,
        adjustment: scores.adjustment,
        displayScore: scores.displayScore,
      },
    };
  });

  const userPrompt = `## Job Profile
${JSON.stringify({
    title: jobProfile.title.value,
    company: jobProfile.company.value,
    industry: jobProfile.industry.value,
    seniority: jobProfile.seniority.value,
    requiredSkills: jobProfile.requiredSkills.map(s => s.canonical),
    preferredSkills: jobProfile.preferredSkills.map(s => s.canonical),
    location: {
      city: jobProfile.location.city?.value,
      state: jobProfile.location.state?.value,
      country: jobProfile.location.country?.value,
    },
  }, null, 2)}

## Candidates (${candidates.length})
${JSON.stringify(candidatesData, null, 2)}

## Instructions
For each candidate, generate:
1. cardSummary: 2-3 sentence summary for candidate card display
2. detailSummary: Detailed assessment for candidate detail page
3. reasoning: Structured reasoning with all fields populated

Be specific, reference actual data, and provide actionable insights for recruiters.`;

  return { systemPrompt, userPrompt };
}
