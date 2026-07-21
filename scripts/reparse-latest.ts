import { Pool } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { Database } from '../src/db/index.js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { parseResumeWithGroqOnly, generateEmbeddings, cosineSimilarity } from '../src/services/openai.js'
import { classifyIndustry } from '../src/services/industry-classifier.js'
import { classifyRegion } from '../src/services/region-classifier.js'
import { randomUUID } from 'crypto'
import { computeSkillScore } from '../src/scoring/skills.js'
import { computeExperienceScore } from '../src/scoring/experience.js'
import { computeEducationScore } from '../src/scoring/education.js'
import { computeAtsScore } from '../src/scoring/ats.js'

config({ path: resolve(__dirname, '../.env') })

function makeDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  })
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}

function isValidPersonName(name: string): boolean {
  if (!name || name === 'Unknown' || name.length < 2 || name.length > 60) return false
  return !/university|college|institute|school|resume|cv|email|phone|http|linkedin|github/i.test(name)
}

function extractNameFromFilename(url: string): string | undefined {
  const match = url.match(/([^/]+?)(?:_\d+)?\.(?:pdf|docx|doc|txt)$/i)
  if (!match) return undefined
  const raw = match[1].replace(/[_-]+/g, ' ').trim()
  if (raw.split(/\s+/).length >= 2 && raw.length < 60) return raw
  return undefined
}

async function scoreFast(db: Kysely<Database>, candidateId: string): Promise<void> {
  const candidate = await db.selectFrom('candidates').selectAll().where('id', '=', candidateId).executeTakeFirst()
  if (!candidate) return

  const jobs = await db.selectFrom('jobs').selectAll().where('status', '=', 'open').execute()
  if (jobs.length === 0) return

  const jobIds = jobs.map(j => j.id)
  const allEmb = jobIds.length > 0
    ? await db.selectFrom('embeddings').select(['entity_id', 'vector'])
        .where('entity_type', '=', 'job').where('purpose', '=', 'full_text')
        .where('entity_id', 'in', jobIds).execute()
    : []
  const jobEmbMap = new Map<string, number[]>()
  for (const e of allEmb) jobEmbMap.set(e.entity_id, e.vector as number[])

  const candEmb = await db.selectFrom('embeddings').select('vector')
    .where('entity_id', '=', candidateId).where('entity_type', '=', 'candidate')
    .where('purpose', '=', 'full_text').executeTakeFirst()
  const candVec = candEmb?.vector as number[] | undefined

  const candidateSkills = Array.isArray(candidate.skills) ? (candidate.skills as any[]).map((s: any) => s.name || s) : []

  for (const job of jobs) {
    const jobVec = jobEmbMap.get(job.id)
    let semantic = 0
    if (jobVec && candVec && jobVec.length === candVec.length) {
      try { semantic = cosineSimilarity(jobVec, candVec) * 100 } catch { semantic = 0 }
    }
    const skillResult = computeSkillScore(job.required_skills || [], candidateSkills)
    const experience = computeExperienceScore(job.experience_max, candidate.experience_years)
    const education = computeEducationScore(candidate.education)
    const atsResult = computeAtsScore({
      name: candidate.name, email: candidate.email, phone: candidate.phone,
      linkedin_url: candidate.linkedin_url, github_url: candidate.github_url,
      headline: candidate.headline, summary: candidate.summary,
      experience_years: candidate.experience_years,
      skills: Array.isArray(candidate.skills) ? candidate.skills : [],
      work_history: Array.isArray(candidate.work_history) ? candidate.work_history : [],
      education: Array.isArray(candidate.education) ? candidate.education : [],
      resume_url: candidate.resume_url,
    } as any, {
      role: job.role, required_skills: job.required_skills || [],
      nice_to_have_skills: job.nice_to_have_skills || [],
      experience_min: job.experience_min, experience_max: job.experience_max,
      description: job.description,
    })

    const hasSemantic = semantic !== 0
    let total = hasSemantic
      ? semantic * 0.45 + skillResult.score * 0.40 + experience * 0.15
      : skillResult.score * 0.60 + experience * 0.25 + education * 0.15
    total = Math.round(Math.min(100, Math.max(0, total)))

    await db.insertInto('ranked_candidates').values({
      id: randomUUID(), job_id: job.id, candidate_id: candidate.id,
      semantic_score: Math.round(semantic), skill_score: skillResult.score,
      experience_score: experience, education_score: education,
      client_fit_score: 50, total_score: total,
      exact_matches: skillResult.exact, semantic_matches: skillResult.semantic,
      missing_skills: skillResult.missing, avoid_signals: [],
      explanation: `Skills: ${skillResult.exact.length} exact.`,
      llm_score: 0, llm_verdict: null, llm_reasoning: null,
      ats_score: atsResult.ats_score, decision: 'pending', created_at: new Date(),
    }).onConflict((oc) => oc.columns(['job_id', 'candidate_id']).doUpdateSet({
      semantic_score: Math.round(semantic), skill_score: skillResult.score,
      experience_score: experience, education_score: education,
      client_fit_score: 50, total_score: total,
      exact_matches: skillResult.exact, semantic_matches: skillResult.semantic,
      missing_skills: skillResult.missing,
      explanation: `Skills: ${skillResult.exact.length} exact.`,
      llm_score: 0, llm_verdict: null, llm_reasoning: null,
      ats_score: atsResult.ats_score,
    })).execute()
  }
}

async function main() {
  const db = makeDb()

  // Get 5 most recent candidates with raw_text
  const candidates = await db.selectFrom('candidates')
    .selectAll()
    .where('parse_status', '=', 'completed')
    .where('raw_text', 'is not', null)
    .orderBy('created_at', 'desc')
    .limit(5)
    .execute()

  console.log(`[Reparse] Re-parsing ${candidates.length} latest candidates with Groq only`)

  let processed = 0
  let failed = 0
  const results: Array<{ name: string; oldName: string; skills: number; industry: string | null; region: string | null }> = []

  for (const candidate of candidates) {
    if (!candidate.raw_text) continue

    try {
      console.log(`[${processed + 1}/${candidates.length}] Re-parsing: "${candidate.name}"`)

      // Parse with Groq only (only working provider)
      const parsed = await parseResumeWithGroqOnly(candidate.raw_text)

      let candidateName = parsed.name
      if (!isValidPersonName(candidateName)) {
        const fromFile = extractNameFromFilename(candidate.source_file || '')
        if (fromFile) { candidateName = fromFile; console.log(`  Name fallback: ${candidateName}`) }
      }

      // Classify industry and region
      const skillNames = parsed.skills.map((s: any) => s.name || s)
      const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${candidate.raw_text}`
      const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
      const regionResult = classifyRegion(parsed.location || '')

      // Update candidate
      await db.updateTable('candidates').set({
        name: candidateName, email: parsed.email, phone: parsed.phone,
        linkedin_url: parsed.linkedin_url, github_url: parsed.github_url,
        portfolio_url: parsed.portfolio_url, headline: parsed.headline,
        location: parsed.location, summary: parsed.summary,
        experience_years: parsed.experience_years,
        skills: JSON.stringify(parsed.skills), companies: JSON.stringify(parsed.companies),
        work_history: JSON.stringify(parsed.work_history), education: JSON.stringify(parsed.education),
        projects: JSON.stringify(parsed.projects), certifications: JSON.stringify(parsed.certifications),
        languages: JSON.stringify(parsed.languages),
        industry: industryResult.industry, region: regionResult,
        parse_status: 'completed', parse_error: null, updated_at: new Date(),
      }).where('id', '=', candidate.id).execute()

      // Regenerate embeddings
      await db.deleteFrom('embeddings').where('entity_id', '=', candidate.id).where('entity_type', '=', 'candidate').execute()

      const skillsText = parsed.skills.map((s: any) => s.name).join(' ')
      const roleText = parsed.headline || (parsed.companies as any[])[0]?.title || ''
      const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

      for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
        await db.insertInto('embeddings').values({
          id: randomUUID() as any, entity_type: 'candidate', entity_id: candidate.id,
          purpose, vector: vector as any, model: 'text-embedding-3-small', created_at: new Date(),
        }).onConflict((oc) => oc.columns(['entity_type', 'entity_id', 'purpose']).doUpdateSet({
          vector: vector as any,
        })).execute()
      }

      // Re-score against all jobs
      await scoreFast(db, candidate.id)

      results.push({
        name: candidateName,
        oldName: candidate.name,
        skills: parsed.skills.length,
        industry: industryResult.industry,
        region: regionResult,
      })

      processed++
      console.log(`  ✓ "${candidate.name}" → "${candidateName}" | ${parsed.skills.length} skills | ${industryResult.industry} | ${regionResult}`)
    } catch (error: any) {
      failed++
      console.error(`  ✗ Failed: ${error.message?.slice(0, 120)}`)
    }

    // Rate limit: 3s between candidates (Groq only)
    if (processed + failed < candidates.length) {
      console.log(`  Waiting 3s...`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[Reparse] Complete: ${processed} succeeded, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  console.log(`\nResults:`)
  for (const r of results) {
    const nameChanged = r.oldName !== r.name ? ` (${r.oldName} → ${r.name})` : ''
    console.log(`  ${r.name}${nameChanged} | ${r.skills} skills | ${r.industry} | ${r.region}`)
  }

  await db.destroy()
}

main().catch(console.error)
