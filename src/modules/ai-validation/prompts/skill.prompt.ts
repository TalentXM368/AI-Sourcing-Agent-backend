import type { ValidationContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const SKILL_PROMPT_VERSION = PROMPT_VERSIONS.skill;

export function buildSkillPrompt(ctx: ValidationContext): string {
  return `Validate and normalize this list of skills extracted from a resume.

CANDIDATE NAME: ${ctx.candidateName}
CURRENT SKILLS: ${ctx.currentValue}
CONFIDENCE: ${(ctx.confidence * 100).toFixed(0)}%

RELEVANT RESUME SECTION:
${ctx.nearbyText}

Return JSON:
{
  "fieldName": "skills",
  "skills": [
    { "value": "<normalized skill name>", "confidence": 0.0-1.0, "action": "keep" | "replace" | "flag_for_review" }
  ],
  "reason": "<brief explanation>"
}

RULES:
- Normalize skill names: "react.js" → "React", "node.js" → "Node.js", "typescript" → "TypeScript"
- Keep industry-standard capitalization: "JavaScript", "Python", "PostgreSQL"
- Remove duplicates or near-duplicates
- Flag uncertain or ambiguous skills for review
- Do not add skills that are not in the original list`;
}
