import { BASE_SYSTEM_PROMPT } from './base-prompt.js';
import type { ShortlistedCandidate } from '../types/input.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export function buildCardSummaryPrompt(
  jobProfile: JobProfile,
  candidate: ShortlistedCandidate,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

## Your Task
Generate a very short recruiter summary (maximum 2-3 sentences) for display on a candidate card.

## Rules
- Maximum 2-3 sentences
- Include: role, key experience, skill match, recommendation
- Be specific: mention actual skills and years
- Actionable: recruiter should understand fit at a glance

## Response Schema
Respond with valid JSON:
{
  "cardSummary": "The 2-3 sentence summary"
}`;

  const totalYears = candidate.candidateProfile.experience.reduce((sum, e) => sum + e.durationMonths, 0) / 12;

  const userPrompt = `## Job
${jobProfile.title.value} at ${jobProfile.company.value}
Required Skills: ${jobProfile.requiredSkills.map(s => s.canonical).join(', ')}

## Candidate
${candidate.candidateProfile.personal.name.value}
${candidate.candidateProfile.personal.headline?.value || ''}
Experience: ${totalYears.toFixed(1)} years
Skills: ${candidate.candidateProfile.skills.map(s => s.canonical).join(', ')}

## Match Data
Matched ${candidate.matchedSkills.length} of ${jobProfile.requiredSkills.length} required skills
Missing: ${candidate.missingSkills.join(', ') || 'None'}
Match Score: ${candidate.matchScore}%

Generate a 2-3 sentence card summary.`;

  return { systemPrompt, userPrompt };
}
