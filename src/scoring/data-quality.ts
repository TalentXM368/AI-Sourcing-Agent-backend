import type { ParsedCandidate } from '../types.js'

export interface DataQualityResult {
  quality_score: number
  completeness: Record<string, boolean>
  missing_fields: string[]
}

const VALID_NAME_PATTERNS = /^(?!unknown$|n\/a$|test$|sample$)/i

function isValidName(name: string | null | undefined): boolean {
  if (!name || name.length < 2) return false
  if (!VALID_NAME_PATTERNS.test(name)) return false
  if (name.length > 60) return false
  return /[a-zA-Z]/.test(name)
}

export function computeDataQuality(candidate: ParsedCandidate): DataQualityResult {
  const completeness: Record<string, boolean> = {}
  const missing_fields: string[] = []

  const checks = [
    { field: 'name', score: 5, check: () => isValidName(candidate.name) },
    { field: 'email', score: 10, check: () => !!candidate.email && candidate.email.trim().length > 5 },
    { field: 'phone', score: 10, check: () => !!candidate.phone && candidate.phone.trim().length >= 7 },
    { field: 'linkedin_url', score: 10, check: () => !!candidate.linkedin_url && candidate.linkedin_url.trim().length > 10 },
    { field: 'headline', score: 10, check: () => !!candidate.headline && candidate.headline.trim().length > 3 },
    { field: 'location', score: 5, check: () => !!candidate.location && candidate.location.trim().length > 2 },
    { field: 'summary', score: 10, check: () => !!candidate.summary && candidate.summary.trim().length > 20 },
    { field: 'skills', score: 10, check: () => Array.isArray(candidate.skills) && candidate.skills.length >= 3 },
    { field: 'work_history', score: 15, check: () => {
      const wh = candidate.work_history
      if (!Array.isArray(wh) || wh.length === 0) return false
      const hasRealEntry = wh.some((e: any) => e.title && e.title !== 'Unknown' && e.company && e.company !== 'Unknown')
      return hasRealEntry
    }},
    { field: 'education', score: 10, check: () => {
      const edu = candidate.education
      if (!Array.isArray(edu) || edu.length === 0) return false
      const hasRealEntry = edu.some((e: any) => e.school && e.school !== 'Unknown' && e.school.length > 3)
      return hasRealEntry
    }},
    { field: 'resume_url', score: 5, check: () => !!candidate.resume_url && candidate.resume_url.trim().length > 10 },
  ]

  let totalScore = 0

  for (const { field, score, check } of checks) {
    const passed = check()
    completeness[field] = passed
    if (passed) {
      totalScore += score
    } else {
      missing_fields.push(field)
    }
  }

  return {
    quality_score: Math.min(100, totalScore),
    completeness,
    missing_fields,
  }
}
