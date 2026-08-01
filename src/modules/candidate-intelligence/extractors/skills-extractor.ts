import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedSkill } from '../types/extracted.types.js';
import { SKILL_CATEGORIES, SKILL_ALIASES } from '../constants/skill-aliases.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';

function classifySkill(raw: string): { canonical: string; category: string } {
  const lower = raw.toLowerCase().trim();
  const aliased = SKILL_ALIASES[lower] || lower;
  const category = SKILL_CATEGORIES[aliased] || 'unknown';
  return { canonical: aliased, category };
}

function extractKeywordSkills(text: string): ExtractedSkill[] {
  const found = new Map<string, ExtractedSkill>();
  const lower = text.toLowerCase();

  for (const [skill, category] of Object.entries(SKILL_CATEGORIES)) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = skill.length <= 3
      ? new RegExp(`\\b${escaped}\\b`, 'i')
      : new RegExp(escaped, 'i');

    if (regex.test(lower) && !found.has(skill)) {
      found.set(skill, {
        raw: skill,
        normalized: skill,
        category,
        sourceSection: 'document',
        confidence: mediumConfidence(`Keyword match: ${skill}`),
      });
    }
  }

  return Array.from(found.values());
}

function extractContextualSkills(text: string): ExtractedSkill[] {
  const contextPatterns = [
    /(?:used|experience with|proficient in|skilled in|knowledge of|familiar with|hands-on experience with|expertise in|working with|background in)\s+([\w\s,\/+#.]+?)(?:\.|,|\n|$)/gi,
    /(?:technologies?|tools?|stack|languages?)[:\s]+([\w\s,\/+#.]+?)(?:\.|,|\n|$)/gi,
  ];
  const found = new Map<string, ExtractedSkill>();

  for (const pattern of contextPatterns) {
    for (const match of text.matchAll(pattern)) {
      const parts = match[1].split(/[,\/&]/).map(s => s.trim().toLowerCase());
      for (const part of parts) {
        for (const [skill, category] of Object.entries(SKILL_CATEGORIES)) {
          if (part.includes(skill) && !found.has(skill)) {
            found.set(skill, {
              raw: skill,
              normalized: skill,
              category,
              sourceSection: 'contextual',
              confidence: mediumConfidence(`Contextual match in: ${match[0].slice(0, 50)}`),
            });
          }
        }
      }
    }
  }

  return Array.from(found.values());
}

function extractFromSection(section: ProcessedSection): ExtractedSkill[] {
  const skills: ExtractedSkill[] = [];
  const lines = section.content.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Bullet points or comma-separated skills
    const parts = line.split(/[,•\-|]/).map(p => p.trim()).filter(p => p.length > 1 && p.length < 40);
    for (const part of parts) {
      const { canonical, category } = classifySkill(part);
      if (category !== 'unknown') {
        skills.push({
          raw: part,
          normalized: canonical,
          category,
          sourceSection: section.normalizedName,
          confidence: mediumConfidence(`Skill section match: ${part}`),
        });
      }
    }
  }

  return skills;
}

export function extractSkills(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedSkill[] {
  const skillSection = sections.find(s => s.normalizedName === 'skills');

  const allSkills = new Map<string, ExtractedSkill>();

  // Priority 1: explicit skill section
  if (skillSection) {
    for (const skill of extractFromSection(skillSection)) {
      allSkills.set(skill.normalized, skill);
    }
  }

  // Priority 2: keyword matching across full text
  for (const skill of extractKeywordSkills(fullText)) {
    if (!allSkills.has(skill.normalized)) {
      allSkills.set(skill.normalized, skill);
    }
  }

  // Priority 3: contextual extraction
  for (const skill of extractContextualSkills(fullText)) {
    if (!allSkills.has(skill.normalized)) {
      allSkills.set(skill.normalized, skill);
    }
  }

  return Array.from(allSkills.values()).slice(0, 50);
}
