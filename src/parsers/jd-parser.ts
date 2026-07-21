import type { ParsedJob } from '../types.js'
import { parseJDWithGPT } from '../services/openai.js'

// ─── Common Skill Keywords ────────────────────────────────────

const SKILL_KEYWORDS = new Set([
  'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin',
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'next.js', 'nuxt', 'html', 'css', 'sass', 'tailwind',
  'node.js', 'nodejs', 'express', 'fastapi', 'django', 'flask', 'spring', 'spring boot', 'rails',
  'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'sql', 'nosql',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'k8s', 'terraform', 'ci/cd', 'devops',
  'machine learning', 'ml', 'ai', 'deep learning', 'nlp', 'llm', 'pytorch', 'tensorflow', 'keras',
  'git', 'github', 'gitlab', 'jira', 'slack', 'figma', 'notion',
  'rest', 'rest api', 'restful', 'graphql', 'microservices', 'agile', 'scrum',
])

// ─── Experience Patterns ──────────────────────────────────────

const EXP_PATTERNS = [
  /(\d+)[\s\-\+to]+(\d+)\s*years?/i,
  /(\d+)[\s\+]*(?:years?|yrs?|y\.?o\.?)\s*(?:of)?\s*(?:experience|exp)/i,
]

// ─── Main Parser ──────────────────────────────────────────────

export async function parseJobDescription(text: string): Promise<ParsedJob> {
  try {
    const result = await parseJDWithGPT(text)
    console.log('[Parser] AI JD parsing succeeded')

    if (!isWeakJDResult(result)) {
      return result
    }

    console.log('[Parser] AI JD result is weak, supplementing with regex')
    const regexResult = parseJDRegex(text)
    return mergeJDResults(regexResult, result)
  } catch (error) {
    console.warn('[Parser] AI parsing failed, falling back to regex:', error)
    return parseJDRegex(text)
  }
}

// ─── Weak JD Result Detection ─────────────────────────────────

function isWeakJDResult(r: ParsedJob): boolean {
  const hasRole = r.role && r.role !== 'Unknown Role'
  const hasSkills = r.required_skills.length >= 2
  const hasDesc = r.description && r.description.length > 30
  const score = [hasSkills, hasDesc].filter(Boolean).length
  return !hasRole || score < 1
}

// ─── Merge AI + Regex JD Results ──────────────────────────────

function mergeJDResults(regex: ParsedJob, ai: ParsedJob): ParsedJob {
  return {
    role: ai.role !== 'Unknown Role' ? ai.role : regex.role,
    company: ai.company || regex.company,
    location: ai.location || regex.location,
    required_skills: ai.required_skills.length > 0 ? ai.required_skills : regex.required_skills,
    nice_to_have_skills: ai.nice_to_have_skills.length > 0 ? ai.nice_to_have_skills : regex.nice_to_have_skills,
    avoid_skills: ai.avoid_skills.length > 0 ? ai.avoid_skills : regex.avoid_skills,
    experience_min: ai.experience_min || regex.experience_min,
    experience_max: ai.experience_max || regex.experience_max,
    seniority: ai.seniority || regex.seniority,
    industry: ai.industry || regex.industry,
    description: ai.description || regex.description,
    raw_text: ai.raw_text || regex.raw_text,
  }
}

// ─── Regex Fallback ───────────────────────────────────────────

function parseJDRegex(text: string): ParsedJob {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const fullText = text.toLowerCase()

  return {
    role: extractRole(lines, fullText),
    company: extractCompany(lines),
    location: extractLocation(lines, fullText),
    required_skills: extractRequiredSkills(fullText),
    nice_to_have_skills: extractNiceToHave(fullText),
    avoid_skills: [],
    experience_min: extractExperienceMin(fullText),
    experience_max: extractExperienceMax(fullText),
    seniority: extractSeniority(fullText),
    industry: undefined,
    description: text.slice(0, 2000),
    raw_text: text,
  }
}

// ─── Role Extraction ──────────────────────────────────────────

function extractRole(lines: string[], text: string): string {
  const titleKeywords = ['engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior', 'staff', 'principal', 'director', 'analyst', 'designer']

  for (const line of lines.slice(0, 10)) {
    if (line.length < 80 && titleKeywords.some(kw => line.toLowerCase().includes(kw))) {
      return line.replace(/[^a-zA-Z0-9\s\-\.]/g, '').trim()
    }
  }

  for (const line of lines.slice(0, 5)) {
    if (line.length > 5 && line.length < 60) {
      return line
    }
  }

  return 'Unknown Role'
}

// ─── Company Extraction ───────────────────────────────────────

function extractCompany(lines: string[]): string | undefined {
  const companyIndicators = ['inc', 'llc', 'corp', 'ltd', 'technologies', 'tech', 'labs', 'group', 'capital', 'company']

  for (const line of lines.slice(0, 10)) {
    if (companyIndicators.some(ind => line.toLowerCase().includes(ind))) {
      return line.replace(/[^a-zA-Z0-9\s\.\-]/g, '').trim()
    }
  }

  return undefined
}

// ─── Location Extraction ──────────────────────────────────────

function extractLocation(lines: string[], text: string): string | undefined {
  const locationPatterns = [
    /(?:location|office|based in|located in)[:\s]*([^\n,]+)/i,
    /(?:remote|hybrid|onsite|on-site)/i,
  ]

  for (const pattern of locationPatterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1]?.trim() || match[0]
    }
  }

  for (const line of lines.slice(0, 10)) {
    if (line.match(/[A-Z][a-z]+,\s*[A-Z]{2}/)) {
      return line
    }
  }

  return undefined
}

// ─── Required Skills Extraction ───────────────────────────────

function extractRequiredSkills(text: string): string[] {
  const found: Set<string> = new Set()

  const skillSections = text.match(/(?:required|must have|skills?|technologies?|requirements?)[:\s]*([\s\S]*?)(?:(?:nice to have|preferred|bonus|optional)[:\s]|$)/i)

  if (skillSections) {
    const sectionText = skillSections[1].toLowerCase()
    for (const skill of SKILL_KEYWORDS) {
      if (sectionText.includes(skill)) {
        found.add(skill)
      }
    }
  }

  for (const skill of SKILL_KEYWORDS) {
    if (text.includes(skill)) {
      found.add(skill)
    }
  }

  return Array.from(found)
}

// ─── Nice-to-Have Skills ──────────────────────────────────────

function extractNiceToHave(text: string): string[] {
  const found: Set<string> = new Set()

  const niceSection = text.match(/(?:nice to have|preferred|bonus|optional|good to have)[:\s]*([\s\S]*?)(?:requirement|must have|required|about|$)/i)

  if (niceSection) {
    const sectionText = niceSection[1].toLowerCase()
    for (const skill of SKILL_KEYWORDS) {
      if (sectionText.includes(skill)) {
        found.add(skill)
      }
    }
  }

  return Array.from(found)
}

// ─── Experience Min Extraction ─────────────────────────────────

function extractExperienceMin(text: string): number | undefined {
  const match = text.match(/(\d+)[\s\-\+to]+(\d+)\s*years?/i)
  if (match) {
    return parseInt(match[1])
  }

  const single = text.match(/(\d+)[\s\+]*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i)
  if (single) {
    return parseInt(single[1])
  }

  return undefined
}

// ─── Experience Max Extraction ─────────────────────────────────

function extractExperienceMax(text: string): number | undefined {
  const match = text.match(/(\d+)[\s\-\+to]+(\d+)\s*years?/i)
  if (match) {
    return parseInt(match[2])
  }

  const single = text.match(/(\d+)[\s\+]*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i)
  if (single) {
    return parseInt(single[1])
  }

  return undefined
}

// ─── Seniority Extraction ─────────────────────────────────────

function extractSeniority(text: string): string | undefined {
  if (/\bprincipal\b/i.test(text)) return 'principal'
  if (/\bdirector\b/i.test(text)) return 'director'
  if (/\bstaff\b/i.test(text)) return 'staff'
  if (/\bsenior\b|\bsr\.?\b/i.test(text)) return 'senior'
  if (/\bmid[- ]?level\b/i.test(text)) return 'mid'
  if (/\bjunior\b|\bjr\.?\b|\bentry[- ]?level\b/i.test(text)) return 'junior'
  if (/\blead\b|\bteam lead\b/i.test(text)) return 'lead'
  return undefined
}
