import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const CERTIFICATION_PROMPT_VERSION = PROMPT_VERSIONS.certification;

export function buildCertificationPrompt(ctx: ValidationContext): string {
  return `Validate this certification field extracted from a resume.

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
- Standardize certification names: "AWS Solutions Architect" → "AWS Certified Solutions Architect"
- Keep official certification names
- If the certification is not a recognized credential, flag for review`;
}
