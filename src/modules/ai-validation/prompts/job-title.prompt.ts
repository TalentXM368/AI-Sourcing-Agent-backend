import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const JOB_TITLE_PROMPT_VERSION = PROMPT_VERSIONS.jobTitle;

export function buildJobTitlePrompt(ctx: ValidationContext): string {
  return `Validate this job title extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
JOB TITLE: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%
${ctx.alternatives.length > 0 ? `ALTERNATIVES: ${ctx.alternatives.join(', ')}` : ''}

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "experience.title",
  "originalValue": "${ctx.currentValue}",
  "suggestedValue": "<standardized title or same>",
  "confidence": 0.0-1.0,
  "reason": "<brief explanation>",
  "action": "keep" | "replace" | "flag_for_review"
}

RULES:
- Standardize common title variations: "Sr. Software Eng" → "Senior Software Engineer"
- "SWE" → "Software Engineer", "FSD" → "Full Stack Developer"
- Preserve role-specific titles like "DevOps Engineer", "SRE", "ML Engineer"
- If the title seems non-standard or ambiguous, flag for review`;
}
