import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const COMPANY_PROMPT_VERSION = PROMPT_VERSIONS.company;

export function buildCompanyPrompt(ctx: ValidationContext): string {
  return `Validate this company name extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
COMPANY: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%
${ctx.alternatives.length > 0 ? `ALTERNATIVES: ${ctx.alternatives.join(', ')}` : ''}

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "experience.company",
  "originalValue": "${ctx.currentValue}",
  "suggestedValue": "<full company name or same>",
  "confidence": 0.0-1.0,
  "reason": "<brief explanation>",
  "action": "keep" | "replace" | "flag_for_review"
}

RULES:
- Expand common abbreviations: "MS" → "Microsoft", "GOOG" → "Google", "AMZN" → "Amazon"
- Keep legitimate short names: "IBM", "SAP", "HP" are fine
- If the company is a subsidiary, use the parent company name if more recognizable
- If uncertain about the company, flag for review`;
}
