import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const PROJECT_PROMPT_VERSION = PROMPT_VERSIONS.project;

export function buildProjectPrompt(ctx: ValidationContext): string {
  return `Validate this project field extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
FIELD: ${ctx.fieldName}
CURRENT VALUE: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%

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
- Project names should be properly formatted
- Descriptions should be clear and concise
- Do not fabricate project details
- If the project seems incomplete, flag for review`;
}
