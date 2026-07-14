import OpenAI from 'openai'

// ─── Groq Client (for LLM evaluation) ─────────────────────────

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
})

// ─── Types ─────────────────────────────────────────────────────

export interface LLMEvaluation {
  score: number
  verdict: string
  reasoning: string
}

// ─── Build Candidate Summary ───────────────────────────────────

function buildCandidateSummary(candidate: any): string {
  const parts: string[] = []

  parts.push(`Name: ${candidate.name || 'Unknown'}`)
  if (candidate.headline) parts.push(`Title: ${candidate.headline}`)
  if (candidate.location) parts.push(`Location: ${candidate.location}`)
  if (candidate.summary) parts.push(`Summary: ${candidate.summary}`)
  if (candidate.experience_years) parts.push(`Years of Experience: ${candidate.experience_years}`)

  // Skills
  const skills = Array.isArray(candidate.skills) ? candidate.skills : []
  if (skills.length > 0) {
    const skillNames = skills.map((s: any) => s.name || s).join(', ')
    parts.push(`Skills: ${skillNames}`)
  }

  // Work history
  const workHistory = Array.isArray(candidate.work_history) ? candidate.work_history : []
  if (workHistory.length > 0) {
    const jobs = workHistory.slice(0, 5).map((w: any) => {
      const title = w.title || 'Unknown'
      const company = w.company || 'Unknown'
      const dates = `${w.from || '?'} - ${w.to || 'Present'}`
      const desc = w.description ? `: ${w.description.slice(0, 150)}` : ''
      return `${title} at ${company} (${dates})${desc}`
    })
    parts.push(`Work History:\n${jobs.join('\n')}`)
  }

  // Education
  const education = Array.isArray(candidate.education) ? candidate.education : []
  if (education.length > 0) {
    const eds = education.slice(0, 3).map((e: any) => {
      const parts = [e.school, e.degree, e.field].filter(Boolean).join(' - ')
      return parts + (e.year ? ` (${e.year})` : '') + (e.gpa ? ` GPA: ${e.gpa}` : '')
    })
    parts.push(`Education: ${eds.join('; ')}`)
  }

  return parts.join('\n')
}

// ─── Build Job Summary ─────────────────────────────────────────

function buildJobSummary(job: any): string {
  const parts: string[] = []

  parts.push(`Role: ${job.role || 'Unknown'}`)
  if (job.company) parts.push(`Company: ${job.company}`)
  if (job.location) parts.push(`Location: ${job.location}`)
  if (job.experience_min || job.experience_max) {
    parts.push(`Experience: ${job.experience_min || 0}-${job.experience_max || 'any'} years`)
  }
  if (job.description) parts.push(`Description: ${job.description.slice(0, 2000)}`)

  const reqSkills = job.required_skills || []
  if (reqSkills.length > 0) parts.push(`Required Skills: ${reqSkills.join(', ')}`)

  const niceSkills = job.nice_to_have_skills || []
  if (niceSkills.length > 0) parts.push(`Nice-to-have Skills: ${niceSkills.join(', ')}`)

  return parts.join('\n')
}

// ─── LLM Evaluation ────────────────────────────────────────────

let lastGroqCall = 0
const GROQ_MIN_INTERVAL_MS = 5000 // 5 seconds between calls to avoid 429

export async function evaluateCandidateWithLLM(
  candidate: any,
  job: any
): Promise<LLMEvaluation | null> {
  if (!process.env.GROQ_API_KEY) {
    console.warn('[LLM Eval] No Groq API key, skipping')
    return null
  }

  // Rate limit: wait if needed
  const now = Date.now()
  const elapsed = now - lastGroqCall
  if (elapsed < GROQ_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, GROQ_MIN_INTERVAL_MS - elapsed))
  }
  lastGroqCall = Date.now()

  const candidateSummary = buildCandidateSummary(candidate)
  const jobSummary = buildJobSummary(job)

  const prompt = `You are an expert technical recruiter. Evaluate how well this candidate matches the job requirements.

CANDIDATE PROFILE:
${candidateSummary}

JOB REQUIREMENTS:
${jobSummary}

Analyze the candidate's fit based on:
1. Skills match - do they have the required technical skills?
2. Experience level - is their YOE appropriate for the role?
3. Domain relevance - have they worked in similar domains/industries?
4. Career trajectory - does their career path align with this role?
5. Education relevance - is their educational background relevant?

Return ONLY valid JSON (no markdown, no explanation):
{
  "score": <number 0-100, where 90+ = exceptional fit, 70-89 = strong fit, 50-69 = moderate fit, below 50 = weak fit>,
  "verdict": "<one short sentence summarizing the match, e.g. 'Strong match — senior React developer with relevant fintech experience'>",
  "reasoning": "<2-4 sentences explaining what fits and what doesn't, be specific about skills and experience gaps>"
}`

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512,
      messages: [
        { role: 'system', content: 'You are an expert technical recruiter. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('No response from Groq')

    // Clean up response
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonStr)

    return {
      score: Math.min(100, Math.max(0, Math.round(parsed.score || 50))),
      verdict: (parsed.verdict || '').slice(0, 200),
      reasoning: (parsed.reasoning || '').slice(0, 1000),
    }
  } catch (error: any) {
    // Retry once on 429 with longer delay
    if (error?.status === 429 || error?.message?.includes('429')) {
      console.warn(`[LLM Eval] Rate limited for ${candidate.name}, retrying in 10s...`)
      await new Promise(r => setTimeout(r, 10000))
      lastGroqCall = Date.now()
      try {
        const response = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          max_tokens: 512,
          messages: [
            { role: 'system', content: 'You are an expert technical recruiter. Return ONLY valid JSON.' },
            { role: 'user', content: prompt },
          ],
        })
        const content = response.choices[0]?.message?.content
        if (!content) return null
        let jsonStr = content.trim()
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        }
        const parsed = JSON.parse(jsonStr)
        return {
          score: Math.min(100, Math.max(0, Math.round(parsed.score || 50))),
          verdict: (parsed.verdict || '').slice(0, 200),
          reasoning: (parsed.reasoning || '').slice(0, 1000),
        }
      } catch {
        console.error(`[LLM Eval] Retry also failed for ${candidate.name}`)
        return null
      }
    }
    console.error('[LLM Eval] Failed:', error)
    return null
  }
}
