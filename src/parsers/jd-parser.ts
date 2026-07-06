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
    return result
  } catch (error) {
    console.warn('[Parser] AI parsing failed, falling back to regex:', error)
    return parseJDRegex(text)
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
