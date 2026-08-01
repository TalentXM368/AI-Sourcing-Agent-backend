import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const EDUCATION_PROMPT_VERSION = PROMPT_VERSIONS.education;

export function buildEducationPrompt(ctx: ValidationContext): string {
  return `Validate this education field extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
FIELD: ${ctx.fieldName}
CURRENT VALUE: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%
${ctx.alternatives.length > 0 ? `ALTERNATIVES: ${ctx.alternatives.join(', ')}` : ''}

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "${ctx.fieldName}",
  "originalValue": "${ctx.currentValue}",
  "suggestedValue": "<corrected value or same>",
  "confidence": 0.0-1.0,
  "reason": "<brief explanation>",
  "action": "keep" | "replace" | "flag_for_review"
}

RULES:
- Standardize degree names: "B.S." → "Bachelor of Science", "M.Tech" → "Master of Technology"
- Keep university names as-is unless clearly wrong
- Specializations should be properly capitalized
- If the degree level is unclear, flag for review`;
}
