import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { matchJobToAllCandidates } from '../scoring/index.js'
import { generateEmbeddings, parseJDWithAI } from '../services/openai.js'
import { classifyRegion } from '../services/region-classifier.js'
import { classifyIndustry } from '../services/industry-classifier.js'
import { runFullJobPipeline } from '../services/jd-pipeline.js'

export const jobsRouter = Router()

// ─── Validation ───────────────────────────────────────────────

const CreateJobSchema = z.object({
  role: z.string().min(2).max(120),
  company: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  required_skills: z.array(z.string()).min(1),
  nice_to_have_skills: z.array(z.string()).optional(),
  avoid_skills: z.array(z.string()).optional(),
  experience_min: z.number().min(0).max(50).optional(),
  experience_max: z.number().min(0).max(50).optional(),
  description: z.string().max(8000).optional(),
  client_id: z.string().uuid().optional(),
})

const DecisionSchema = z.object({
  candidate_id: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected']),
})

// ─── List Jobs ────────────────────────────────────────────────

jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit || 50)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const requestedOffset = Number(req.query.offset || 0)
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0
    let query = db.selectFrom('jobs').select([
      'id', 'role', 'company', 'location', 'required_skills', 'nice_to_have_skills',
      'avoid_skills', 'experience_min', 'experience_max', 'industry', 'region', 'status',
      'created_at', 'updated_at',
    ])
      .where('created_by_id', '=', req.auth!.id)

    // Apply filters
    if (req.query.industry) {
      query = query.where('industry', '=', req.query.industry as string)
    }
    if (req.query.region) {
      query = query.where('region', '=', req.query.region as string)
    }

    const [jobs, totalResult] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
      db.selectFrom('jobs')
        .select((eb) => eb.fn.count('id').as('count'))
        .$if(Boolean(req.query.industry), (countQuery) => countQuery.where('industry', '=', req.query.industry as string))
        .$if(Boolean(req.query.region), (countQuery) => countQuery.where('region', '=', req.query.region as string))
        .where('created_by_id', '=', req.auth!.id)
        .executeTakeFirst(),
    ])

    const pageJobIds = jobs.map(job => job.id)

    // Batch-load candidate counts in one query (avoids N+1)
    const counts = pageJobIds.length === 0
      ? []
      : await db.selectFrom('ranked_candidates')
        .select(['job_id', (eb) => eb.fn.count('id').as('count'), (eb) => eb.fn.max('total_score').as('top_score')])
        .where('job_id', 'in', pageJobIds)
        .groupBy('job_id')
        .execute()

    const countMap = new Map<string, { count: number; topScore: number }>()
    for (const c of counts) countMap.set(c.job_id, { count: Number(c.count), topScore: Number(c.top_score) || 0 })

    // Batch-load AI evaluation counts
    const aiCounts = pageJobIds.length === 0
      ? []
      : await db.selectFrom('ai_evaluations')
        .select(['job_id', (eb) => eb.fn.count('id').as('count')])
        .where('job_id', 'in', pageJobIds)
        .groupBy('job_id')
        .execute()

    const aiCountMap = new Map<string, number>()
    for (const a of aiCounts) aiCountMap.set(a.job_id, Number(a.count))

    const jobsWithCount = jobs.map(job => ({
      ...job,
      candidate_count: countMap.get(job.id)?.count ?? 0,
      top_score: countMap.get(job.id)?.topScore ?? 0,
      ai_eval_count: aiCountMap.get(job.id) ?? 0,
    }))

    const total = Number(totalResult?.count ?? 0)
    res.json({ jobs: jobsWithCount, total, limit, offset, hasMore: offset + jobs.length < total })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Job ──────────────────────────────────────────────────

jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await db.selectFrom('jobs')
      .select(["id", "role", "company", "location", "required_skills", "nice_to_have_skills", "avoid_skills", "experience_min", "experience_max", "description", "industry", "region", "status", "created_at", "updated_at"])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    res.json(job)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Ranked Candidates ────────────────────────────────────

jobsRouter.get('/:id/ranked', async (req: Request, res: Response) => {
  try {
    const ranked = await db.selectFrom('ranked_candidates')
      .innerJoin('candidates', 'candidates.id', 'ranked_candidates.candidate_id')
      .select([
        'ranked_candidates.id',
        'ranked_candidates.candidate_id',
        'ranked_candidates.semantic_score',
        'ranked_candidates.skill_score',
        'ranked_candidates.experience_score',
        'ranked_candidates.education_score',
        'ranked_candidates.client_fit_score',
        'ranked_candidates.total_score',
        'ranked_candidates.exact_matches',
        'ranked_candidates.semantic_matches',
        'ranked_candidates.missing_skills',
        'ranked_candidates.avoid_signals',
        'ranked_candidates.explanation',
        'ranked_candidates.llm_score',
        'ranked_candidates.llm_verdict',
        'ranked_candidates.llm_reasoning',
        'ranked_candidates.ats_score',
        'ranked_candidates.decision',
        'candidates.name',
        'candidates.email',
        'candidates.phone',
        'candidates.linkedin_url',
        'candidates.github_url',
        'candidates.portfolio_url',
        'candidates.headline',
        'candidates.location',
        'candidates.summary',
        'candidates.experience_years',
        'candidates.data_quality_score',
        'candidates.missing_fields',
        'candidates.stage',
        'candidates.industry',
        'candidates.region',
      ])
      .where('ranked_candidates.job_id', '=', req.params.id)
      .where('candidates.created_by_id', '=', req.auth!.id)
      .orderBy('ranked_candidates.total_score', 'desc')
      .limit(25)
      .execute()

    res.json({ ranked_candidates: ranked })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Parse JD (AI) ────────────────────────────────────────────

jobsRouter.post('/parse-jd', async (req: Request, res: Response) => {
  try {
    const { text } = req.body
    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      return res.status(400).json({ error: 'Provide at least 20 characters of JD text' })
    }

    const parsed = await parseJDWithAI(text.trim())
    res.json({
      role: parsed.role !== 'Unknown Role' ? parsed.role : '',
      company: parsed.company || '',
      location: parsed.location || '',
      required_skills: parsed.required_skills || [],
      nice_to_have_skills: parsed.nice_to_have_skills || [],
      experience_min: parsed.experience_min ?? null,
      experience_max: parsed.experience_max ?? null,
      seniority: parsed.seniority || '',
      description: parsed.description || text.slice(0, 2000),
    })
  } catch (error: any) {
    console.error('[Jobs] JD parse failed:', error.message)
    res.status(500).json({ error: 'AI parsing failed: ' + (error.message || 'Unknown error') })
  }
})

// ─── Create Job ───────────────────────────────────────────────

jobsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateJobSchema.parse(req.body)

    const now = new Date()
    const job = await db.insertInto('jobs').values({
      id: randomUUID(),
      role: body.role,
      company: body.company,
      location: body.location,
      required_skills: body.required_skills,
      nice_to_have_skills: body.nice_to_have_skills || [],
      avoid_skills: body.avoid_skills || [],
      experience_min: body.experience_min,
      experience_max: body.experience_max,
      description: body.description,
      client_id: body.client_id || null,
      organization_id: req.auth!.organizationId,
      created_by_id: req.auth!.id,
      status: 'open',
      created_at: now,
      updated_at: now,
    }).returningAll().executeTakeFirst()

    if (!job) {
      return res.status(500).json({ error: 'Failed to create job' })
    }

    // Build StructuredDocument from form data and run full pipeline
    const description = body.description || `${body.role} ${body.required_skills.join(' ')} ${body.location || ''}`
    const doc = {
      plainText: description,
      markdown: description,
      sections: [{ name: 'jd', content: description }],
      tables: [],
      metadata: { fileName: `form-${body.role}`, mimeType: 'text/plain', fileSize: description.length },
    }

    // Run full pipeline async: Job Intelligence → Embedding → Qdrant → Matching → AI Evaluation
    runFullJobPipeline(job.id, doc).catch(err => {
      console.error(`[Jobs] Pipeline failed for job ${job.id}:`, err.message)
    })

    res.status(201).json(job)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors })
    }
    res.status(500).json({ error: String(error) })
  }
})

// ─── Update Job ──────────────────────────────────────────────

jobsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = CreateJobSchema.parse(req.body)

    const existing = await db.selectFrom('jobs')
      .select(["id", "role", "company", "location", "required_skills", "nice_to_have_skills", "avoid_skills", "experience_min", "experience_max", "description", "industry", "region", "status", "created_at", "updated_at"])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!existing) {
      return res.status(404).json({ error: 'Job not found' })
    }

    const now = new Date()
    const fullText = `${body.role} ${body.company || ''} ${body.location || ''} ${(body.required_skills || []).join(' ')} ${body.description || ''}`

    // Classify industry and region
    const industryResult = await classifyIndustry(fullText, body.required_skills || [], body.role)
    const regionResult = classifyRegion(body.location || '')

    const updated = await db.updateTable('jobs')
      .set({
        role: body.role,
        company: body.company || null,
        location: body.location || null,
        required_skills: body.required_skills,
        nice_to_have_skills: body.nice_to_have_skills || [],
        avoid_skills: body.avoid_skills || [],
        experience_min: body.experience_min ?? null,
        experience_max: body.experience_max ?? null,
        description: body.description || null,
        industry: industryResult.industry,
        region: regionResult,
        updated_at: now,
      })
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .returningAll()
      .executeTakeFirst()

    if (!updated) {
      return res.status(500).json({ error: 'Failed to update job' })
    }

    // Run full pipeline async: re-embed, re-index Qdrant, re-score with semantic search
    const description = body.description || `${body.role} ${body.required_skills.join(' ')} ${body.location || ''}`
    const doc = {
      plainText: description,
      markdown: description,
      sections: [{ name: 'jd', content: description }],
      tables: [],
      metadata: { fileName: `form-${body.role}`, mimeType: 'text/plain', fileSize: description.length },
    }
    runFullJobPipeline(updated.id, doc).catch(err => {
      console.error(`[Jobs] Pipeline failed for job ${updated.id}:`, err.message)
    })

    res.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors })
    }
    res.status(500).json({ error: String(error) })
  }
})

// ─── Delete Job ──────────────────────────────────────────────

jobsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteFrom('jobs')
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!deleted || deleted.numDeletedRows === 0n) {
      return res.status(404).json({ error: 'Job not found' })
    }

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Accept/Reject Candidate ─────────────────────────────────

jobsRouter.post('/:id/decisions', async (req: Request, res: Response) => {
  try {
    const body = DecisionSchema.parse(req.body)

    const job = await db.selectFrom('jobs')
      .select('id')
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()
    if (!job) return res.status(404).json({ error: 'Job not found' })

    await db.updateTable('ranked_candidates')
      .set({ decision: body.decision })
      .where('job_id', '=', req.params.id)
      .where('candidate_id', '=', body.candidate_id)
      .execute()

    res.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors })
    }
    res.status(500).json({ error: String(error) })
  }
})

// ─── Trigger Scoring (manual) ────────────────────────────────

jobsRouter.post('/:id/score', async (req: Request, res: Response) => {
  try {
    const job = await db.selectFrom('jobs')
      .select(["id", "role", "company", "location", "required_skills", "nice_to_have_skills", "avoid_skills", "experience_min", "experience_max", "description", "industry", "region", "status", "created_at", "updated_at"])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    // Run scoring async, return immediately
    matchJobToAllCandidates(job.id).catch(err => {
      console.error(`[Jobs] Manual scoring failed for job ${job.id}:`, err.message)
    })

    res.json({ message: `Scoring started for "${job.role}"`, job_id: job.id })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})
