import { SKILL_ALIASES } from '../../candidate-intelligence/constants/skill-aliases.js';

const canonicalToAliasesMap = new Map<string, string[]>();

function buildReverseMap(): void {
  for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
    const canonicalLower = canonical.toLowerCase();
    const existing = canonicalToAliasesMap.get(canonicalLower) || [];
    existing.push(alias.toLowerCase());
    canonicalToAliasesMap.set(canonicalLower, existing);
  }
}

buildReverseMap();

export function getAliasesForCanonical(canonical: string): string[] {
  return canonicalToAliasesMap.get(canonical.toLowerCase()) || [];
}

export function hasAliasForCanonical(canonical: string, candidateSkill: string): boolean {
  const aliases = canonicalToAliasesMap.get(canonical.toLowerCase());
  if (!aliases) return false;
  return aliases.includes(candidateSkill.toLowerCase());
}

export function findCanonicalFromAlias(alias: string): string | null {
  const canonical = SKILL_ALIASES[alias.toLowerCase() as keyof typeof SKILL_ALIASES];
  return canonical || null;
}
