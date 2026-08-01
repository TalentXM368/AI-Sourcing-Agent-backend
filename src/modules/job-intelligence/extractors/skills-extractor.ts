import type { ProcessedSection, ExtractedJobSkills } from '../types/index.js';
import {
  SKILL_ALIASES,
  SKILL_CATEGORIES,
} from '../../candidate-intelligence/constants/skill-aliases.js';

export function extractJobSkills(sections: ProcessedSection[], fullText: string): ExtractedJobSkills {
  const requiredSection = findSkillSection(sections, ['requirements', 'skills']);
  const preferredSection = findSkillSection(sections, ['preferred']);

  const requiredFromSection = requiredSection
    ? extractSkillsFromSection(requiredSection.content)
    : [];
  const preferredFromSection = preferredSection
    ? extractSkillsFromSection(preferredSection.content)
    : [];

  const requiredFromText = extractSkillsFromKeywords(fullText);
  const allRequired = mergeSkills(requiredFromSection, requiredFromText);

  const preferredFromText = extractPreferredFromText(fullText);
  const allPreferred = mergeSkills(preferredFromSection, preferredFromText);

  const requiredNormalized = allRequired.map(s => normalizeSkill(s, 'requirements'));
  const preferredNormalized = allPreferred.map(s => normalizeSkill(s, 'preferred'));

  const requiredSet = new Set(requiredNormalized.map(s => s.canonical));
  const dedupedPreferred = preferredNormalized.filter(s => !requiredSet.has(s.canonical));

  const technologies = extractTechnologies(fullText);
  const tools = extractTools(fullText);

  return {
    requiredSkills: dedupSkills(requiredNormalized),
    preferredSkills: dedupSkills(dedupedPreferred),
    technologies,
    tools,
  };
}

function findSkillSection(sections: ProcessedSection[], types: string[]): ProcessedSection | null {
  for (const type of types) {
    const found = sections.find(s => s.normalizedName === type);
    if (found) return found;
  }
  return null;
}

function extractSkillsFromSection(content: string): string[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const skills: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-•*▪▸→]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    if (cleaned.length < 2 || cleaned.length > 80) continue;

    if (cleaned.includes(',')) {
      const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
      skills.push(...parts);
    } else {
      skills.push(cleaned);
    }
  }

  return skills;
}

function extractSkillsFromKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const [canonical] of Object.entries(SKILL_CATEGORIES)) {
    const pattern = new RegExp(`\\b${escapeRegex(canonical.toLowerCase())}\\b`, 'i');
    if (pattern.test(lower)) {
      found.push(canonical);
    }
  }

  for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
    const pattern = new RegExp(`\\b${escapeRegex(alias.toLowerCase())}\\b`, 'i');
    if (pattern.test(lower) && !found.includes(canonical)) {
      found.push(canonical);
    }
  }

  return found;
}

function extractPreferredFromText(text: string): string[] {
  const preferredPatterns = [
    /(?:nice to have|preferred|bonus|good to have|desired)[:\s]*([\s\S]*?)(?:(?:requirement|must have|required|about|benefits?)[:\s]|$)/i,
    /(?:preferred skills|preferred qualifications)[:\s]*([\s\S]*?)(?:(?:requirement|must have|required|about)[:\s]|$)/i,
  ];

  for (const pattern of preferredPatterns) {
    const match = text.match(pattern);
    if (match) {
      return extractSkillsFromSection(match[1]);
    }
  }

  return [];
}

function normalizeSkill(raw: string, sourceSection: string): {
  canonical: string;
  raw: string;
  category: string;
  confidence: number;
} {
  const lower = raw.toLowerCase().trim();
  const canonical = SKILL_ALIASES[lower] || lower;
  const category = SKILL_CATEGORIES[canonical] || SKILL_CATEGORIES[lower] || 'other';

  return {
    canonical,
    raw,
    category,
    confidence: 0.8,
  };
}

function mergeSkills(sectionSkills: string[], textSkills: string[]): string[] {
  const merged = new Map<string, string>();
  for (const s of sectionSkills) {
    const lower = s.toLowerCase().trim();
    merged.set(lower, s);
  }
  for (const s of textSkills) {
    const lower = s.toLowerCase().trim();
    if (!merged.has(lower)) merged.set(lower, s);
  }
  return Array.from(merged.values());
}

function dedupSkills(skills: Array<{ canonical: string; raw: string; category: string; confidence: number }>) {
  const seen = new Set<string>();
  return skills.filter(s => {
    if (seen.has(s.canonical)) return false;
    seen.add(s.canonical);
    return true;
  });
}

function extractTechnologies(text: string): string[] {
  const techPatterns = [
    /(?:tech(?:nologies)?|stack)[:\s]+([^\n]+)/i,
    /(?:built with|using|uses)[:\s]+([^\n]+)/i,
  ];

  const techs: string[] = [];
  for (const pattern of techPatterns) {
    const match = text.match(pattern);
    if (match) {
      const parts = match[1].split(/[,;|]/).map(p => p.trim()).filter(p => p.length > 1 && p.length < 50);
      techs.push(...parts);
    }
  }
  return [...new Set(techs)];
}

function extractTools(text: string): string[] {
  const toolKeywords = [
    'git', 'github', 'gitlab', 'jira', 'confluence', 'slack', 'notion',
    'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
    'visual studio', 'vs code', 'intellij', 'eclipse', 'xcode',
    'postman', 'swagger', 'datadog', 'grafana', 'kibana',
    'jenkins', 'circleci', 'travis', 'teamcity',
  ];

  const found: string[] = [];
  const lower = text.toLowerCase();

  for (const tool of toolKeywords) {
    if (lower.includes(tool)) {
      found.push(tool);
    }
  }

  return [...new Set(found)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
