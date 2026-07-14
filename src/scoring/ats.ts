import type { ParsedCandidate, ParsedJob } from '../types.js'

export interface AtsBreakdown {
  keyword_density: number
  required_skills: number
  experience_range: number
  contact_completeness: number
  section_structure: number
  recency: number
  education_presence: number
}

export interface AtsResult {
  ats_score: number
  breakdown: AtsBreakdown
  flags: string[]
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.#+]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

function keywordMatch(keyword: string, tokens: Set<string>, rawText: string): boolean {
  const normalized = keyword.toLowerCase().replace(/[^a-z0-9\s.#+]/g, '').trim()
  if (!normalized) return false

  // Exact token match
  if (tokens.has(normalized)) return true

  // Multi-word: all words present
  const words = normalized.split(/\s+/)
  if (words.length > 1 && words.every(w => tokens.has(w))) return true

  // Fuzzy: prefix match (e.g., "react" matches "reactjs", "react.js")
  for (const t of tokens) {
    if (t.startsWith(normalized) || normalized.startsWith(t)) return true
  }

  // Raw text substring (last resort)
  if (rawText.toLowerCase().includes(normalized)) return true

  return false
}

function getRecencyScore(workHistory: any[]): number {
  if (!workHistory || workHistory.length === 0) return 30

  const now = new Date()
  let latestEnd: Date | null = null

  for (const entry of workHistory) {
    if (entry.is_current) return 100

    const toStr = entry.to || entry.end_date || entry.to_date
    if (!toStr) {
      latestEnd = now
      break
    }

    const parsed = new Date(toStr)
    if (!isNaN(parsed.getTime())) {
      if (!latestEnd || parsed > latestEnd) {
        latestEnd = parsed
      }
    }
  }

  if (!latestEnd) return 50

  const diffYears = (now.getTime() - latestEnd.getTime()) / (365.25 * 24 * 60 * 60 * 1000)

  if (diffYears <= 1) return 100
  if (diffYears <= 2) return 85
  if (diffYears <= 3) return 70
  if (diffYears <= 5) return 50
  return 30
}

export function computeAtsScore(candidate: ParsedCandidate, job: ParsedJob): AtsResult {
  const flags: string[] = []
  const breakdown: AtsBreakdown = {
    keyword_density: 0,
    required_skills: 0,
    experience_range: 0,
    contact_completeness: 0,
    section_structure: 0,
    recency: 0,
    education_presence: 0,
  }

  const rawText = candidate.summary || ''
  const tokens = new Set(tokenize(rawText))

  // 1. Keyword Density (30%)
  const jdText = [job.description, ...(job.required_skills || []), ...(job.nice_to_have_skills || [])].filter(Boolean).join(' ')
  const jdTokens = tokenize(jdText)

  if (jdTokens.length > 0) {
    let matched = 0
    for (const jt of jdTokens) {
      if (tokens.has(jt) || Array.from(tokens).some(t => t.startsWith(jt) || jt.startsWith(t))) {
        matched++
      }
    }
    breakdown.keyword_density = Math.min(100, Math.round((matched / jdTokens.length) * 120))
  } else {
    breakdown.keyword_density = 50
  }

  // 2. Required Skills Match (25%)
  const requiredSkills = job.required_skills || []
  if (requiredSkills.length > 0) {
    const candidateSkills = (candidate.skills || []).map((s: any) => s.name?.toLowerCase() || '').filter(Boolean)
    const candidateSkillSet = new Set(candidateSkills)

    let exactHits = 0
    let fuzzyHits = 0
    const missingSkills: string[] = []

    for (const skill of requiredSkills) {
      const normalized = skill.toLowerCase()
      if (candidateSkillSet.has(normalized)) {
        exactHits++
      } else if (keywordMatch(skill, tokens, rawText) || candidateSkills.some(cs => cs.includes(normalized) || normalized.includes(cs))) {
        fuzzyHits++
      } else {
        missingSkills.push(skill)
      }
    }

    const total = requiredSkills.length
    const score = ((exactHits * 1.0 + fuzzyHits * 0.6) / total) * 100
    breakdown.required_skills = Math.min(100, Math.round(score))

    if (missingSkills.length > 0) {
      flags.push(`Missing required skills: ${missingSkills.slice(0, 3).join(', ')}${missingSkills.length > 3 ? ` +${missingSkills.length - 3} more` : ''}`)
    }
  } else {
    breakdown.required_skills = 60
  }

  // 3. Experience Range (15%)
  const yoe = candidate.experience_years
  if (yoe != null && (job.experience_min != null || job.experience_max != null)) {
    const min = job.experience_min ?? 0
    const max = job.experience_max ?? 99

    if (yoe >= min && yoe <= max) {
      breakdown.experience_range = 100
    } else if (yoe < min) {
      const gap = min - yoe
      breakdown.experience_range = Math.max(20, 100 - gap * 20)
      if (gap >= 2) flags.push(`Experience ${yoe}y is below minimum ${min}y`)
    } else {
      const over = yoe - max
      breakdown.experience_range = Math.max(40, 100 - over * 10)
    }
  } else {
    breakdown.experience_range = 60
  }

  // 4. Contact Completeness (10%)
  const contactFields = [
    { val: candidate.email, label: 'email' },
    { val: candidate.phone, label: 'phone' },
    { val: candidate.linkedin_url, label: 'LinkedIn' },
    { val: candidate.github_url, label: 'GitHub' },
  ]
  const present = contactFields.filter(f => f.val && f.val.trim()).length
  breakdown.contact_completeness = Math.round((present / contactFields.length) * 100)

  const missing = contactFields.filter(f => !f.val || !f.val.trim()).map(f => f.label)
  if (missing.length > 0 && missing.length <= 2) {
    flags.push(`Missing: ${missing.join(', ')}`)
  } else if (missing.length > 2) {
    flags.push('Incomplete contact information')
  }

  // 5. Section Structure (10%)
  const sections = [
    { val: candidate.work_history, label: 'Work history' },
    { val: candidate.education, label: 'Education' },
    { val: candidate.skills, label: 'Skills' },
  ]
  const populated = sections.filter(s => s.val && Array.isArray(s.val) && s.val.length > 0).length
  breakdown.section_structure = Math.round((populated / sections.length) * 100)

  const emptySections = sections.filter(s => !s.val || !Array.isArray(s.val) || s.val.length === 0)
  if (emptySections.length > 0) {
    flags.push(`Missing sections: ${emptySections.map(s => s.label).join(', ')}`)
  }

  // 6. Recency (5%)
  breakdown.recency = getRecencyScore(candidate.work_history || [])

  // 7. Education Presence (5%)
  const hasEdu = candidate.education && Array.isArray(candidate.education) && candidate.education.length > 0
  breakdown.education_presence = hasEdu ? 100 : 30
  if (!hasEdu) flags.push('No education listed')

  // Weighted total
  const ats_score = Math.round(
    breakdown.keyword_density * 0.30 +
    breakdown.required_skills * 0.25 +
    breakdown.experience_range * 0.15 +
    breakdown.contact_completeness * 0.10 +
    breakdown.section_structure * 0.10 +
    breakdown.recency * 0.05 +
    breakdown.education_presence * 0.05
  )

  return {
    ats_score: Math.max(0, Math.min(100, ats_score)),
    breakdown,
    flags,
  }
}
