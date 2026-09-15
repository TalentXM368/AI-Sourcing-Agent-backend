import { db } from '../db/index.js'
import { pool } from '../db/index.js'
import { computeSkillScore } from './skills.js'
import { computeExperienceScore } from './experience.js'
import { computeEducationScore } from './education.js'
import { computeClientFitScore } from './client-fit.js'
import { evaluateCandidateWithLLM, type LLMEvaluation } from './llm-evaluation.js'
import { computeAtsScore } from './ats.js'
import { randomUUID } from 'crypto'
import { getEmbeddingService } from '../modules/vector-intelligence/factory.js'
import { cosineSimilarity } from '../services/openai.js'

const VECTOR_CONSTANTS = { COLLECTIONS: { CANDIDATES: 'candidates', JOBS: 'jobs' } }

const TOP_K_CANDIDATES = 500
const TOP_K_PER_JOB = 25

// ─── Helpers ─────────────────────────────────────────────────

function parseSkills(raw: unknown): any[] {
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function getClientContext(job: any) {
  if (!job.client_id) return null
  return {
    hiring_preferences: job.hiring_preferences,
    role_context: job.role_context,
    historical_patterns: job.historical_patterns,
  }
}

// ─── Reliable Single-Row Upsert ──────────────────────────────

async function upsertRankedCandidate(row: any): Promise<boolean> {
  try {
    await db.insertInto('ranked_candidates')
      .values(row)
      .onConflict((oc) => oc.columns(['job_id', 'candidate_id']).doUpdateSet({
        semantic_score: row.semantic_score,
        skill_score: row.skill_score,
        experience_score: row.experience_score,
        education_score: row.education_score,
        client_fit_score: row.client_fit_score,
        total_score: row.total_score,
        exact_matches: row.exact_matches,
        semantic_matches: row.semantic_matches,
        missing_skills: row.missing_skills,
        explanation: row.explanation,
        llm_score: row.llm_score,
        llm_verdict: row.llm_verdict,
        llm_reasoning: row.llm_reasoning,
        ats_score: row.ats_score,
      }))
      .execute()
    return true
  } catch (err: any) {
    console.error(`[Scoring] Upsert failed for candidate ${row.candidate_id} job ${row.job_id}:`, err.message?.slice(0, 200))
    return false
  }
}

// ─── Fetch Candidates by IDs (no vectors) ──────────────────────

async function fetchCandidatesByIds(candidateIds: string[], createdById?: string | null): Promise<Map<string, any>> {
  if (candidateIds.length === 0) return new Map()

  const COLUMNS = [
    'id', 'name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url',
    'headline', 'location', 'summary', 'experience_years',
    'skills', 'companies', 'work_history', 'education', 'projects',
    'certifications', 'languages', 'resume_url', 'data_quality_score',
    'missing_fields', 'stage', 'industry', 'region', 'source',
  ] as const

  const candidates: any[] = []
  const chunkSize = 100
  for (let i = 0; i < candidateIds.length; i += chunkSize) {
    const chunk = candidateIds.slice(i, i + chunkSize)
    const results = await db.selectFrom('candidates')
      .select(COLUMNS)
      .where('candidates.id', 'in', chunk)
      .where('parse_status', '=', 'completed')
      .$if(Boolean(createdById), query => query.where('created_by_id', '=', createdById!))
      .execute()
    for (const c of results) {
      candidates.push(c)
    }
  }

  const map = new Map<string, any>()
  for (const c of candidates) {
    map.set(c.id, c)
  }
  return map
}

// ─── Main Scoring Orchestrator ───────────────────────────────

export async function matchCandidateToAllJobs(candidateId: string): Promise<void> {
  const candidate = await db.selectFrom('candidates')
    .select(['id', 'name', 'skills', 'experience_years', 'education', 'work_history', 'companies', 'headline', 'location', 'summary'])
    .where('id', '=', candidateId)
    .where('parse_status', '=', 'completed')
    .executeTakeFirst()

  if (!candidate) return

  const jobs = await db.selectFrom('jobs')
    .select(['id', 'required_skills', 'nice_to_have_skills', 'avoid_skills', 'experience_min', 'experience_max', 'client_id', 'description', 'role', 'location'])
    .where('status', '=', 'open')
    .execute()

  // Use Qdrant semantic search to find candidates for each job
  const embeddingService = getEmbeddingService()

  for (const job of jobs) {
    try {
      const clientContext = getClientContext(job)
      const candVec = await getCandidateVector(candidateId)
      const jobVec = await getJobVector(job.id)

      let semanticScore = 0
      if (candVec && jobVec) {
        try { semanticScore = cosineSimilarity(jobVec, candVec) * 100 } catch { semanticScore = 0 }
      }

      const row = computeScoreRow(candidate, candVec, job, clientContext, jobVec, false, semanticScore)
      await upsertRankedCandidate(row)
    } catch (err: any) {
      console.error(`[Scoring] Failed to score candidate "${candidate.name}" for job "${job.role}":`, err.message)
    }
  }

  // Phase 2: LLM enhancement for this candidate
  for (const job of jobs) {
    enhanceSingleCandidateWithLLM(candidateId, job.id).catch(() => {})
  }
}

export async function matchJobToAllCandidates(jobId: string): Promise<void> {
  const job = await db.selectFrom('jobs')
    .select(['id', 'role', 'required_skills', 'nice_to_have_skills', 'avoid_skills', 'experience_min', 'experience_max', 'client_id', 'description', 'location', 'created_by_id'])
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!job) return

  // Use Qdrant for semantic search to get top candidates
  const embeddingService = getEmbeddingService()
  const qdrantCandidateIds: string[] = []

  try {
    if (embeddingService) {
      const searchQuery = `${job.role} ${job.required_skills?.join(' ') || ''} ${job.location || ''}`
      const results = await embeddingService.searchCandidates(searchQuery, TOP_K_CANDIDATES)
      for (const r of results) qdrantCandidateIds.push(r.entityId)
      console.log(`[Scoring] Qdrant returned ${qdrantCandidateIds.length} candidates for "${job.role}"`)
    }
  } catch (err) {
    console.warn('[Scoring] Qdrant search failed, using all candidates:', err)
  }

  // If Qdrant failed, fall back to all completed candidates (limited)
  if (qdrantCandidateIds.length === 0) {
    const allCandidates = await db.selectFrom('candidates')
      .select('id')
      .where('parse_status', '=', 'completed')
      .where('created_by_id', '=', job.created_by_id!)
      .limit(TOP_K_CANDIDATES)
      .execute()
    qdrantCandidateIds.push(...allCandidates.map(c => c.id))
  }

  // Fetch candidate metadata (no vectors)
  const candidates = await fetchCandidatesByIds(qdrantCandidateIds, job.created_by_id)
  const clientContext = job.client_id ? await getClientContextFromDB(job.client_id) : null

  // Batch-load job embedding vector from Qdrant
  const jobVec = await getJobVector(jobId)

  // Compute all scores in memory
  const rows: any[] = []
  let scored = 0
  for (const [candidateId, candidate] of candidates) {
    try {
      const candVec = await getCandidateVector(candidateId)
      const row = computeScoreRow(candidate, candVec, job, clientContext, jobVec, false, 0)
      rows.push(row)
      scored++
    } catch (err: any) {
      console.error(`[Scoring] Failed to score "${candidate.name}":`, err.message)
    }
  }

  // Write each row individually
  let written = 0
  let failed = 0
  for (const row of rows) {
    let ok = await upsertRankedCandidate(row)
    if (!ok) {
      await new Promise(r => setTimeout(r, 200))
      ok = await upsertRankedCandidate(row)
    }
    if (ok) written++
    else failed++
  }

  // Clean up old ranked candidates for this job (keep top 25 per job)
  await cleanupRankedCandidates(jobId)

  console.log(`[Scoring] Phase 1 complete: ${written}/${scored} scored (${failed} failed) for "${job.role}"`)

  // Phase 2: LLM enhancement for top candidates only
  const topCandidates = rows.sort((a, b) => b.total_score - a.total_score).slice(0, 25)
  for (const row of topCandidates) {
    const candidate = candidates.get(row.candidate_id)
    if (candidate) {
      enhanceSingleCandidateWithLLM(row.candidate_id, jobId).catch(() => {})
    }
  }
}

export async function matchJobToCandidateIds(jobId: string, candidateIds: string[]): Promise<void> {
  if (candidateIds.length === 0) return

  const job = await db.selectFrom('jobs')
    .select(['id', 'role', 'required_skills', 'nice_to_have_skills', 'avoid_skills', 'experience_min', 'experience_max', 'client_id', 'description', 'location', 'created_by_id'])
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!job) return

  const candidates = await fetchCandidatesByIds(candidateIds, job.created_by_id)
  const clientContext = job.client_id ? await getClientContextFromDB(job.client_id) : null
  const jobVec = await getJobVector(jobId)

  const rows: any[] = []
  for (const [candidateId, candidate] of candidates) {
    try {
      const candVec = await getCandidateVector(candidateId)
      const row = computeScoreRow(candidate, candVec, job, clientContext, jobVec, false, 0)
      rows.push(row)
    } catch (err: any) {
      console.error(`[Scoring] Failed to score "${candidate.name}":`, err.message)
    }
  }

  for (const row of rows) {
    let ok = await upsertRankedCandidate(row)
    if (!ok) {
      await new Promise(r => setTimeout(r, 200))
      ok = await upsertRankedCandidate(row)
    }
  }

  await cleanupRankedCandidates(jobId)
  console.log(`[Scoring] Selective: ${rows.length} scored for "${job.role}"`)
}

// ─── Phase 2: LLM Enhancement ────────────────────────────────

export async function enhanceJobScoresWithLLM(jobId: string): Promise<void> {
  const job = await db.selectFrom('jobs')
    .select(['id', 'client_id'])
    .where('id', '=', jobId)
    .executeTakeFirst()
  if (!job) return

  if (!process.env.GROQ_API_KEY) return

  const ranked = await db.selectFrom('ranked_candidates')
    .select(['candidate_id', 'job_id'])
    .where('job_id', '=', jobId)
    .where('llm_score', '=', 0)
    .execute()

  if (ranked.length === 0) return

  const clientContext = job.client_id ? await getClientContextFromDB(job.client_id) : null
  const candidateIds = ranked.map(r => r.candidate_id)
  const candidates = await fetchCandidatesByIds(candidateIds)
  const jobRow = await db.selectFrom('jobs').select(['id', 'role', 'required_skills', 'nice_to_have_skills', 'avoid_skills', 'experience_min', 'experience_max', 'description', 'client_id']).where('id', '=', jobId).executeTakeFirst()
  const jobVec = await getJobVector(jobId)

  let enhanced = 0
  for (const rc of ranked) {
    const candidate = candidates.get(rc.candidate_id)
    if (!candidate) continue
    try {
      await scoreCandidateForJob(candidate, await getCandidateVector(rc.candidate_id), jobRow || job, clientContext, jobVec, true)
      enhanced++
    } catch (err: any) {
      console.error(`[Scoring] LLM enhance failed for ${candidate.name}:`, err.message)
    }
  }
  console.log(`[Scoring] Phase 2: ${enhanced}/${ranked.length} enhanced with LLM`)
}

export async function enhanceSingleCandidateWithLLM(candidateId: string, jobId: string): Promise<void> {
  const candidate = await db.selectFrom('candidates')
    .select(['id', 'name', 'skills', 'experience_years', 'education', 'work_history', 'companies', 'headline', 'location', 'summary'])
    .where('id', '=', candidateId)
    .where('parse_status', '=', 'completed')
    .executeTakeFirst()

  const job = await db.selectFrom('jobs')
    .select(['id', 'role', 'required_skills', 'nice_to_have_skills', 'avoid_skills', 'experience_min', 'experience_max', 'client_id', 'description', 'location'])
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!candidate || !job) return
  if (!process.env.GROQ_API_KEY) return

  const existing = await db.selectFrom('ranked_candidates')
    .select('llm_score')
    .where('candidate_id', '=', candidateId)
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  if (existing && existing.llm_score && existing.llm_score > 0) return

  const clientContext = job.client_id ? await getClientContextFromDB(job.client_id) : null
  const candVec = await getCandidateVector(candidateId)
  const jobVec = await getJobVector(jobId)

  try {
    await scoreCandidateForJob(candidate, candVec, job, clientContext, jobVec, true)
  } catch (err: any) {
    console.error(`[Scoring] Phase 2 (single) failed for ${candidate.name}:`, err.message)
  }
}

// ─── Compute Score Row (no DB calls) ─────────────────────────

function computeScoreRow(
  candidate: any,
  candVector: number[] | null,
  job: any,
  clientContext?: any,
  jobVector?: number[] | null,
  useLLM: boolean = false,
  semanticScoreOverride?: number,
): any {
  // Semantic score
  let semantic = semanticScoreOverride ?? 0
  if (candVector && jobVector && semanticScoreOverride === undefined) {
    try { semantic = cosineSimilarity(jobVector, candVector) * 100 } catch { semantic = 0 }
  }

  // Skill score
  const candidateSkills = parseSkills(candidate.skills).map((s: any) => s.name || s)
  const skillResult = computeSkillScore(job.required_skills || [], candidateSkills)

  // Experience score
  const experience = computeExperienceScore(job.experience_max, candidate.experience_years)

  // Education score
  const education = computeEducationScore(candidate.education)

  // Client fit score
  let clientFit: number | null = null
  if (clientContext) clientFit = computeClientFitScore(candidate, clientContext, job)

  // ATS score
  const parsedCandidate = {
    name: candidate.name, email: candidate.email, phone: candidate.phone,
    linkedin_url: candidate.linkedin_url, github_url: candidate.github_url,
    headline: candidate.headline, summary: candidate.summary,
    experience_years: candidate.experience_years,
    skills: parseSkills(candidate.skills),
    work_history: Array.isArray(candidate.work_history) ? candidate.work_history : [],
    education: Array.isArray(candidate.education) ? candidate.education : [],
    resume_url: candidate.resume_url,
  }
  const parsedJob = {
    role: job.role, required_skills: job.required_skills || [],
    nice_to_have_skills: job.nice_to_have_skills || [],
    experience_min: job.experience_min, experience_max: job.experience_max,
    description: job.description,
  }
  const atsResult = computeAtsScore(parsedCandidate as any, parsedJob as any)

  // Weighted total
  const weights = { semantic: 0.25, skill: 0.35, experience: 0.15, education: 0.05, client_fit: 0.05, ats: 0.10, llm: 0.05 }
  const baseScore = Math.round(
    semantic * weights.semantic +
    skillResult.score * weights.skill +
    experience * weights.experience +
    education * weights.education +
    (clientFit ?? 50) * weights.client_fit +
    atsResult.ats_score * weights.ats +
    50 * weights.llm
  )
  const total = Math.max(0, Math.min(100, baseScore))

  const explanation = [
    skillResult.exact.length > 0 ? `Matches: ${skillResult.exact.slice(0, 3).join(', ')}` : null,
    skillResult.missing.length > 0 ? `Missing: ${skillResult.missing.slice(0, 3).join(', ')}` : null,
    experience >= 70 ? `Experience fits (${candidate.experience_years}y)` : null,
  ].filter(Boolean).join('. ')

  return {
    id: randomUUID(),
    job_id: job.id,
    candidate_id: candidate.id,
    semantic_score: Math.round(semantic),
    skill_score: skillResult.score,
    experience_score: experience,
    education_score: education,
    client_fit_score: clientFit ?? 50,
    total_score: total,
    exact_matches: skillResult.exact,
    semantic_matches: skillResult.semantic,
    missing_skills: skillResult.missing,
    avoid_signals: [],
    explanation,
    llm_score: 0, llm_verdict: null, llm_reasoning: null,
    ats_score: atsResult.ats_score,
    decision: 'pending',
    created_at: new Date(),
  }
}

// ─── Score Single Candidate for Job ──────────────────────────

async function scoreCandidateForJob(
  candidate: any, candVector: number[] | null, job: any,
  clientContext?: any, jobVector?: number[] | null, useLLM: boolean = false
): Promise<void> {
  let semantic = 0
  if (candVector && jobVector) {
    try { semantic = cosineSimilarity(jobVector, candVector) * 100 } catch { semantic = 0 }
  }

  const candidateSkills = parseSkills(candidate.skills).map((s: any) => s.name || s)
  const skillResult = computeSkillScore(job.required_skills || [], candidateSkills)
  const experience = computeExperienceScore(job.experience_max, candidate.experience_years)
  const education = computeEducationScore(candidate.education)
  let clientFit: number | null = null
  if (clientContext) clientFit = computeClientFitScore(candidate, clientContext, job)

  let llmEval: LLMEvaluation | null = null
  if (useLLM) {
    try { llmEval = await evaluateCandidateWithLLM(candidate, job) } catch { llmEval = null }
  }

  const parsedCandidate = {
    name: candidate.name, email: candidate.email, phone: candidate.phone,
    linkedin_url: candidate.linkedin_url, github_url: candidate.github_url,
    headline: candidate.headline, summary: candidate.summary,
    experience_years: candidate.experience_years, skills: parseSkills(candidate.skills),
    work_history: Array.isArray(candidate.work_history) ? candidate.work_history : [],
    education: Array.isArray(candidate.education) ? candidate.education : [],
    resume_url: candidate.resume_url,
  }
  const parsedJob = {
    role: job.role, required_skills: job.required_skills || [],
    nice_to_have_skills: job.nice_to_have_skills || [],
    experience_min: job.experience_min, experience_max: job.experience_max,
    description: job.description,
  }
  const atsResult = computeAtsScore(parsedCandidate as any, parsedJob as any)

  let total: number
  if (clientFit === null) {
    if (candVector && jobVector && llmEval) total = semantic * 0.25 + skillResult.score * 0.25 + experience * 0.10 + llmEval.score * 0.40
    else if (candVector && jobVector) total = semantic * 0.45 + skillResult.score * 0.40 + experience * 0.15
    else if (llmEval) total = skillResult.score * 0.40 + experience * 0.15 + llmEval.score * 0.45
    else total = skillResult.score * 0.60 + experience * 0.25 + education * 0.15
  } else {
    if (candVector && jobVector && llmEval) total = semantic * 0.20 + skillResult.score * 0.20 + experience * 0.10 + education * 0.05 + clientFit * 0.10 + llmEval.score * 0.35
    else if (candVector && jobVector) total = semantic * 0.30 + skillResult.score * 0.30 + experience * 0.15 + education * 0.10 + clientFit * 0.15
    else if (llmEval) total = skillResult.score * 0.30 + experience * 0.15 + education * 0.10 + clientFit * 0.10 + llmEval.score * 0.35
    else total = skillResult.score * 0.45 + experience * 0.20 + education * 0.15 + clientFit * 0.20
  }
  total = Math.round(Math.min(100, Math.max(0, total)))
  if (clientFit !== null && clientFit < 40) total = Math.round(total * 0.85)

  const explanation = generateExplanation(skillResult, experience, clientFit, clientContext, llmEval)

  await db.insertInto('ranked_candidates')
    .values({
      id: randomUUID(), job_id: job.id, candidate_id: candidate.id,
      semantic_score: Math.round(semantic), skill_score: skillResult.score,
      experience_score: experience, education_score: education,
      client_fit_score: clientFit ?? 50, total_score: total,
      exact_matches: skillResult.exact, semantic_matches: skillResult.semantic,
      missing_skills: skillResult.missing, avoid_signals: [], explanation,
      llm_score: llmEval?.score ?? 0, llm_verdict: llmEval?.verdict ?? null,
      llm_reasoning: llmEval?.reasoning ?? null, ats_score: atsResult.ats_score,
      decision: 'pending', created_at: new Date(),
    })
    .onConflict((oc) => oc.columns(['job_id', 'candidate_id']).doUpdateSet({
      semantic_score: Math.round(semantic), skill_score: skillResult.score,
      experience_score: experience, education_score: education,
      client_fit_score: clientFit ?? 50, total_score: total,
      exact_matches: skillResult.exact, semantic_matches: skillResult.semantic,
      missing_skills: skillResult.missing, explanation,
      llm_score: llmEval?.score ?? 0, llm_verdict: llmEval?.verdict ?? null,
      llm_reasoning: llmEval?.reasoning ?? null, ats_score: atsResult.ats_score,
    }))
    .execute()
}

// ─── Helpers ─────────────────────────────────────────────────

function generateExplanation(
  skillResult: { score: number; exact: string[]; semantic: string[]; missing: string[] },
  experience: number, clientFit: number | null, clientContext?: any, llmEval?: LLMEvaluation | null
): string {
  const parts: string[] = []
  if (llmEval?.verdict) parts.push(llmEval.verdict)
  if (skillResult.exact.length > 0) parts.push(`${skillResult.exact.length}/${skillResult.exact.length + skillResult.semantic.length + skillResult.missing.length} skills matched exactly`)
  if (skillResult.semantic.length > 0) parts.push(`${skillResult.semantic.length} skills matched semantically`)
  if (skillResult.missing.length > 0) parts.push(`Missing: ${skillResult.missing.slice(0, 3).join(', ')}`)
  if (experience >= 80) parts.push('Strong experience match')
  else if (experience >= 60) parts.push('Good experience match')
  else parts.push('Experience gap')
  if (clientFit !== null) {
    if (clientFit >= 80) parts.push('Excellent client fit')
    else if (clientFit >= 60) parts.push('Good client fit')
    else parts.push('Limited client fit')
  }
  return parts.join('. ')
}

async function getClientContextFromDB(clientId: string): Promise<any> {
  const client = await db.selectFrom('clients').select(['id', 'hiring_preferences', 'role_context', 'historical_patterns']).where('id', '=', clientId).executeTakeFirst()
  if (!client) return null
  return { hiring_preferences: client.hiring_preferences, role_context: client.role_context, historical_patterns: client.historical_patterns }
}

// ─── Embedding Vector Helpers (Qdrant + metadata-only PostgreSQL) ──

async function getCandidateVector(candidateId: string): Promise<number[] | null> {
  try {
    const { QdrantManager } = await import('../modules/vector-intelligence/qdrant/qdrant-manager.js')
    const manager = new QdrantManager()
    const client = manager.getClient()
    const result = await client.retrieve(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, { ids: [candidateId] } as any)
    if ((result as any).points && (result as any).points.length > 0 && (result as any).points[0].vector) {
      return (result as any).points[0].vector as number[]
    }
  } catch {}
  return null
}

async function getJobVector(jobId: string): Promise<number[] | null> {
  try {
    const { QdrantManager } = await import('../modules/vector-intelligence/qdrant/qdrant-manager.js')
    const manager = new QdrantManager()
    const client = manager.getClient()
    const result = await client.retrieve(VECTOR_CONSTANTS.COLLECTIONS.JOBS, { ids: [jobId] } as any)
    if ((result as any).points && (result as any).points.length > 0 && (result as any).points[0].vector) {
      return (result as any).points[0].vector as number[]
    }
  } catch {}
  return null
}

async function cleanupRankedCandidates(jobId: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM ranked_candidates WHERE job_id = $1 AND id NOT IN (SELECT id FROM ranked_candidates WHERE job_id = $2 ORDER BY total_score DESC LIMIT $3)`,
      [jobId, jobId, TOP_K_PER_JOB]
    )
  } catch {}
}

// Import cosineSimilarity (used in legacy paths)

// VECTOR_CONSTANTS defined at top
