import type { ExtractedSkill } from '../types/extracted.types.js';
import { SKILL_ALIASES, SKILL_CATEGORIES } from '../constants/skill-aliases.js';

export function normalizeSkills(skills: ExtractedSkill[]): ExtractedSkill[] {
  const normalized = new Map<string, ExtractedSkill>();

  for (const skill of skills) {
    const canonical = SKILL_ALIASES[skill.normalized.toLowerCase()] || skill.normalized.toLowerCase();
    const category = SKILL_CATEGORIES[canonical] || skill.category;

    if (!normalized.has(canonical)) {
      normalized.set(canonical, {
        ...skill,
        normalized: canonical,
        category,
      });
    } else {
      // Keep higher confidence
      const existing = normalized.get(canonical)!;
      if (skill.confidence.score > existing.confidence.score) {
        normalized.set(canonical, {
          ...skill,
          normalized: canonical,
          category,
        });
      }
    }
  }

  return Array.from(normalized.values());
}
