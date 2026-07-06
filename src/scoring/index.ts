import { db } from '../db/index.js'
import { cosineSimilarity } from '../services/openai.js'
import { computeSkillScore } from './skills.js'
import { computeExperienceScore } from './experience.js'
import { computeEducationScore } from './education.js'
import { computeClientFitScore } from './client-fit.js'
import { evaluateCandidateWithLLM, type LLMEvaluation } from './llm-evaluation.js'
import { randomUUID } from 'crypto'

// ─── Main Scoring Orchestrator ────────────────────────────────

export async function matchCandidateToAllJobs(candidateId: string): Promise<void> {
  // Load candidate with embeddings
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

  if (!candEmbedding) return

  // Load all open jobs
  const jobs = await db.selectFrom('jobs')
    .selectAll()
    .where('status', '=', 'open')
    .execute()

  for (const job of jobs) {
    await scoreCandidateForJob(candidate, candEmbedding.vector, job)
  }
}

export async function matchJobToAllCandidates(jobId: string): Promise<void> {
  // Load job with embeddings
  const job = await db.selectFrom('jobs')
    .selectAll()
    .where('id', '=', jobId)
    .executeTakeFirst()

  if (!job) return

  const jobEmbedding = await db.selectFrom('embeddings')
    .select('vector')
    .where('entity_id', '=', jobId)
    .where('entity_type', '=', 'job')
    .where('purpose', '=', 'full_text')
    .executeTakeFirst()

  if (!jobEmbedding) return

  // Load client context if linked
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

  // Load all completed candidates
  const candidates = await db.selectFrom('candidates')
    .selectAll()
    .where('parse_status', '=', 'completed')
    .execute()

  for (const candidate of candidates) {
    const candEmbedding = await db.selectFrom('embeddings')
      .select('vector')
      .where('entity_id', '=', candidate.id)
      .where('entity_type', '=', 'candidate')
      .where('purpose', '=', 'full_text')
      .executeTakeFirst()

    if (!candEmbedding) continue

    await scoreCandidateForJob(candidate, candEmbedding.vector, job, clientContext)
  }
}

// ─── Score Single Candidate for Job ───────────────────────────

async function scoreCandidateForJob(
  candidate: any,
  candVector: number[],
  job: any,
  clientContext?: any
): Promise<void> {
  // Get job embedding
  const jobEmbedding = await db.selectFrom('embeddings')
    .select('vector')
    .where('entity_id', '=', job.id)
    .where('entity_type', '=', 'job')
    .where('purpose', '=', 'full_text')
    .executeTakeFirst()

  if (!jobEmbedding) return

  // 1. Semantic score
  const semantic = cosineSimilarity(jobEmbedding.vector, candVector) * 100

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

  // 6. LLM evaluation (holistic fit analysis)
  let llmEval: LLMEvaluation | null = null
  try {
    llmEval = await evaluateCandidateWithLLM(candidate, job)
  } catch (error) {
    console.error(`[Scoring] LLM eval failed for ${candidate.name}:`, error)
  }

  // Calculate total score
  let total: number
  if (clientFit === null) {
    // No client: semantic(25%) + skill(25%) + experience(10%) + llm(40%)
    if (llmEval) {
      total = semantic * 0.25 + skillResult.score * 0.25 + experience * 0.10 + llmEval.score * 0.40
    } else {
      // Fallback to old formula if LLM failed
      total = semantic * 0.45 + skillResult.score * 0.40 + experience * 0.15
    }
  } else {
    // With client: semantic(20%) + skill(20%) + experience(10%) + education(5%) + client_fit(10%) + llm(35%)
    if (llmEval) {
      total = semantic * 0.20 + skillResult.score * 0.20 + experience * 0.10 + education * 0.05 + clientFit * 0.10 + llmEval.score * 0.35
      if (clientFit < 40) {
        total *= 0.85
      }
    } else {
      // Fallback to old formula if LLM failed
      total = semantic * 0.30 + skillResult.score * 0.30 + experience * 0.15 + education * 0.10 + clientFit * 0.15
      if (clientFit < 40) {
        total *= 0.85
      }
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

  // LLM verdict first (most prominent)
  if (llmEval?.verdict) {
    parts.push(llmEval.verdict)
  }

  // Skill explanation
  if (skillResult.exact.length > 0) {
    parts.push(`${skillResult.exact.length}/${skillResult.exact.length + skillResult.semantic.length + skillResult.missing.length} skills matched exactly`)
  }
  if (skillResult.semantic.length > 0) {
    parts.push(`${skillResult.semantic.length} skills matched semantically`)
  }
  if (skillResult.missing.length > 0) {
    parts.push(`Missing: ${skillResult.missing.slice(0, 3).join(', ')}`)
  }

  // Experience explanation
  if (experience >= 80) {
    parts.push('Strong experience match')
  } else if (experience >= 60) {
    parts.push('Good experience match')
  } else {
    parts.push('Experience gap')
  }

  // Client fit explanation
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
