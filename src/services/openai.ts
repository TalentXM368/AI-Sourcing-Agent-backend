import OpenAI from 'openai'
import type { ParsedCandidate, ParsedJob } from '../types.js'

// ─── OpenAI Client (for embeddings) ───────────────────────────

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// ─── Groq Client (for AI parsing) ─────────────────────────────

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
})

// ─── Generate Embeddings ──────────────────────────────────────

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
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

// ─── Hash-based Fallback ──────────────────────────────────────

function hashEmbed(text: string, dimensions: number = 384): number[] {
  const vector: number[] = new Array(dimensions).fill(0)

  // Simple hash-based embedding (not as good as OpenAI, but works)
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i)
    vector[i % dimensions] += charCode / 1000
    vector[(i * 7 + 13) % dimensions] += Math.sin(charCode * 0.1) * 0.5
  }

  // Normalize
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map(v => v / (norm || 1))
}

// ─── Cosine Similarity ────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vector dimensions must match')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ─── AI Resume Parsing (via Groq) ─────────────────────────────

const RESUME_SCHEMA = `{
  "name": "string",
  "email": "string or null",
  "phone": "string or null",
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "portfolio_url": "string or null",
  "headline": "string or null - professional title/tagline",
  "location": "string or null - city, state/country",
  "summary": "string or null - 2-3 sentence professional summary",
  "experience_years": "number or null - total years of professional work experience",
  "skills": [{"name": "string", "category": "language|framework|tool|platform|concept|other", "proficiency": "string or null"}],
  "companies": [{"name": "string", "title": "string or null", "from": "string or null", "to": "string or null"}],
  "work_history": [{"title": "string", "company": "string", "from": "string or null", "to": "string or null", "description": "string or null", "achievements": ["string"], "is_current": false}],
  "education": [{"school": "string", "degree": "string or null", "field": "string or null", "year": "string or null", "gpa": "string or null"}],
  "projects": [{"name": "string", "description": "string or null", "tech": ["string"], "url": "string or null"}],
  "certifications": [{"name": "string", "issuer": "string or null", "year": "string or null"}],
  "languages": [{"name": "string", "proficiency": "string or null"}]
}`

const RESUME_SYSTEM_PROMPT = `You are an expert resume parser. Extract ALL information from the resume text into structured JSON.

CRITICAL RULES:

1. NAME: Extract the CANDIDATE'S FULL PERSONAL NAME (e.g., "John Smith", "Priya Patel", "Jayachandran Ayush").
   - NEVER return: a university name, company name, city name, or location as the name.
   - NEVER return: concatenated words without spaces like "AhmedabadGujaratIndia"
   - The name is a PERSON's name, not a section header, university name, or skill.
   - It is usually at the very top of the resume.
   - If the text order is scrambled (common in PDFs), look for a line that looks like a person's name (2-4 words, capital letters, no special characters).
   - If you truly cannot find a person's name, use "Unknown".

2. HEADLINE: The candidate's professional title or role (e.g., "Software Engineer", "Data Analyst", "Full Stack Developer", "AI & Machine Learning Student"). NOT education field, NOT skills, NOT a course name.

3. LOCATION: The candidate's city/state/country or "Remote". Look for patterns like "Bangalore, India" or "San Francisco, CA" or the word "Remote". NOT skills, NOT course names.

4. WORK_HISTORY: Extract EVERY job/position. Each entry MUST have: title, company, from, to, description, achievements array, is_current boolean.
   - title = job title (e.g., "Software Engineer")
   - company = employer name
   - from = start date
   - to = end date or "Present"
   - achievements = bullet points from resume
   - NEVER put work descriptions in the education field.

5. EDUCATION: Extract ONLY schools/universities and degrees. Each entry MUST have:
   - school = institution name (e.g., "Manipal University Jaipur", "MIT")
   - degree = degree type (e.g., "B.Tech", "Bachelor of Science")
   - field = field of study (e.g., "Computer Science")
   - year = graduation year or range
   - gpa = GPA if mentioned
   - NEVER put work descriptions or project descriptions in education.

6. SUMMARY: Write a 2-3 sentence professional summary.

7. EXPERIENCE_YEARS: Calculate total years from work_history dates.

8. SKILLS: Categorize each as: language, framework, tool, platform, concept, or other.

9. PROJECTS: Extract with name, description, tech array, url.

Return JSON matching this exact schema: ${RESUME_SCHEMA}`

export async function parseResumeWithAI(text: string): Promise<ParsedCandidate> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('No Groq API key configured')
  }

  const truncated = text.slice(0, 12000)

  const response = await groqClient.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content: RESUME_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: `Parse this resume into JSON. Return ONLY valid JSON, no markdown, no explanation:\n\n${truncated}`
      }
    ]
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('No response from Groq')

  // Clean up response - remove markdown code fences if present
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr) as ParsedCandidate

  // Post-parse name validation — reject bad names from AI
  let cleanName = parsed.name || 'Unknown'
  const institutionKeywords = ['university', 'college', 'institute', 'academy', 'school', 'polytechnic']
  const nameNormalized = cleanName.toLowerCase().trim()
  if (
    institutionKeywords.some(kw => nameNormalized.includes(kw)) ||
    /^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/.test(cleanName.replace(/\s/g, '')) ||
    cleanName.length > 60 ||
    /^\d+$/.test(cleanName) ||
    !/[a-zA-Z]/.test(cleanName)
  ) {
    cleanName = 'Unknown'
  }

  return {
    name: cleanName,
    email: parsed.email || undefined,
    phone: parsed.phone || undefined,
    linkedin_url: parsed.linkedin_url || undefined,
    github_url: parsed.github_url || undefined,
    portfolio_url: parsed.portfolio_url || undefined,
    headline: parsed.headline || undefined,
    location: parsed.location || undefined,
    summary: parsed.summary || undefined,
    experience_years: parsed.experience_years || undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    work_history: Array.isArray(parsed.work_history) ? parsed.work_history : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
    languages: Array.isArray(parsed.languages) ? parsed.languages : [],
  }
}

// Keep backward-compatible alias
export const parseResumeWithGPT = parseResumeWithAI

// ─── AI JD Parsing (via Groq) ─────────────────────────────────

export async function parseJDWithAI(text: string): Promise<ParsedJob> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('No Groq API key configured')
  }

  const truncated = text.slice(0, 6000)

  const response = await groqClient.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens: 2048,
    messages: [
      {
        role: 'system',
        content: `You are an expert job description parser. Extract ALL information from the JD text into structured JSON.

Rules:
- Extract the exact role/title, company name, location
- Separate required_skills (must-have) from nice_to_have_skills (preferred/bonus)
- Extract avoid_skills if mentioned
- Calculate experience_min and experience_max from text
- Extract seniority level (junior/mid/senior/staff/principal/lead/director)
- Identify the industry if mentioned
- Generate a clear description summary
- Return JSON with: role, company, location, required_skills, nice_to_have_skills, avoid_skills, experience_min, experience_max, seniority, industry, description`
      },
      {
        role: 'user',
        content: `Parse this job description into JSON. Return ONLY valid JSON:\n\n${truncated}`
      }
    ]
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('No response from Groq')

  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr) as ParsedJob

  return {
    role: parsed.role || 'Unknown Role',
    company: parsed.company || undefined,
    location: parsed.location || undefined,
    required_skills: Array.isArray(parsed.required_skills) ? parsed.required_skills : [],
    nice_to_have_skills: Array.isArray(parsed.nice_to_have_skills) ? parsed.nice_to_have_skills : [],
    avoid_skills: Array.isArray(parsed.avoid_skills) ? parsed.avoid_skills : [],
    experience_min: parsed.experience_min || undefined,
    experience_max: parsed.experience_max || undefined,
    seniority: parsed.seniority || undefined,
    industry: parsed.industry || undefined,
    description: parsed.description || text.slice(0, 2000),
    raw_text: text,
  }
}

// Keep backward-compatible alias
export const parseJDWithGPT = parseJDWithAI
