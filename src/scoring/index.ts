import { db } from '../db/index.js'
import { cosineSimilarity } from '../services/openai.js'
import { computeSkillScore } from './skills.js'
import { computeExperienceScore } from './experience.js'
import { computeEducationScore } from './education.js'
import { computeClientFitScore } from './client-fit.js'
import { evaluateCandidateWithLLM, type LLMEvaluation } from './llm-evaluation.js'
import { computeAtsScore } from './ats.js'
import { randomUUID } from 'crypto'

// ─── Main Scoring Orchestrator ────────────────────────────────

export async function matchCandidateToAllJobs(candidateId: string): Promise<void> {
  const candidate = await db.selectFrom('candidates')
    .selectAll()
    .where('id', '=', candidateId)
    .executeTakeFirst()

  if (!candidate) return

  const candEmbedding = await db.selectFrom('embeddings')
    .select('vector')
    .where('entity_id', '=', candidateId)
    .where('entity_type', '=', 'candidate')
    .where('purpose', '=', 'full_text')
    .executeTakeFirst()

  const jobs = await db.selectFrom('jobs')
    .selectAll()
    .where('status', '=', 'open')
    .execute()

  // Batch-load all job embeddings in one query (avoids N+1)
  const jobIds = jobs.map(j => j.id)
  const allJobEmbeddings = jobIds.length > 0
    ? await db.selectFrom('embeddings')
        .select(['entity_id', 'vector'])
        .where('entity_type', '=', 'job')
        .where('purpose', '=', 'full_text')
        .where('entity_id', 'in', jobIds)
        .execute()
    : []

  const jobEmbMap = new Map<string, number[]>()
  for (const e of allJobEmbeddings) jobEmbMap.set(e.entity_id, e.vector as number[])

  const candVec = candEmbedding?.vector as number[] | undefined

  for (const job of jobs) {
    const jobVec = jobEmbMap.get(job.id)
    const useSemantic = !!(jobVec && candVec && jobVec.length === candVec.length)

    await scoreCandidateForJob(candidate, useSemantic ? candVec! : null, job, undefined, useSemantic ? jobVec! : null, false)
  }

  // Phase 2: enhance with LLM in background for all open jobs
  for (const job of jobs) {
    enhanceJobScoresWithLLM(job.id).catch(() => {})
  }
}

export async function matchJobToAllCandidates(jobId: string): Promise<void> {
  const job = await db.selectFrom('jobs')
    .selectAll()
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!job) return

  const jobEmbedding = await db.selectFrom('embeddings')
    .select(['entity_id', 'vector'])
    .where('entity_id', '=', jobId)
    .where('entity_type', '=', 'job')
    .where('purpose', '=', 'full_text')
    .executeTakeFirst()

  let clientContext: any = null
  if (job.client_id) {
    const client = await db.selectFrom('clients')
      .selectAll()
      .where('id', '=', job.client_id)
      .executeTakeFirst()
    if (client) {
      clientContext = {
        hiring_preferences: client.hiring_preferences as any,
        role_context: client.role_context as any,
        historical_patterns: client.historical_patterns as any,
      }
    }
  }

  const candidates = await db.selectFrom('candidates')
    .selectAll()
    .where('parse_status', '=', 'completed')
    .execute()

  // Batch-load ALL candidate embeddings in one query (avoids N+1)
  const candidateIds = candidates.map(c => c.id)
  const allEmbeddings = await db.selectFrom('embeddings')
    .select(['entity_id', 'vector'])
    .where('entity_type', '=', 'candidate')
    .where('purpose', '=', 'full_text')
    .where('entity_id', 'in', candidateIds)
    .execute()

  const embeddingMap = new Map<string, number[]>()
  for (const e of allEmbeddings) {
    embeddingMap.set(e.entity_id, e.vector as number[])
  }

  console.log(`[Scoring] Phase 1: Scoring ${candidates.length} candidates for "${job.role}" (${embeddingMap.size} embeddings)`)

  const jobVec = jobEmbedding?.vector as number[] | undefined

  // Score ALL candidates instantly
  for (const candidate of candidates) {
    const candVec = embeddingMap.get(candidate.id)
    const useSemantic = !!(jobVec && candVec && jobVec.length === candVec.length)

    await scoreCandidateForJob(candidate, useSemantic ? candVec! : null, job, clientContext, useSemantic ? jobVec! : null, false)
  }

  console.log(`[Scoring] Phase 1 complete: ${candidates.length} candidates scored instantly`)

  // Phase 2: Enhance with LLM in background
  enhanceJobScoresWithLLM(jobId).catch(() => {})
}

// ─── Phase 2: LLM Enhancement (background) ───────────────────

export async function enhanceJobScoresWithLLM(jobId: string): Promise<void> {
  const job = await db.selectFrom('jobs')
    .selectAll()
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!job) return

  if (!process.env.GROQ_API_KEY) {
    console.log(`[Scoring] Phase 2 skipped: no Groq API key`)
    return
  }

  const ranked = await db.selectFrom('ranked_candidates')
    .selectAll()
    .where('job_id', '=', jobId)
    .execute()

  // Only enhance candidates that haven't been LLM-evaluated yet
  const needsLLM = ranked.filter(r => !r.llm_score || r.llm_score === 0)

  if (needsLLM.length === 0) {
    console.log(`[Scoring] Phase 2: All candidates already have LLM scores`)
    return
  }

  console.log(`[Scoring] Phase 2: Enhancing ${needsLLM.length} candidates with LLM evaluation`)

  let clientContext: any = null
  if (job.client_id) {
    const client = await db.selectFrom('clients')
      .selectAll()
      .where('id', '=', job.client_id)
      .executeTakeFirst()
    if (client) {
      clientContext = {
        hiring_preferences: client.hiring_preferences as any,
        role_context: client.role_context as any,
        historical_patterns: client.historical_patterns as any,
      }
    }
  }

  // Batch-load all needed embeddings
  const candidateIds = needsLLM.map(r => r.candidate_id)
  const [allCandEmbeddings, jobEmb] = await Promise.all([
    db.selectFrom('embeddings')
      .select(['entity_id', 'vector'])
      .where('entity_type', '=', 'candidate')
      .where('purpose', '=', 'full_text')
      .where('entity_id', 'in', candidateIds)
      .execute(),
    db.selectFrom('embeddings')
      .select('vector')
      .where('entity_id', '=', jobId)
      .where('entity_type', '=', 'job')
      .where('purpose', '=', 'full_text')
      .executeTakeFirst(),
  ])

  const embMap = new Map<string, number[]>()
  for (const e of allCandEmbeddings) embMap.set(e.entity_id, e.vector as number[])

  const jobVec = jobEmb?.vector as number[] | undefined

  let enhanced = 0
  for (const rc of needsLLM) {
    const candidate = await db.selectFrom('candidates')
      .selectAll()
      .where('id', '=', rc.candidate_id)
      .executeTakeFirst()

    if (!candidate) continue

    const candVec = embMap.get(candidate.id)
    const useSemantic = !!(jobVec && candVec && jobVec.length === candVec.length)

    try {
      await scoreCandidateForJob(candidate, useSemantic ? candVec! : null, job, clientContext, useSemantic ? jobVec! : null, true)
      enhanced++
    } catch (err: any) {
      console.error(`[Scoring] LLM enhance failed for ${candidate.name}:`, err.message)
    }
  }

  console.log(`[Scoring] Phase 2 complete: ${enhanced}/${needsLLM.length} enhanced with LLM`)
}

// ─── Score Single Candidate for Job ───────────────────────────

async function scoreCandidateForJob(
  candidate: any,
  candVector: number[] | null,
  job: any,
  clientContext?: any,
  jobVector?: number[] | null,
  useLLM: boolean = false
): Promise<void> {
  // 1. Semantic score (only if real embeddings available)
  let semantic = 0
  if (candVector && jobVector) {
    try {
      semantic = cosineSimilarity(jobVector, candVector) * 100
    } catch {
      semantic = 0
    }
  }

  // 2. Skill score
  const candidateSkills = Array.isArray(candidate.skills)
    ? (candidate.skills as any[]).map((s: any) => s.name || s)
    : []
  const skillResult = computeSkillScore(job.required_skills || [], candidateSkills)

  // 3. Experience score
  const experience = computeExperienceScore(job.experience_max, candidate.experience_years)

  // 4. Education score
  const education = computeEducationScore(candidate.education)

  // 5. Client fit score (if available)
  let clientFit: number | null = null
  if (clientContext) {
    clientFit = computeClientFitScore(candidate, clientContext, job)
  }

  // 6. LLM evaluation — only when explicitly requested (Phase 2)
  let llmEval: LLMEvaluation | null = null
  if (useLLM) {
    try {
      llmEval = await evaluateCandidateWithLLM(candidate, job)
    } catch (error) {
      console.error(`[Scoring] LLM eval failed for ${candidate.name}:`, error)
    }
  }

  // 7. ATS compatibility score
  const parsedCandidate = {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    linkedin_url: candidate.linkedin_url,
    github_url: candidate.github_url,
    headline: candidate.headline,
    summary: candidate.summary,
    experience_years: candidate.experience_years,
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
    work_history: Array.isArray(candidate.work_history) ? candidate.work_history : [],
    education: Array.isArray(candidate.education) ? candidate.education : [],
    resume_url: candidate.resume_url,
  }
  const parsedJob = {
    role: job.role,
    required_skills: job.required_skills || [],
    nice_to_have_skills: job.nice_to_have_skills || [],
    experience_min: job.experience_min,
    experience_max: job.experience_max,
    description: job.description,
  }
  const atsResult = computeAtsScore(parsedCandidate as any, parsedJob as any)

  // Calculate total score
  let total: number
  const hasSemantic = semantic !== 0

  if (clientFit === null) {
    if (hasSemantic && llmEval) {
      total = semantic * 0.25 + skillResult.score * 0.25 + experience * 0.10 + llmEval.score * 0.40
    } else if (hasSemantic) {
      total = semantic * 0.45 + skillResult.score * 0.40 + experience * 0.15
    } else if (llmEval) {
      total = skillResult.score * 0.40 + experience * 0.15 + llmEval.score * 0.45
    } else {
      total = skillResult.score * 0.60 + experience * 0.25 + education * 0.15
    }
  } else {
    if (hasSemantic && llmEval) {
      total = semantic * 0.20 + skillResult.score * 0.20 + experience * 0.10 + education * 0.05 + clientFit * 0.10 + llmEval.score * 0.35
      if (clientFit < 40) total *= 0.85
    } else if (hasSemantic) {
      total = semantic * 0.30 + skillResult.score * 0.30 + experience * 0.15 + education * 0.10 + clientFit * 0.15
      if (clientFit < 40) total *= 0.85
    } else if (llmEval) {
      total = skillResult.score * 0.30 + experience * 0.15 + education * 0.10 + clientFit * 0.10 + llmEval.score * 0.35
      if (clientFit < 40) total *= 0.85
    } else {
      total = skillResult.score * 0.45 + experience * 0.20 + education * 0.15 + clientFit * 0.20
      if (clientFit < 40) total *= 0.85
    }
  }
  total = Math.round(Math.min(100, Math.max(0, total)))

  // Generate explanation
  const explanation = generateExplanation(skillResult, experience, clientFit, clientContext, llmEval)

  // Upsert ranked candidate
  await db.insertInto('ranked_candidates')
    .values({
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
      llm_score: llmEval?.score ?? 0,
      llm_verdict: llmEval?.verdict ?? null,
      llm_reasoning: llmEval?.reasoning ?? null,
      ats_score: atsResult.ats_score,
      decision: 'pending',
      created_at: new Date(),
    })
    .onConflict((oc) => oc.columns(['job_id', 'candidate_id']).doUpdateSet({
      semantic_score: Math.round(semantic),
      skill_score: skillResult.score,
      experience_score: experience,
      education_score: education,
      client_fit_score: clientFit ?? 50,
      total_score: total,
      exact_matches: skillResult.exact,
      semantic_matches: skillResult.semantic,
      missing_skills: skillResult.missing,
      explanation,
      llm_score: llmEval?.score ?? 0,
      llm_verdict: llmEval?.verdict ?? null,
      llm_reasoning: llmEval?.reasoning ?? null,
      ats_score: atsResult.ats_score,
    }))
    .execute()
}

// ─── Explanation Generator ────────────────────────────────────

function generateExplanation(
  skillResult: { score: number; exact: string[]; semantic: string[]; missing: string[] },
  experience: number,
  clientFit: number | null,
  clientContext?: any,
  llmEval?: LLMEvaluation | null
): string {
  const parts: string[] = []

  if (llmEval?.verdict) {
    parts.push(llmEval.verdict)
  }

  if (skillResult.exact.length > 0) {
    parts.push(`${skillResult.exact.length}/${skillResult.exact.length + skillResult.semantic.length + skillResult.missing.length} skills matched exactly`)
  }
  if (skillResult.semantic.length > 0) {
    parts.push(`${skillResult.semantic.length} skills matched semantically`)
  }
  if (skillResult.missing.length > 0) {
    parts.push(`Missing: ${skillResult.missing.slice(0, 3).join(', ')}`)
  }

  if (experience >= 80) {
    parts.push('Strong experience match')
  } else if (experience >= 60) {
    parts.push('Good experience match')
  } else {
    parts.push('Experience gap')
  }

  if (clientFit !== null) {
    if (clientFit >= 80) {
      parts.push('Excellent client fit')
    } else if (clientFit >= 60) {
      parts.push('Good client fit')
    } else {
      parts.push('Limited client fit')
    }
  }

  return parts.join('. ')
}
