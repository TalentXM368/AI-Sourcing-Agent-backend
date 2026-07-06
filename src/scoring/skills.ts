import type { SkillMatchResult } from '../types.js'

// ─── Skill Relationships Graph ────────────────────────────────

const SKILL_RELATIONSHIPS: Record<string, Set<string>> = {
  'machine learning': new Set(['ml', 'ai', 'deep learning', 'neural networks']),
  'deep learning': new Set(['machine learning', 'tensorflow', 'pytorch', 'neural networks']),
  'python': new Set(['django', 'flask', 'fastapi', 'pandas', 'numpy', 'scipy']),
  'java': new Set(['spring', 'spring boot']),
  'javascript': new Set(['typescript', 'react', 'angular', 'vue', 'nodejs', 'node.js']),
  'typescript': new Set(['javascript', 'react', 'angular', 'vue', 'nodejs']),
  'react': new Set(['javascript', 'typescript', 'next.js', 'nextjs', 'vue', 'angular']),
  'postgresql': new Set(['sql', 'postgres', 'database']),
  'mysql': new Set(['sql', 'database']),
  'mongodb': new Set(['nosql', 'database']),
  'aws': new Set(['ec2', 's3', 'lambda', 'cloud']),
  'gcp': new Set(['google cloud', 'cloud']),
  'azure': new Set(['microsoft cloud', 'cloud']),
  'docker': new Set(['kubernetes', 'k8s', 'containers']),
  'kubernetes': new Set(['docker', 'k8s', 'containers']),
  'rest': new Set(['rest api', 'restful', 'api']),
  'graphql': new Set(['api', 'rest']),
  'node.js': new Set(['nodejs', 'express', 'javascript', 'typescript']),
  'pytorch': new Set(['deep learning', 'machine learning', 'torch']),
  'tensorflow': new Set(['deep learning', 'machine learning', 'keras']),
}

// ─── Normalize Skill Name ─────────────────────────────────────

function normalize(skill: string): string {
  return skill
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\+\#\.]/g, '')
    .replace(/js$/, 'js')
    .replace(/typescript$/, 'ts')
}

// ─── Check Related Skills ─────────────────────────────────────

function getRelatedSkills(skill: string): Set<string> {
  return SKILL_RELATIONSHIPS[skill] || new Set()
}

function isRelatedSkill(jdSkill: string, candSkill: string): boolean {
  const related = getRelatedSkills(normalize(jdSkill))
  if (related.has(normalize(candSkill))) return true

  const candRelated = getRelatedSkills(normalize(candSkill))
  if (candRelated.has(normalize(jdSkill))) return true

  // Check shared tokens (e.g., "rest api" and "rest")
  const jdTokens = new Set(normalize(jdSkill).split(/\s+/))
  const candTokens = new Set(normalize(candSkill).split(/\s+/))
  const shared = [...jdTokens].filter(t => candTokens.has(t))
  if (shared.length > 0 && shared.some(t => t.length > 2)) return true

  return false
}

// ─── Skill Score Calculation ──────────────────────────────────

export function computeSkillScore(
  jdSkills: string[],
  candidateSkills: string[]
): SkillMatchResult {
  if (jdSkills.length === 0) {
    return { score: 50, exact: [], semantic: [], missing: [] }
  }

  const normalizedCandidateSkills = new Set(candidateSkills.map(s => normalize(s)))
  const exact: string[] = []
  const semantic: string[] = []
  const missing: string[] = []

  for (const jdSkill of jdSkills) {
    const normalizedJd = normalize(jdSkill)

    // Level 1: Exact match
    if (normalizedCandidateSkills.has(normalizedJd)) {
      exact.push(jdSkill)
      continue
    }

    // Level 2: Related skill match
    let foundRelated = false
    for (const candSkill of candidateSkills) {
      if (isRelatedSkill(jdSkill, candSkill)) {
        semantic.push(jdSkill)
        foundRelated = true
        break
      }
    }

    if (foundRelated) continue

    // Level 3: No match
    missing.push(jdSkill)
  }

  // Calculate scores
  const total = jdSkills.length
  const exactScore = exact.length / total
  const semanticScore = (exact.length + semantic.length) / total
  const combined = 0.75 * exactScore + 0.25 * semanticScore

  // Band mapping (sharpens the distribution)
  let score: number
  if (exactScore >= 1.0) score = 98
  else if (exactScore >= 0.8) score = 88
  else if (exactScore >= 0.6) score = 72
  else if (semanticScore >= 0.6) score = 50
  else if (combined > 0) score = Math.max(12, combined * 60)
  else score = 3

  return { score, exact, semantic, missing }
}
