import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const LANGUAGE_PROMPT_VERSION = PROMPT_VERSIONS.language;

export function buildLanguagePrompt(ctx: ValidationContext): string {
  return `Validate this language extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
LANGUAGE: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "languages.name",
  "originalValue": "${ctx.currentValue}",
  "suggestedValue": "<corrected language name or same>",
  "confidence": 0.0-1.0,
  "reason": "<brief explanation>",
  "action": "keep" | "replace" | "flag_for_review"
}

RULES:
- Language names should be properly capitalized: "english" → "English", "spanish" → "Spanish"
- Keep the language name in its original form
- If the entry is not a language, flag for review`;
}
