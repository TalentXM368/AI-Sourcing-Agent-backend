import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ParsedCandidate, ParsedJob } from '../types.js'

// Ensure env is loaded before reading API keys
try { loadEnv({ path: resolve(__dirname, '../../.env') }) } catch {}

// ═══════════════════════════════════════════════════════════════
// PROVIDER CLIENTS (initialized from env)
// ═══════════════════════════════════════════════════════════════

const groqClient = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
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
  openaiClient ? 'OpenAI' : null,
  claudeClient ? 'Claude' : null,
  geminiClient ? 'Gemini' : null,
].filter(Boolean)
console.log(`[AI] Available providers: ${availableProviders.join(', ') || 'NONE'}`)

// ═══════════════════════════════════════════════════════════════
// RETRY HELPER
// ═══════════════════════════════════════════════════════════════

// Track providers that are permanently down (quota/credits exhausted) to skip retries
const deadProviders = new Set<string>()

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 2,
  baseDelay = 2000,
): Promise<T | null> {
  // Skip retries for providers known to be dead
  const effectiveRetries = deadProviders.has(label) ? 0 : maxRetries
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      const result = await fn()
      deadProviders.delete(label) // Recovered — remove from dead list
      return result
    } catch (e: any) {
      const isRateLimit = e?.status === 429
      const isQuota = e?.status === 400 || e?.message?.includes('quota') || e?.message?.includes('insufficient') || e?.message?.includes('credit')
      if (isQuota) {
        deadProviders.add(label) // Mark as dead — don't retry this provider again
        console.log(`  [${label}] Permanently unavailable (quota/credits) — won't retry`)
        return null
      }
      if (isRateLimit && attempt < effectiveRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000
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
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════

const RESUME_SYSTEM_PROMPT = `You are an expert resume parser. Extract ALL information from the resume text into structured JSON.

CRITICAL RULES:

1. NAME: Extract the CANDIDATE'S FULL PERSONAL NAME.
   - NEVER return: university, company, city, section header, or job title as the name.
   - NEVER return concatenated words without spaces.
   - If text is scrambled (common in PDFs), find 2-4 capitalized words forming a person's name.
   - If no name found, return "Unknown".

2. HEADLINE: Professional title/role (e.g., "Software Engineer", "3D Artist", "Data Analyst").
   - NOT education field, NOT skills list, NOT a course name.

3. LOCATION: City, State/Country or "Remote".
   - NOT a company name, NOT skills, NOT course names.

4. WORK_HISTORY: Extract EVERY job/position. Each entry:
   - title: job title, company: employer name
   - from: start date, to: end date or "Present"
   - description: brief description, achievements: array of bullet points
   - is_current: boolean

5. EDUCATION: Extract ONLY schools/universities. Each entry:
   - school: institution name, degree: degree type
   - field: field of study, year: graduation year
   - gpa: GPA if mentioned

6. SUMMARY: 2-3 sentence professional summary.

7. EXPERIENCE_YEARS: Total years of professional work experience.

8. SKILLS: ALL skills. Each with name and category (language|framework|tool|platform|concept|other).

9. PROJECTS: Name, description, tech array, url.
10. CERTIFICATIONS: Name, issuer, year.
11. LANGUAGES: Name, proficiency.

IMPORTANT:
- Resume may be in ANY LANGUAGE. Parse regardless.
- PDF text is often scrambled. Reconstruct logical flow.
- Return ONLY valid JSON, no markdown fences, no explanation.`

const VALIDATE_SYSTEM_PROMPT = `You are a resume data validator. Given original resume text and a JSON parse result, verify:
1. Name is a real person's name (not university/company/city/location/section header)
2. Location is a real city/state/country (not a company name or role)
3. Headline is a job title (not education field or skill list)
4. Work history entries have real job titles and companies
5. Education entries have real institution names (not work descriptions)
6. Skills are actual technical/professional skills

If ANY field is wrong, return the CORRECTED JSON with all fields.
If everything is correct, return the original JSON unchanged.
Return ONLY valid JSON, no explanation.`

// ═══════════════════════════════════════════════════════════════
// PROVIDER-SPECIFIC PARSE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function parseWithGroq(text: string): Promise<ParsedCandidate | null> {
  if (!groqClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 12000)
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
  }, 'Groq')
}

async function parseWithOpenAI(text: string): Promise<ParsedCandidate | null> {
  if (!openaiClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 12000)
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
  }, 'OpenAI')
}

async function parseWithClaude(text: string): Promise<ParsedCandidate | null> {
  if (!claudeClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 12000)
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
  }, 'Claude')
}

async function parseWithGemini(text: string): Promise<ParsedCandidate | null> {
  if (!geminiClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 12000)
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
  }, 'Gemini')
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE WITH AI (second pass on Groq — cheapest/fastest)
// ═══════════════════════════════════════════════════════════════

async function validateWithAI(text: string, candidate: ParsedCandidate): Promise<ParsedCandidate> {
  if (!groqClient) return candidate
  const result = await withRetry(async () => {
    const truncated = text.slice(0, 8000)
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
  }, 'validate')
  return result ?? candidate
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZE & VALIDATE PARSED DATA
// ═══════════════════════════════════════════════════════════════

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
    work_history: Array.isArray(raw.work_history) ? raw.work_history
      .map((w: any) => ({
        title: String(w.title || '').trim(),
        company: String(w.company || '').trim(),
        from: w.from || undefined, to: w.to || undefined,
        description: w.description || undefined,
        achievements: Array.isArray(w.achievements) ? w.achievements : [],
        is_current: Boolean(w.is_current),
      }))
      .filter((w: any) => w.title && w.company && w.company !== 'Unknown') : [],
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
    /university|college|institute|academy|school|polytechnic|consultancy|inc|ltd|corp|llc/i,
    /resume|cv|curriculum|profile|summary|objective|contact/i,
    /^(?:mobile|email|phone|address|linkedin|github|portfolio|http|www)/i,
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
  if (!groqClient && !openaiClient && !claudeClient && !geminiClient) {
    throw new Error('No AI API keys configured')
  }

  // Fire ALL providers in parallel
  const settled = await Promise.allSettled([
    parseWithGroq(text),
    parseWithOpenAI(text),
    parseWithClaude(text),
    parseWithGemini(text),
  ])

  // Collect successful results
  const successful: ParsedCandidate[] = []
  const providerNames = ['Groq', 'OpenAI', 'Claude', 'Gemini']
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

// ═══════════════════════════════════════════════════════════════
// JD PARSING (multi-provider, same pattern)
// ═══════════════════════════════════════════════════════════════

async function parseJDWithGroq(text: string): Promise<ParsedJob | null> {
  if (!groqClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 6000)
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

async function parseJDWithClaude(text: string): Promise<ParsedJob | null> {
  if (!claudeClient) return null
  return withRetry(async () => {
    const truncated = text.slice(0, 6000)
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
    const truncated = text.slice(0, 6000)
    const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: JD_SYSTEM_PROMPT })
    const result = await model.generateContent(`Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}`)
    const content = result.response.text()
    if (!content) throw new Error('Empty response')
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return normalizeJD(JSON.parse(jsonStr), text)
  }, 'Gemini-JD')
}

const JD_SYSTEM_PROMPT = `You are an expert job description parser. Extract ALL information into structured JSON.
Rules:
- Extract role/title, company name, location
- Separate required_skills (must-have) from nice_to_have_skills (preferred)
- Extract avoid_skills if mentioned
- Calculate experience_min and experience_max
- Extract seniority level (junior/mid/senior/staff/principal/lead/director)
- Identify industry if mentioned
- Generate description summary
Return JSON with: role, company, location, required_skills, nice_to_have_skills, avoid_skills, experience_min, experience_max, seniority, industry, description`

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
  if (!groqClient && !openaiClient && !claudeClient && !geminiClient) {
    throw new Error('No AI API keys configured')
  }

  const settled = await Promise.allSettled([
    parseJDWithGroq(text),
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
