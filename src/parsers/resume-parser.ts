import type { ParsedCandidate, Skill, Company, Education, Project, WorkHistoryEntry, Certification, Language } from '../types.js'
import { parseResumeWithGPT } from '../services/openai.js'

// ─── Main Parser (Hybrid: AI primary, regex fallback) ─────────

export async function parseResume(text: string): Promise<ParsedCandidate> {
  // Always run regex first to get a baseline
  const regexResult = parseResumeRegex(text)

  try {
    const aiResult = await parseResumeWithGPT(text)
    console.log('[Parser] AI resume parsing succeeded')

    // Merge: prefer AI data, fill gaps with regex
    return mergeResults(regexResult, aiResult)
  } catch (error) {
    console.warn('[Parser] AI parsing failed, using regex only:', error)
    return regexResult
  }
}

// ─── Merge AI + Regex Results ─────────────────────────────────
// AI is primary, but regex fills in where AI returned empty/null

function mergeResults(regex: ParsedCandidate, ai: ParsedCandidate): ParsedCandidate {
  return {
    name: ai.name || regex.name,
    email: ai.email || regex.email,
    phone: ai.phone || regex.phone,
    linkedin_url: ai.linkedin_url || regex.linkedin_url,
    github_url: ai.github_url || regex.github_url,
    portfolio_url: ai.portfolio_url || regex.portfolio_url,
    headline: ai.headline || regex.headline,
    location: ai.location || regex.location,
    summary: ai.summary || regex.summary,
    experience_years: ai.experience_years || regex.experience_years,
    skills: ai.skills.length > 0 ? ai.skills : regex.skills,
    companies: ai.companies.length > 0 ? ai.companies : regex.companies,
    work_history: ai.work_history.length > 0 ? ai.work_history : regex.work_history,
    education: ai.education.length > 0 ? ai.education : regex.education,
    projects: ai.projects.length > 0 ? ai.projects : regex.projects,
    certifications: ai.certifications.length > 0 ? ai.certifications : regex.certifications,
    languages: ai.languages.length > 0 ? ai.languages : regex.languages,
  }
}

// ═══════════════════════════════════════════════════════════════
// REGEX-BASED RESUME PARSER
// ═══════════════════════════════════════════════════════════════

// ─── Section Headers ──────────────────────────────────────────

const SECTION_PATTERNS = {
  experience: /^(?:work\s*)?(?:experience|employment|professional\s+experience|work\s+history|experience\s+summary)$/i,
  education: /^(?:education|academic|qualification|educational\s+background)$/i,
  skills: /^(?:skills?|technical\s+skills?|competencies|technologies|tech\s+stack|core\s+competencies)$/i,
  projects: /^(?:projects?|personal\s+projects?|key\s+projects?|portfolio)$/i,
  certifications: /^(?:certifications?|licenses?|credentials?|certificates?)$/i,
  languages: /^(?:languages?|linguistic)$/i,
  summary: /^(?:summary|profile|objective|about|professional\s+summary|career\s+summary|career\s+objective)$/i,
  contact: /^(?:contact|contact\s+info|contact\s+details|reach\s+me)$/i,
  additional: /^(?:additional|additional\s+info(?:rmation)?|other|miscellaneous|extras?)$/i,
  awards: /^(?:awards?|honors?|achievements?)$/i,
  references: /^(?:references?|recommendations?)$/i,
}

// ─── Date Patterns ────────────────────────────────────────────

const DATE_PATTERNS = [
  // "Jan 2020 - Present", "January 2020 - Current"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*[-–—to]+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current|now)/i,
  // "2020 - Present", "2020 - 2023"
  /(\d{4})\s*[-–—to]+\s*(\d{4}|present|current|now)/i,
  // "01/2020 - 06/2023"
  /(\d{1,2}\/\d{4})\s*[-–—to]+\s*(\d{1,2}\/\d{4}|present|current|now)/i,
  // "2020-Present"
  /(\d{4})\s*[-–]\s*(present|current|now|\d{4})/i,
]

// ─── Common Skill Keywords ────────────────────────────────────

const SKILL_KEYWORDS: Record<string, string> = {
  // Languages
  'javascript': 'language', 'typescript': 'language', 'python': 'language', 'java': 'language',
  'c++': 'language', 'c#': 'language', 'go': 'language', 'rust': 'language', 'ruby': 'language',
  'php': 'language', 'swift': 'language', 'kotlin': 'language', 'scala': 'language',
  'r': 'language', 'matlab': 'language', 'sql': 'language', 'html': 'language', 'css': 'language',
  'sass': 'language', 'scss': 'language', 'less': 'language',
  // Frameworks
  'react': 'framework', 'vue': 'framework', 'angular': 'framework', 'svelte': 'framework',
  'nextjs': 'framework', 'next.js': 'framework', 'nuxt': 'framework', 'remix': 'framework',
  'node.js': 'framework', 'nodejs': 'framework', 'express': 'framework', 'fastify': 'framework',
  'fastapi': 'framework', 'django': 'framework', 'flask': 'framework', 'spring': 'framework',
  'spring boot': 'framework', 'rails': 'framework', 'laravel': 'framework',
  'tailwind': 'framework', 'bootstrap': 'framework', 'material-ui': 'framework',
  'tensorflow': 'framework', 'pytorch': 'framework', 'keras': 'framework', 'scikit-learn': 'framework',
  'pandas': 'framework', 'numpy': 'framework', 'matplotlib': 'framework',
  // Tools
  'git': 'tool', 'github': 'tool', 'gitlab': 'tool', 'bitbucket': 'tool',
  'jira': 'tool', 'confluence': 'tool', 'slack': 'tool', 'figma': 'tool',
  'notion': 'tool', 'docker': 'tool', 'kubernetes': 'tool', 'k8s': 'tool',
  'terraform': 'tool', 'ansible': 'tool', 'jenkins': 'tool', 'circleci': 'tool',
  'postman': 'tool', 'swagger': 'tool', 'webpack': 'tool', 'vite': 'tool',
  // Platforms
  'aws': 'platform', 'gcp': 'platform', 'azure': 'platform', 'firebase': 'platform',
  'heroku': 'platform', 'vercel': 'platform', 'netlify': 'platform', 'digitalocean': 'platform',
  'linux': 'platform', 'unix': 'platform', 'windows': 'platform', 'macos': 'platform',
  // Concepts
  'machine learning': 'concept', 'ml': 'concept', 'ai': 'concept', 'artificial intelligence': 'concept',
  'deep learning': 'concept', 'nlp': 'concept', 'llm': 'concept', 'data science': 'concept',
  'microservices': 'concept', 'rest': 'concept', 'rest api': 'concept', 'graphql': 'concept',
  'ci/cd': 'concept', 'devops': 'concept', 'agile': 'concept', 'scrum': 'concept',
  'test driven development': 'concept', 'tdd': 'concept', 'oop': 'concept',
  'data structures': 'concept', 'algorithms': 'concept', 'design patterns': 'concept',
  'postgresql': 'tool', 'postgres': 'tool', 'mysql': 'tool', 'mongodb': 'tool',
  'redis': 'tool', 'elasticsearch': 'tool', 'dynamodb': 'tool', 'cassandra': 'tool',
  'neo4j': 'tool', 'sqlite': 'tool', 'mssql': 'tool', 'oracle db': 'tool',
}

// ─── Education Keywords ───────────────────────────────────────

// ONLY institution-related keywords (NOT degree keywords like b.tech, bachelor, etc.)
const SCHOOL_KEYWORDS = [
  'university', 'college', 'institute', 'school', 'academy', 'polytechnic',
  'iit', 'nit', 'iiit', 'bits', 'vit', 'amity', 'anna', 'mumbai', 'delhi',
  'bangalore', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad',
  'diploma', 'class x', 'class xi', 'class xii', 'cbse', 'icse',
]

// Degree keywords that can appear in education lines (separate from school keywords)
const DEGREE_KEYWORDS = [
  'b.tech', 'm.tech', 'bachelor', 'master', 'phd', 'mba', 'bca', 'mca',
  'bsc', 'msc', 'be ', 'me ', 'b.e.', 'm.e.', 'b.s.', 'm.s.',
]

// ─── Name Patterns ────────────────────────────────────────────

const SECTION_HEADER_WORDS = new Set([
  'experience', 'education', 'skills', 'projects', 'certifications', 'languages',
  'summary', 'profile', 'objective', 'contact', 'references', 'awards',
  'work history', 'professional summary', 'technical skills', 'core competencies',
  'work experience', 'employment', 'academic', 'qualification',
  'additional', 'additional information', 'additional info', 'other', 'miscellaneous',
  'honors', 'achievements', 'recommendations',
])

// ─── Main Regex Parser ────────────────────────────────────────

export function parseResumeRegex(text: string): ParsedCandidate {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const sections = detectSections(lines)

  return {
    name: extractName(lines),
    email: extractEmail(text),
    phone: extractPhone(text),
    linkedin_url: extractLinkedin(text),
    github_url: extractGithub(text),
    portfolio_url: extractPortfolio(text),
    headline: extractHeadline(lines),
    location: extractLocation(lines),
    summary: extractSummary(sections, lines),
    experience_years: extractExperienceYears(sections, text),
    skills: extractSkills(text),
    companies: extractCompaniesFromWork(sections),
    work_history: extractWorkHistory(sections),
    education: extractEducation(sections),
    projects: extractProjects(sections),
    certifications: extractCertifications(sections),
    languages: extractLanguages(sections),
  }
}

// ─── Section Detection ────────────────────────────────────────

interface Section {
  type: string
  startLine: number
  endLine: number
  lines: string[]
}

function detectSections(lines: string[]): Section[] {
  const sections: Section[] = []
  let currentSection: Section | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase().replace(/[^a-z\s]/g, '').trim()

    // Check if this line is a section header
    let matchedType: string | null = null
    for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
      if (pattern.test(line) || pattern.test(lower)) {
        matchedType = type
        break
      }
    }

    if (matchedType) {
      // Save previous section
      if (currentSection) {
        currentSection.endLine = i - 1
        sections.push(currentSection)
      }
      currentSection = {
        type: matchedType,
        startLine: i + 1,
        endLine: lines.length - 1,
        lines: [],
      }
    } else if (currentSection) {
      currentSection.lines.push(line)
    }
  }

  // Save last section
  if (currentSection) {
    sections.push(currentSection)
  }

  return sections
}

// ─── Name Extraction ──────────────────────────────────────────

function extractName(lines: string[]): string {
  // Skip common non-name patterns
  const skipPatterns = [
    /@/, /resume/i, /cv/i, /curriculum/i, /phone/i, /email/i, /address/i,
    /linkedin/i, /github/i, /portfolio/i, /http/i, /www\./i,
    /^\d+/, /^\(/, /objective/i, /summary/i, /profile/i,
  ]

  for (const line of lines.slice(0, 8)) {
    if (line.length < 2 || line.length > 60) continue
    if (skipPatterns.some(p => p.test(line))) continue
    if (SECTION_HEADER_WORDS.has(line.toLowerCase().replace(/[^a-z\s]/g, '').trim())) continue

    // Clean the name
    const cleaned = line.replace(/[^a-zA-Z\s\-\.]/g, '').trim()
    if (cleaned.length >= 2 && cleaned.split(/\s/).length <= 5) {
      return cleaned
    }
  }
  return 'Unknown'
}

// ─── Contact Extraction ───────────────────────────────────────

function extractEmail(text: string): string | undefined {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return match?.[0]
}

function extractPhone(text: string): string | undefined {
  // Match various phone formats
  const patterns = [
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+?\d{10,12}/,
    /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
  ]
  for (const p of patterns) {
    const match = text.match(p)
    if (match) return match[0].trim()
  }
  return undefined
}

function extractLinkedin(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-]+/i)
  return match?.[0]
}

function extractGithub(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9\-]+/i)
  return match?.[0]
}

function extractPortfolio(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.(?:com|dev|io|net|org)(?:\/[^\s]*)?/i)
  if (match && !match[0].includes('linkedin') && !match[0].includes('github')) {
    return match[0]
  }
  return undefined
}

// ─── Headline Extraction ──────────────────────────────────────

function extractHeadline(lines: string[]): string | undefined {
  const titleKeywords = [
    'engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior',
    'staff', 'principal', 'director', 'analyst', 'consultant', 'specialist',
    'scientist', 'intern', 'associate', 'coordinator', 'supervisor',
    'full stack', 'frontend', 'backend', 'devops', 'software',
    'cloud', 'platform', 'systems', 'network', 'security', 'qa', 'test',
  ]

  // Words that indicate this is NOT a job title
  const notTitleWords = [
    'university', 'college', 'institute', 'school', 'academy',
    'bachelor', 'master', 'phd', 'mba', 'b.tech', 'm.tech',
    'computer science', 'engineering', 'information technology',
    'skills', 'experience', 'education', 'summary', 'projects',
    'programming', 'languages', 'frameworks', 'tools', 'platforms',
    'data', 'sql', 'python', 'java', 'javascript', 'react', 'angular',
    'dynamic', 'greedy', 'algorithms', 'linear',
  ]

  // Only look at lines before any section header
  const firstSectionIdx = lines.findIndex(l => {
    const lower = l.toLowerCase().replace(/[^a-z\s]/g, '').trim()
    return SECTION_HEADER_WORDS.has(lower)
  })
  const searchLimit = firstSectionIdx > 0 ? Math.min(firstSectionIdx, 10) : 10

  for (const line of lines.slice(1, searchLimit)) {
    if (line.length < 5 || line.length > 60) continue
    const lower = line.toLowerCase().trim()
    
    // Skip if it matches NOT title words
    if (notTitleWords.some(kw => lower.includes(kw))) continue
    
    // Skip if it's clearly a section header
    if (SECTION_HEADER_WORDS.has(lower.replace(/[^a-z\s]/g, '').trim())) continue
    
    // Skip if it looks like an email, phone, or URL
    if (lower.includes('@') || lower.includes('http') || /^\d{10}/.test(lower)) continue
    
    // Skip if it has too many commas (likely a list, not a title)
    if ((line.match(/,/g) || []).length > 1) continue
    
    // Skip if it contains common non-title patterns
    if (/\b(or|and|the|for|with|in|at|of)\b/i.test(lower) && !lower.includes(' and ')) continue
    
    if (titleKeywords.some(kw => lower.includes(kw))) {
      return line.trim()
    }
  }
  return undefined
}

// ─── Location Extraction ──────────────────────────────────────

function extractLocation(lines: string[]): string | undefined {
  // Known locations that should be recognized
  const knownLocations = new Set([
    'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'chennai', 'pune',
    'kolkata', 'ahmedabad', 'jaipur', 'lucknow', 'indore', 'nagpur', 'surat',
    'san francisco', 'new york', 'los angeles', 'chicago', 'seattle', 'boston',
    'london', 'berlin', 'toronto', 'singapore', 'dubai', 'sydney', 'melbourne',
    'remote', 'on-site', 'on site', 'hybrid',
    'california', 'texas', 'washington', 'massachusetts', 'michigan',
    'usa', 'india', 'uk', 'canada', 'germany', 'australia',
    'kerala', 'karnataka', 'tamil nadu', 'maharashtra', 'rajasthan',
    'andhra pradesh', 'telangana', 'uttar pradesh', 'madhya pradesh',
  ])

  // Only look at lines in the header section (before any section header)
  const firstSectionIdx = lines.findIndex(l => {
    const lower = l.toLowerCase().replace(/[^a-z\s]/g, '').trim()
    return SECTION_HEADER_WORDS.has(lower)
  })
  const searchLimit = firstSectionIdx > 0 ? Math.min(firstSectionIdx, 15) : 15

  // First pass: look for lines that contain known location keywords
  for (const line of lines.slice(0, searchLimit)) {
    const lower = line.toLowerCase().trim()
    
    // Check if line contains a known location
    const hasKnownLocation = Array.from(knownLocations).some(loc => lower.includes(loc))
    if (hasKnownLocation) {
      // For "Remote" or single-word locations, return as-is
      if (['remote', 'on-site', 'on site', 'hybrid'].includes(lower)) {
        return line.trim()
      }
      
      // For "City, State" patterns, extract just that part
      const cityStateMatch = line.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/)
      if (cityStateMatch && cityStateMatch[0].length < 50) {
        return cityStateMatch[0].trim()
      }
      
      // Return the line if it's short enough (likely just the location)
      if (line.length < 40) {
        return line.trim()
      }
    }
  }
  
  return undefined
}

// ─── Summary Extraction ───────────────────────────────────────

function extractSummary(sections: Section[], lines: string[]): string | undefined {
  // Look for summary section
  const summarySection = sections.find(s => s.type === 'summary')
  if (summarySection && summarySection.lines.length > 0) {
    return summarySection.lines.join(' ').trim()
  }

  // Fallback: look for text after "summary" header in first 20 lines
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/^(?:summary|profile|objective|about)/i.test(lines[i])) {
      const summaryLines = lines.slice(i + 1, i + 5).filter(l => l.length > 10)
      if (summaryLines.length > 0) {
        return summaryLines.join(' ').trim()
      }
    }
  }

  return undefined
}

// ─── Experience Years Extraction ──────────────────────────────

function extractExperienceYears(sections: Section[], text: string): number | undefined {
  // First try explicit mentions
  const explicitPatterns = [
    /(\d+)[\s\+]*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i,
    /experience[:\s]*(\d+[\s\-to]+\d+)\s*years?/i,
    /(\d+)[\s\-to]+(\d+)\s*years?(?:\s+of)?\s*(?:experience|exp)/i,
  ]

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern)
    if (match) {
      if (match[2]) return Math.round((parseInt(match[1]) + parseInt(match[2])) / 2)
      return parseInt(match[1])
    }
  }

  // Calculate from work history dates
  const expSection = sections.find(s => s.type === 'experience')
  if (expSection) {
    const years = extractYearsFromDates(expSection.lines.join(' '))
    if (years !== null) return years
  }

  return undefined
}

function extractYearsFromDates(text: string): number | null {
  const dates: Date[] = []

  // Find all date ranges
  for (const pattern of DATE_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern.source, 'gi'))
    for (const match of matches) {
      const start = parseDate(match[1])
      const end = match[2]?.toLowerCase().includes('present') ? new Date() : parseDate(match[2])
      if (start) dates.push(start)
      if (end) dates.push(end)
    }
  }

  if (dates.length >= 2) {
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())))
    const latest = new Date(Math.max(...dates.map(d => d.getTime())))
    const years = (latest.getTime() - earliest.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return Math.round(years)
  }

  return null
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const lower = dateStr.toLowerCase()

  if (lower.includes('present') || lower.includes('current') || lower.includes('now')) {
    return new Date()
  }

  // "Jan 2020" or "January 2020"
  const monthMatch = lower.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{4})/)
  if (monthMatch) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.indexOf(monthMatch[1].slice(0, 3))
    return new Date(parseInt(monthMatch[2]), month, 1)
  }

  // "2020" or "01/2020"
  const yearMatch = dateStr.match(/(\d{4})/)
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1)
  }

  return null
}

// ─── Skills Extraction ────────────────────────────────────────

function extractSkills(text: string): Skill[] {
  const found: Map<string, string> = new Map()
  const lower = text.toLowerCase()

  for (const [skill, category] of Object.entries(SKILL_KEYWORDS)) {
    // Use word boundary matching for short skills
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = skill.length <= 3
      ? new RegExp(`\\b${escaped}\\b`, 'i')
      : new RegExp(escaped, 'i')

    if (regex.test(lower)) {
      found.set(skill, category)
    }
  }

  return Array.from(found.entries()).map(([name, category]) => ({ name, category: category as Skill['category'] }))
}

// ─── Work History Extraction ──────────────────────────────────

function extractWorkHistory(sections: Section[]): WorkHistoryEntry[] {
  const expSection = sections.find(s => s.type === 'experience')
  if (!expSection) return []

  const entries: WorkHistoryEntry[] = []
  let current: Partial<WorkHistoryEntry> | null = null

  for (const line of expSection.lines) {
    // Check if this line contains a date range (indicates a job entry)
    let hasDateRange = false
    let from: string | undefined
    let to: string | undefined

    for (const pattern of DATE_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        hasDateRange = true
        from = match[1]
        to = match[2] || 'Present'
        break
      }
    }

    if (hasDateRange) {
      // Save previous entry
      if (current?.title && current?.company) {
        entries.push(current as WorkHistoryEntry)
      }

      // Extract title and company from the line
      const { title, company } = extractTitleCompany(line)

      current = {
        title: title || 'Unknown',
        company: company || 'Unknown',
        from,
        to: to?.includes('present') || to?.includes('current') || to?.includes('now') ? 'Present' : to,
        description: '',
        achievements: [],
        is_current: to?.toLowerCase().includes('present') || to?.toLowerCase().includes('current') || to?.toLowerCase().includes('now'),
      }
    } else if (current) {
      // Accumulate description/achievements
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('▸') || line.startsWith('▪')) {
        current.achievements!.push(line.replace(/^[•\-▸▪]\s*/, ''))
      } else if (line.length > 15 && !current.description) {
        current.description = line
      } else if (line.length > 15) {
        current.description = (current.description || '') + ' ' + line
      }
    }
  }

  // Save last entry
  if (current?.title && current?.company) {
    entries.push(current as WorkHistoryEntry)
  }

  return entries.slice(0, 10)
}

function extractTitleCompany(line: string): { title: string | null; company: string | null } {
  // Common patterns:
  // "Software Engineer at Google"
  // "Google - Software Engineer"
  // "Software Engineer | Google"
  // "Software Engineer, Google"

  const patterns = [
    /(.+?)\s+(?:at|@)\s+(.+)/i,
    /(.+?)\s*[-–|,]\s*(.+)/i,
  ]

  for (const pattern of patterns) {
    const match = line.replace(DATE_PATTERNS[0].source, '').replace(DATE_PATTERNS[1].source, '').trim().match(pattern)
    if (match) {
      return { title: match[1].trim(), company: match[2].trim() }
    }
  }

  return { title: line, company: null }
}

// ─── Companies Extraction ─────────────────────────────────────

function extractCompaniesFromWork(sections: Section[]): Company[] {
  const entries = extractWorkHistory(sections)
  return entries.map(e => ({
    name: e.company,
    title: e.title,
    from: e.from,
    to: e.to,
  }))
}

// ─── Education Extraction ─────────────────────────────────────

function extractEducation(sections: Section[]): Education[] {
  const eduSection = sections.find(s => s.type === 'education')
  if (!eduSection) return []

  const entries: Education[] = []

  for (const line of eduSection.lines) {
    if (line.length < 3) continue

    // Check if line contains an actual institution name (capitalized, followed by institution keyword)
    const hasInstitutionKeyword = /(?:[A-Z][a-z]+\s+)*(?:University|College|Institute|School|Academy|Polytechnic|Point)/i.test(line)
    
    // Check if line contains a degree keyword
    const hasDegreeKeyword = DEGREE_KEYWORDS.some(kw => line.toLowerCase().includes(kw.toLowerCase()))
    
    // Skip lines that have NO institution keyword AND NO degree keyword
    if (!hasInstitutionKeyword && !hasDegreeKeyword) continue
    
    // Skip lines that only have degree keywords but no institution
    // (e.g., just "B.Tech" or "Bachelor of Science" with no school name)
    if (!hasInstitutionKeyword && hasDegreeKeyword) {
      // Allow if line also has a year (might be a standalone degree entry)
      const hasYear = /\b(20\d{2}|19\d{2})\b/.test(line)
      if (!hasYear) continue
    }

    // Try to extract school name - look for institution names
    const schoolMatch = line.match(/([A-Z][A-Za-z\s]*(?:University|College|Institute|School|Academy|Polytechnic|Point)[A-Za-z\s]*)/i)
    if (!schoolMatch) {
      // If no institution keyword found but line has education keyword, skip
      // Don't use whole line as school - it might be just a degree or description
      continue
    }

    const entry: Education = { school: schoolMatch[1].trim() }

    // Extract degree - look for degree patterns
    const degreePatterns = [
      /(?:Bachelor|B\.?Tech|B\.?E\.|B\.?Sc|B\.?CA|B\.?Com|B\.?BA|B\.?BS)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:Master|M\.?Tech|M\.?E\.|M\.?Sc|M\.?CA|M\.?Com|M\.?BA|M\.?BS|MBA)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:PhD|Ph\.?D)[^\s,]*(?:\s+in\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:Diploma|Class\s*(?:X|XI|XII|10|11|12))[^\s,]*(?:\s+(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
    ]

    for (const pattern of degreePatterns) {
      const match = line.match(pattern)
      if (match) {
        const degreeStr = match[0].trim()
        entry.degree = degreeStr
        
        // Try to extract field
        const fieldMatch = line.match(/(?:in|of)\s+([A-Za-z\s]+?)(?:\s*[,–|\(]|$)/i)
        if (fieldMatch && !fieldMatch[1].trim().includes('University') && !fieldMatch[1].trim().includes('College')) {
          entry.field = fieldMatch[1].trim()
        }
        break
      }
    }

    // Extract year range (e.g., "2023-Present" or "Aug 2020 - Present")
    const yearRangeMatch = line.match(/\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+)?(\d{4})\s*[-–—to]+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+)?(present|current|\d{4})\b/i)
    if (yearRangeMatch) {
      entry.year = yearRangeMatch[2] + '-' + (yearRangeMatch[4].includes('present') || yearRangeMatch[4].includes('current') ? 'Present' : yearRangeMatch[4])
    } else {
      // Fallback: extract single year
      const yearMatch = line.match(/\b(20\d{2}|19\d{2})\b/)
      if (yearMatch) entry.year = yearMatch[1]
    }

    // Extract GPA/CGPA
    const gpaMatch = line.match(/(?:CGPA|GPA|Percentage|Grade)[:\s]*(\d+\.?\d*)/i)
    if (gpaMatch) entry.gpa = gpaMatch[1]

    // Only add if we found school and either degree or year
    if (entry.school && (entry.degree || entry.year)) {
      entries.push(entry)
    }
  }

  return entries.slice(0, 5)
}

// ─── Projects Extraction ──────────────────────────────────────

function extractProjects(sections: Section[]): Project[] {
  const projSection = sections.find(s => s.type === 'projects')
  if (!projSection) return []

  const entries: Project[] = []

  for (const line of projSection.lines) {
    if (line.length < 5) continue

    // Try to extract project name and description
    const dashMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)/)
    if (dashMatch) {
      entries.push({
        name: dashMatch[1].trim(),
        description: dashMatch[2].trim(),
        tech: extractTechFromLine(line),
      })
    } else if (line.length > 10 && line.length < 200) {
      entries.push({
        name: line.slice(0, 60),
        description: line,
        tech: extractTechFromLine(line),
      })
    }
  }

  return entries.slice(0, 5)
}

function extractTechFromLine(line: string): string[] {
  const tech: string[] = []
  const techKeywords = ['react', 'vue', 'angular', 'node', 'python', 'java', 'typescript', 'javascript',
    'django', 'flask', 'fastapi', 'express', 'spring', 'aws', 'azure', 'gcp', 'docker',
    'kubernetes', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'html', 'css',
    'pytorch', 'tensorflow', 'pandas', 'numpy', ' kafka', 'spark', 'airflow', 'llm', 'rag']

  const lower = line.toLowerCase()
  for (const kw of techKeywords) {
    if (lower.includes(kw)) tech.push(kw.trim())
  }
  return tech
}

// ─── Certifications Extraction ────────────────────────────────

function extractCertifications(sections: Section[]): Certification[] {
  const certSection = sections.find(s => s.type === 'certifications')
  if (!certSection) return []

  return certSection.lines
    .filter(l => l.length > 3)
    .map(line => ({ name: line }))
    .slice(0, 5)
}

// ─── Languages Extraction ─────────────────────────────────────

function extractLanguages(sections: Section[]): Language[] {
  const langSection = sections.find(s => s.type === 'languages')
  if (!langSection) return []

  const languages: Language[] = []

  for (const line of langSection.lines) {
    // Split by comma or bullet
    const parts = line.split(/[,•\-|]/).map(p => p.trim()).filter(Boolean)
    for (const part of parts) {
      if (part.length > 1 && part.length < 30) {
        // Try to extract proficiency
        const profMatch = part.match(/(.+?)\s*[-–(]\s*(.+?)\)?$/)
        if (profMatch) {
          languages.push({ name: profMatch[1].trim(), proficiency: profMatch[2].trim() })
        } else {
          languages.push({ name: part })
        }
      }
    }
  }

  return languages.slice(0, 10)
}
