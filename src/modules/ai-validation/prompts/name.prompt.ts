import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const NAME_PROMPT_VERSION = PROMPT_VERSIONS.name;

export function buildNamePrompt(ctx: ValidationContext): string {
  return `Validate this candidate name extracted from a resume.

CANDIDATE NAME: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%
${ctx.alternatives.length > 0 ? `ALTERNATIVES FOUND: ${ctx.alternatives.join(', ')}` : ''}

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "personal.name",
  "originalValue": "${ctx.currentValue}",
  "suggestedValue": "<corrected name or same>",
  "confidence": 0.0-1.0,
  "reason": "<brief explanation>",
  "action": "keep" | "replace" | "flag_for_review"
}

RULES:
- Names should be properly capitalized (e.g., "John Doe" not "john doe")
- If the name contains title prefixes like "Dr." or "Prof.", keep them
- If the name seems corrupted or is "Unknown", flag for review
- If you see multiple name variants in alternatives, pick the most complete one`;
}
