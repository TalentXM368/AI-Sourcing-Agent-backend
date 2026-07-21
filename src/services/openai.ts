import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ParsedCandidate, ParsedJob } from '../types.js'

// Ensure env is loaded before reading API keys
try { loadEnv({ path: resolve(__dirname, '../../.env') }) } catch {}

// ═══════════════════════════════════════════════════════════════
// SMART TRUNCATION
// ═══════════════════════════════════════════════════════════════

function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const truncated = text.slice(0, maxChars)
  const lastSentence = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
    truncated.lastIndexOf('\n'),
  )
  return lastSentence > maxChars * 0.8
    ? truncated.slice(0, lastSentence + 1)
    : truncated
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER CLIENTS (initialized from env)
// ═══════════════════════════════════════════════════════════════

const groqClient = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null

const pollinationsClient = new OpenAI({
  apiKey: 'pollinations',
  baseURL: 'https://gen.pollinations.ai/v1',
})

const xaiClient = process.env.XAI_API_KEY
  ? new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' })
  : null

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

const claudeClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null

// Log available providers on startup
const availableProviders = [
  groqClient ? 'Groq' : null,
  'Pollinations',
  xaiClient ? 'xAI' : null,
  openaiClient ? 'OpenAI' : null,
  claudeClient ? 'Claude' : null,
  geminiClient ? 'Gemini' : null,
].filter(Boolean)
console.log(`[AI] Available providers: ${availableProviders.join(', ') || 'NONE'}`)

// ═══════════════════════════════════════════════════════════════
// RETRY HELPER
// ═══════════════════════════════════════════════════════════════

const deadProviders = new Set<string>()

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
  baseDelay = 5000,
): Promise<T | null> {
  if (deadProviders.has(label)) return null
  const effectiveRetries = maxRetries
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      const result = await fn()
      deadProviders.delete(label)
      return result
    } catch (e: any) {
      const isRateLimit = e?.status === 429
      const isQuota = e?.status === 400 || e?.message?.includes('quota') || e?.message?.includes('insufficient') || e?.message?.includes('credit')
      if (isQuota) {
        deadProviders.add(label)
        console.log(`  [${label}] Permanently unavailable (quota/credits) — won't retry`)
        return null
      }
      if (isRateLimit && attempt < effectiveRetries) {
        const delay = baseDelay * Math.pow(3, attempt) + Math.random() * 2000
        console.log(`  [${label}] Rate limited, retrying in ${Math.round(delay)}ms...`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      console.log(`  [${label}] Error: ${e.message?.slice(0, 80)}`)
      return null
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// IMPROVED SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════

const RESUME_SYSTEM_PROMPT = `You are an expert resume parser with 20+ years of recruiting experience across ALL industries. Extract ALL information from the resume text into structured JSON.

═══ CRITICAL: NAME EXTRACTION ═══

The NAME field MUST contain the candidate's PERSONAL NAME (first + last, or full name).

NEVER return:
- Filenames or public IDs (e.g. "654774000016837068 Sanjna.pdf", "654774000016829764 Roy")
- Section headers (e.g. "WORK EXPERIENCE", "Professional Summary", "Education")
- University/college names (e.g. "Indian Institute of Technology")
- Company names (e.g. "Google", "Infosys")
- City/location names (e.g. "Ahmedabad", "Mumbai")
- Job titles (e.g. "Software Engineer", "Data Analyst")
- Concatenated words without spaces (e.g. "AhmedabadGujaratIndia")
- Lines with digits, underscores, @, http, file extensions (.pdf, .docx)

VALID name examples: "Rahul Sharma", "Priya Patel", "Amit Kumar Singh", "John Smith", "María García"

RULES:
1. Look at the FIRST 2-3 lines of the resume
2. The name is usually the most prominent text at the very top
3. It should be 2-5 words, mixed case, alphabetic characters (and possibly hyphens/apostrophes)
4. If the first line contains digits, underscores, or file extensions → skip to next line
5. SPACED-OUT LETTERS: If you see "B H A W A N A S H A R M A" (single letters separated by spaces), collapse them into one word: "BHAWANASHARMA". This is a PDF encoding artifact.
6. If you truly cannot find a personal name, return "Unknown"

═══ DOMAIN-ADAPTIVE PARSING ═══

Resumes vary dramatically by industry. Adapt your parsing based on what you see:

TECHNOLOGY / SOFTWARE ENGINEERING:
- Skills section often lists specific technologies (Python, React, AWS, Docker, Kubernetes)
- Projects section with GitHub links, tech stacks, descriptions
- Work descriptions include technical details (APIs, databases, frameworks, CI/CD)
- Look for: GitHub URL, portfolio with code samples, contribution to open source
- Skills category: prioritize "language", "framework", "tool", "platform"

HEALTHCARE / MEDICAL:
- Licenses and certifications are critical (RN, MD, Board Certifications)
- Clinical experience with patient contact hours
- Specializations and rotations
- Continuing education requirements
- Look for: medical license numbers, hospital affiliations, patient care metrics
- Skills: clinical skills, medical terminology, patient communication

FINANCE / BANKING:
- Quantitative achievements (revenue generated, portfolio size, risk reduction)
- Certifications matter (CFA, CPA, FRM, Series 7/66)
- Regulatory compliance experience
- Look for: AUM figures, deal sizes, percentage improvements
- Skills: financial modeling, valuation, risk analysis, regulatory knowledge

CREATIVE / DESIGN:
- Portfolio links (Behance, Dribbble, personal site)
- Visual thinking described in words
- Tools: Figma, Sketch, Photoshop, Illustrator, After Effects
- Projects: design systems, UI/UX work, brand identities
- Look for: portfolio URLs, case studies, before/after descriptions

ACADEMIC / RESEARCH:
- Publications (journal articles, conference papers, book chapters)
- Research grants and funding amounts
- Teaching experience and courses taught
- Conference presentations and posters
- Look for: DOIs, citation counts, h-index, research areas

SALES / MARKETING:
- Revenue metrics, quota attainment percentages
- Campaign results (ROI, conversion rates, lead generation)
- Client acquisition and retention numbers
- Territory/region management
- Look for: CRM tools (Salesforce, HubSpot), marketing platforms

ENGINEERING / MANUFACTURING:
- CAD/CAM tools (AutoCAD, SolidWorks, CATIA)
- Quality certifications (Six Sigma, ISO, PMP)
- Safety records and compliance
- Project budgets and timelines managed
- Look for: technical drawings, specifications, quality metrics

GENERAL RULES FOR ALL DOMAINS:
- Extract what IS THERE, don't force-fit into a template
- If a section doesn't exist (e.g., no "Projects" in a finance resume), leave it empty []
- Bullet points may use: •, -, ▸, ▪, →, *, ◆
- Dates may be formatted as: "Jan 2020", "2020-Present", "01/2020 - 06/2023", "2020 to Present"
- Company and title may be on the same line or separate lines
- Descriptions may span multiple lines

═══ FIELD-SPECIFIC RULES ═══

1. EMAIL: Valid email format (user@domain.com). Reject section headers.
2. PHONE: Phone number with country code if available. Reject random digit sequences.
3. LINKEDIN_URL: Full LinkedIn profile URL (linkedin.com/in/...)
4. GITHUB_URL: Full GitHub profile URL (github.com/...) — extract if present
5. PORTFOLIO_URL: Personal website URL (Behance, Dribbble, personal domain)

6. HEADLINE: Professional title/role (e.g. "Software Engineer", "3D Artist", "Data Analyst")
   - NOT education field, NOT skills list, NOT course name
   - Usually appears right below the name

7. LOCATION: City, State/Country or "Remote"
   - NOT a company name, NOT skills, NOT course names

8. SUMMARY: 2-3 sentence professional summary from the resume

9. EXPERIENCE_YEARS: Total years of professional work experience (number)
   - Calculate from work history dates if not explicitly stated
   - If fresher/student, return 0

10. SKILLS: ALL technical and professional skills found. Each with:
    - name: skill name (e.g. "Python", "React", "AWS", "Figma", "CFA")
    - category: "language" | "framework" | "tool" | "platform" | "concept" | "other"
    - proficiency: if mentioned (e.g. "expert", "beginner")
    - Extract from: skills section, work descriptions, project descriptions

11. WORK_HISTORY: Extract EVERY job/position. Each entry:
    - title: job title (e.g. "Software Engineer", "Registered Nurse")
    - company: employer name (e.g. "Google", "Mayo Clinic")
    - from: start date (e.g. "Jan 2020", "2020")
    - to: end date or "Present"
    - description: brief description of role (1-2 sentences)
    - achievements: array of bullet points (•, -, ▸, ▪, →, *)
    - is_current: true if "to" is "Present" or "Current"
    - Handle PDF artifacts: dates may be on separate lines, bullets may use various symbols

12. EDUCATION: Extract ONLY schools/universities. Each entry:
    - school: institution name (MUST contain University/College/Institute/School/Academy)
    - degree: degree type (e.g. "B.Tech", "M.Sc", "PhD", "Bachelor", "MBBS")
    - field: field of study (e.g. "Computer Science", "Nursing")
    - year: graduation year or year range
    - gpa: GPA/CGPA if mentioned
    - NEVER return company names or course descriptions as school

13. PROJECTS: Each with name, description, tech array, url
14. CERTIFICATIONS: Each with name, issuer, year — CRITICAL for healthcare, finance, engineering
15. LANGUAGES: Each with name, proficiency

═══ IMPORTANT ═══
- Resume may be in ANY LANGUAGE. Parse regardless.
- PDF text extraction may produce artifacts: missing spaces, garbled characters, line breaks in wrong places.
- Reconstruct logical flow from context.
- Return ONLY valid JSON. No markdown fences, no explanation, no commentary.
- Empty arrays [] are fine if no data found. Don't invent fake entries.`

const VALIDATE_SYSTEM_PROMPT = `You are a strict resume data validator. Given original resume text and a JSON parse result, verify and correct:

1. NAME: Must be a real person's name (2-5 words, mixed case, alphabetic)
   - Reject: filenames, section headers, university/company names, concatenated words
   - If invalid, try to find the real name in the resume text

2. EMAIL: Must be valid email format (contains @ and domain)
3. PHONE: Must be a plausible phone number
4. HEADLINE: Must be a job title (not education, not skills list)
5. LOCATION: Must be a real city/region (not a company or role)

6. WORK_HISTORY: Each entry must have:
   - Real job title (not section headers)
   - Real company name (not "Unknown" unless truly unknown)
   - Valid date range

7. EDUCATION: Each entry must have:
   - Real institution name (contains University/College/Institute/School)
   - NOT a company name or job description

8. SKILLS: Must be actual technical/professional skills
   - Reject generic words like "team player", "hard working"

If ANY field is wrong, return the CORRECTED JSON with ALL fields (not just the wrong ones).
If everything is correct, return the original JSON unchanged.
Return ONLY valid JSON, no explanation.`

const JD_SYSTEM_PROMPT = `You are an expert job description parser. Extract ALL information into structured JSON.

RULES:
1. ROLE: Job title/position name (e.g. "Senior Software Engineer", "Data Scientist")
2. COMPANY: Company/organization name
3. LOCATION: Job location (city, country, or "Remote")

4. REQUIRED_SKILLS: Must-have technical skills (the dealbreakers)
   - Extract specific technologies, not generic terms
   - Example: ["Python", "React", "PostgreSQL"] not ["programming", "web development"]

5. NICE_TO_HAVE_SKILLS: Preferred but not required skills
   - These are plusses, not requirements

6. AVOID_SKILLS: Skills explicitly mentioned as not needed or negative

7. EXPERIENCE_MIN: Minimum years of experience required
8. EXPERIENCE_MAX: Maximum years of experience (null if not specified)

9. SENIORITY: junior | mid | senior | staff | principal | lead | director
   - Infer from title and requirements if not explicit

10. INDUSTRY: Industry sector if mentioned (e.g. "Fintech", "Healthcare", "E-commerce")

11. DESCRIPTION: 2-3 sentence summary of the role

Return JSON with: role, company, location, required_skills, nice_to_have_skills, avoid_skills, experience_min, experience_max, seniority, industry, description`

// ═══════════════════════════════════════════════════════════════
// PROVIDER-SPECIFIC PARSE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function parseWithGroq(text: string): Promise<ParsedCandidate | null> {
  if (!groqClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: RESUME_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'Groq', 2, 3000)
}

async function parseWithPollinations(text: string): Promise<ParsedCandidate | null> {
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const response = await pollinationsClient.chat.completions.create({
      model: 'openai',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: RESUME_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'Pollinations', 2, 3000)
}

async function parseWithXAI(text: string): Promise<ParsedCandidate | null> {
  if (!xaiClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const response = await xaiClient.chat.completions.create({
      model: 'grok-3',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: RESUME_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'xAI', 2, 3000)
}

async function parseWithOpenAI(text: string): Promise<ParsedCandidate | null> {
  if (!openaiClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: RESUME_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'OpenAI', 1, 2000)
}

async function parseWithClaude(text: string): Promise<ParsedCandidate | null> {
  if (!claudeClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const response = await claudeClient.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      temperature: 0.1,
      system: RESUME_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.content[0]?.type === 'text' ? response.content[0].text : null
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'Claude', 1, 2000)
}

async function parseWithGemini(text: string): Promise<ParsedCandidate | null> {
  if (!geminiClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 20000)
    const model = geminiClient.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: RESUME_SYSTEM_PROMPT,
    })
    const result = await model.generateContent(`Parse this resume into JSON. Return ONLY valid JSON:\n\n${truncated}`)
    const content = result.response.text()
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeParsed(JSON.parse(jsonStr))
  }, 'Gemini', 1, 2000)
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE WITH AI (second pass)
// ═══════════════════════════════════════════════════════════════

async function validateWithAI(text: string, candidate: ParsedCandidate): Promise<ParsedCandidate> {
  // Only validate if the result has weak signals worth correcting
  const needsValidation = !candidate.name || candidate.name === 'Unknown'
    || candidate.skills.length === 0
    || (!candidate.email && !candidate.phone && !candidate.linkedin_url)

  if (!needsValidation) return candidate

  // Try Groq first (most reliable), then Pollinations
  const validators = [groqClient, pollinationsClient].filter(Boolean)

  for (const validator of validators) {
    const result = await withRetry(async () => {
      const truncated = smartTruncate(text, 10000)
      const response = await validator!.chat.completions.create({
        model: validator === groqClient ? 'llama-3.3-70b-versatile' : 'openai',
        temperature: 0.1,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: VALIDATE_SYSTEM_PROMPT },
          { role: 'user', content: `Original resume:\n${truncated}\n\nParse result:\n${JSON.stringify(candidate, null, 2)}\n\nReturn corrected or original JSON:` }
        ]
      })
      const content = response.choices[0]?.message?.content
      if (!content) return candidate
      let jsonStr = content.trim()
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      return normalizeParsed(JSON.parse(jsonStr))
    }, `validate-${validator === groqClient ? 'groq' : 'pollinations'}`)
    if (result) return result
  }

  return candidate
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZE & VALIDATE PARSED DATA
// ═══════════════════════════════════════════════════════════════

function dedupWorkHistory(entries: any[]): any[] {
  if (entries.length <= 1) return entries
  const grouped = new Map<string, any[]>()
  for (const e of entries) {
    const key = `${(e.company || '').toLowerCase().trim()}|${(e.title || '').toLowerCase().trim()}`
    const existing = grouped.get(key)
    if (existing) existing.push(e)
    else grouped.set(key, [e])
  }
  const deduped: any[] = []
  for (const group of grouped.values()) {
    if (group.length === 1) { deduped.push(group[0]); continue }
    const best = group.reduce((a, b) => (a.description?.length || 0) >= (b.description?.length || 0) ? a : b)
    const achievements = new Set<string>()
    for (const e of group) for (const ach of e.achievements || []) achievements.add(ach)
    deduped.push({ ...best, achievements: Array.from(achievements) })
  }
  return deduped
}

function normalizeParsed(raw: any): ParsedCandidate {
  const name = validateName(raw.name || 'Unknown')

  let location = raw.location || undefined
  if (location) {
    const badLocPatterns = [
      /\b(?:engineer|developer|architect|manager|lead|analyst|consultant|scientist|intern|associate|coordinator)\b/i,
      /\b(?:python|java|javascript|react|angular|vue|node|sql|html|css|aws|azure|gcp|docker|kubernetes)\b/i,
      /university|college|institute|school/i,
    ]
    if (badLocPatterns.some(p => p.test(location)) || location.length > 60) location = undefined
  }

  let headline = raw.headline || undefined
  if (headline) {
    const badHeadlinePatterns = [
      /^(?:b\.?tech|m\.?tech|bachelor|master|phd|mba|diploma)/i,
      /^(?:computer science|information technology|engineering|electronics)/i,
      /^(?:python|java|javascript|react|sql|html|css)\s*(?:,|\||\/)/i,
    ]
    if (badHeadlinePatterns.some(p => p.test(headline)) || headline.length > 80) headline = undefined
  }

  return {
    name,
    email: raw.email || undefined,
    phone: raw.phone || undefined,
    linkedin_url: raw.linkedin_url || undefined,
    github_url: raw.github_url || undefined,
    portfolio_url: raw.portfolio_url || undefined,
    headline,
    location,
    summary: raw.summary || undefined,
    experience_years: typeof raw.experience_years === 'number' ? raw.experience_years : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills
      .map((s: any) => ({ name: String(s.name || '').trim(), category: s.category || 'other', proficiency: s.proficiency || undefined }))
      .filter((s: any) => s.name && s.name.length > 1) : [],
    companies: Array.isArray(raw.companies) ? raw.companies
      .map((c: any) => ({ name: String(c.name || '').trim(), title: c.title || undefined, from: c.from || undefined, to: c.to || undefined }))
      .filter((c: any) => c.name) : [],
    work_history: dedupWorkHistory(
      Array.isArray(raw.work_history) ? raw.work_history
        .map((w: any) => ({
          title: String(w.title || '').trim(),
          company: String(w.company || '').trim(),
          from: w.from || undefined, to: w.to || undefined,
          description: w.description || undefined,
          achievements: Array.isArray(w.achievements) ? w.achievements : [],
          is_current: Boolean(w.is_current),
        }))
        .filter((w: any) => w.title && w.company && w.company !== 'Unknown') : []
    ),
    education: Array.isArray(raw.education) ? raw.education
      .map((e: any) => ({
        school: String(e.school || '').trim(),
        degree: e.degree || undefined, field: e.field || undefined,
        year: e.year || undefined, gpa: e.gpa || undefined,
      }))
      .filter((e: any) => e.school && e.school.length > 3) : [],
    projects: Array.isArray(raw.projects) ? raw.projects
      .map((p: any) => ({ name: String(p.name || '').trim(), description: p.description || undefined, tech: Array.isArray(p.tech) ? p.tech : [], url: p.url || undefined }))
      .filter((p: any) => p.name) : [],
    certifications: Array.isArray(raw.certifications) ? raw.certifications
      .map((c: any) => ({ name: String(c.name || '').trim(), issuer: c.issuer || undefined, year: c.year || undefined }))
      .filter((c: any) => c.name) : [],
    languages: Array.isArray(raw.languages) ? raw.languages
      .map((l: any) => ({ name: String(l.name || '').trim(), proficiency: l.proficiency || undefined }))
      .filter((l: any) => l.name) : [],
  }
}

function validateName(name: string): string {
  if (!name || name === 'Unknown') return 'Unknown'
  const badPatterns = [
    /\b(?:university|college|institute|academy|polytechnic|consultancy|inc|ltd|corp|llc)\b/i,
    /\b(?:resume|cv|curriculum|profile|summary|objective|contact)\b/i,
    /^(?:mobile|email|phone|address|linkedin|github|portfolio|http|www)/i,
    /\d{8,}/, // Long digit sequences (file IDs)
    /\.(pdf|docx?|txt)$/i, // File extensions
    /[_@#]/, // Underscores, @, # (filenames)
  ]
  const lower = name.toLowerCase().trim()
  if (badPatterns.some(p => p.test(lower))) return 'Unknown'
  if (name.length > 60 || name.length < 2) return 'Unknown'
  if (/^\d+$/.test(name)) return 'Unknown'
  if (!/[a-zA-Z]/.test(name)) return 'Unknown'
  return name.trim()
}

// ═══════════════════════════════════════════════════════════════
// CROSS-VALIDATE: Pick best data from multiple AI results
// ═══════════════════════════════════════════════════════════════

function pickFirst(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (v && v !== 'Unknown' && v.length > 0) return v
  }
  return values[0]
}

function pickBestArray<T extends { length: number }>(...arrays: T[]): T {
  return arrays.reduce((best, curr) => curr.length >= best.length ? curr : best, arrays[0])
}

function crossValidate(results: ParsedCandidate[]): ParsedCandidate {
  if (results.length === 0) throw new Error('No results to cross-validate')
  if (results.length === 1) return results[0]

  // Pick the name that appears most often and isn't "Unknown"
  const validNames = results.map(r => r.name).filter(n => n && n !== 'Unknown')
  const nameCounts = new Map<string, number>()
  for (const n of validNames) {
    nameCounts.set(n, (nameCounts.get(n) || 0) + 1)
  }
  let bestName = 'Unknown'
  let maxCount = 0
  for (const [name, count] of nameCounts) {
    if (count > maxCount || (count === maxCount && name.length > bestName.length)) {
      bestName = name
      maxCount = count
    }
  }
  // If no consensus, pick the longest valid name
  if (bestName === 'Unknown' && validNames.length > 0) {
    bestName = validNames.sort((a, b) => b.length - a.length)[0]
  }

  return {
    name: bestName,
    email: pickFirst(...results.map(r => r.email)),
    phone: pickFirst(...results.map(r => r.phone)),
    linkedin_url: pickFirst(...results.map(r => r.linkedin_url)),
    github_url: pickFirst(...results.map(r => r.github_url)),
    portfolio_url: pickFirst(...results.map(r => r.portfolio_url)),
    headline: pickFirst(...results.map(r => r.headline)),
    location: pickFirst(...results.map(r => r.location)),
    summary: results.reduce((best, r) => (r.summary?.length || 0) > (best?.length || 0) ? r.summary : best, undefined as string | undefined),
    experience_years: results.reduce((best, r) => r.experience_years || best, undefined as number | undefined),
    skills: pickBestArray(...results.map(r => r.skills)),
    companies: pickBestArray(...results.map(r => r.companies)),
    work_history: pickBestArray(...results.map(r => r.work_history)),
    education: pickBestArray(...results.map(r => r.education)),
    projects: pickBestArray(...results.map(r => r.projects)),
    certifications: pickBestArray(...results.map(r => r.certifications)),
    languages: pickBestArray(...results.map(r => r.languages)),
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN: PARALLEL MULTI-PROVIDER + CROSS-VALIDATE + VALIDATE
// ═══════════════════════════════════════════════════════════════

export async function parseResumeWithAI(text: string): Promise<ParsedCandidate> {
  // Fire ALL providers in parallel
  const settled = await Promise.allSettled([
    parseWithGroq(text),
    parseWithPollinations(text),
    parseWithXAI(text),
    parseWithOpenAI(text),
    parseWithClaude(text),
    parseWithGemini(text),
  ])

  // Collect successful results
  const successful: ParsedCandidate[] = []
  const providerNames = ['Groq', 'Pollinations', 'xAI', 'OpenAI', 'Claude', 'Gemini']
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled' && result.value) {
      successful.push(result.value)
      console.log(`  [Parser] ${providerNames[i]} succeeded`)
    } else {
      const reason = result.status === 'rejected' ? result.reason?.message?.slice(0, 60) : 'null'
      console.log(`  [Parser] ${providerNames[i]} failed: ${reason}`)
    }
  }

  if (successful.length === 0) {
    throw new Error('All AI providers failed')
  }

  // Cross-validate between all successful results
  let final = successful.length >= 2 ? crossValidate(successful) : successful[0]
  console.log(`  [Parser] Cross-validated from ${successful.length} provider(s)`)

  // Validate with a second AI pass (catches wrong names, locations, etc.)
  final = await validateWithAI(text, final)

  return final
}

// Backward-compatible alias
export const parseResumeWithGPT = parseResumeWithAI

// Export Groq-only parser for targeted re-parsing
export async function parseResumeWithGroqOnly(text: string): Promise<ParsedCandidate> {
  const result = await parseWithGroq(text)
  if (!result) throw new Error('Groq parsing failed')
  return result
}

// ═══════════════════════════════════════════════════════════════
// JD PARSING (multi-provider, same pattern)
// ═══════════════════════════════════════════════════════════════

async function parseJDWithGroq(text: string): Promise<ParsedJob | null> {
  if (!groqClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 8000)
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1, max_tokens: 2048,
      messages: [
        { role: 'system', content: JD_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'Groq-JD')
}

async function parseJDWithPollinations(text: string): Promise<ParsedJob | null> {
  return withRetry(async () => {
    const truncated = smartTruncate(text, 8000)
    const response = await pollinationsClient.chat.completions.create({
      model: 'openai',
      temperature: 0.1, max_tokens: 2048,
      messages: [
        { role: 'system', content: JD_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'Pollinations-JD')
}

async function parseJDWithXAI(text: string): Promise<ParsedJob | null> {
  if (!xaiClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 8000)
    const response = await xaiClient.chat.completions.create({
      model: 'grok-3',
      temperature: 0.1, max_tokens: 2048,
      messages: [
        { role: 'system', content: JD_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}` }
      ]
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'xAI-JD')
}

async function parseJDWithClaude(text: string): Promise<ParsedJob | null> {
  if (!claudeClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 8000)
    const response = await claudeClient.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048, temperature: 0.1,
      system: JD_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}` }]
    })
    const content = response.content[0]?.type === 'text' ? response.content[0].text : null
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'Claude-JD')
}

async function parseJDWithGemini(text: string): Promise<ParsedJob | null> {
  if (!geminiClient) return null
  return withRetry(async () => {
    const truncated = smartTruncate(text, 8000)
    const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: JD_SYSTEM_PROMPT })
    const result = await model.generateContent(`Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}`)
    const content = result.response.text()
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'Gemini-JD')
}

function normalizeJD(raw: any, rawText: string): ParsedJob {
  return {
    role: raw.role || 'Unknown Role',
    company: raw.company || undefined,
    location: raw.location || undefined,
    required_skills: Array.isArray(raw.required_skills) ? raw.required_skills : [],
    nice_to_have_skills: Array.isArray(raw.nice_to_have_skills) ? raw.nice_to_have_skills : [],
    avoid_skills: Array.isArray(raw.avoid_skills) ? raw.avoid_skills : [],
    experience_min: raw.experience_min || undefined,
    experience_max: raw.experience_max || undefined,
    seniority: raw.seniority || undefined,
    industry: raw.industry || undefined,
    description: raw.description || rawText.slice(0, 2000),
    raw_text: rawText,
  }
}

export async function parseJDWithAI(text: string): Promise<ParsedJob> {
  const settled = await Promise.allSettled([
    parseJDWithGroq(text),
    parseJDWithPollinations(text),
    parseJDWithXAI(text),
    parseJDWithClaude(text),
    parseJDWithGemini(text),
  ])

  const successful: ParsedJob[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) successful.push(r.value)
  }

  if (successful.length === 0) throw new Error('All AI providers failed for JD parsing')

  // Pick the one with most required_skills
  return successful.reduce((best, curr) =>
    curr.required_skills.length >= best.required_skills.length ? curr : best
  )
}

export const parseJDWithGPT = parseJDWithAI

// ═══════════════════════════════════════════════════════════════
// EMBEDDINGS (OpenAI → hash fallback)
// ═══════════════════════════════════════════════════════════════

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!openaiClient) {
    console.warn('[OpenAI] No API key, using hash-based fallback')
    return texts.map(text => hashEmbed(text))
  }
  try {
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    })
    return response.data.map(d => d.embedding)
  } catch (error) {
    console.error('[OpenAI] Embedding failed, using hash fallback:', error)
    return texts.map(text => hashEmbed(text))
  }
}

function hashEmbed(text: string, dimensions: number = 384): number[] {
  const vector: number[] = new Array(dimensions).fill(0)
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i)
    vector[i % dimensions] += charCode / 1000
    vector[(i * 7 + 13) % dimensions] += Math.sin(charCode * 0.1) * 0.5
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map(v => v / (norm || 1))
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimensions must match')
  let dotProduct = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
