import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { randomUUID } from 'crypto'

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

jobsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const jobs = await db.selectFrom('jobs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()

    // Get candidate count for each job
    const jobsWithCount = await Promise.all(
      jobs.map(async (job) => {
        const count = await db.selectFrom('ranked_candidates')
          .select((eb) => eb.fn.count('id').as('count'))
          .where('job_id', '=', job.id)
          .executeTakeFirst()
        return { ...job, candidate_count: Number(count?.count ?? 0) }
      })
    )

    res.json(jobsWithCount)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Job ──────────────────────────────────────────────────

jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await db.selectFrom('jobs')
      .selectAll()
      .where('id', '=', req.params.id)
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
        'candidates.skills',
        'candidates.companies',
        'candidates.work_history',
        'candidates.education',
        'candidates.projects',
        'candidates.certifications',
        'candidates.languages',
        'candidates.resume_url',
      ])
      .where('ranked_candidates.job_id', '=', req.params.id)
      .orderBy('ranked_candidates.total_score', 'desc')
      .execute()

    res.json({ ranked_candidates: ranked })
  } catch (error) {
    res.status(500).json({ error: String(error) })
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
      status: 'open',
      created_at: now,
      updated_at: now,
    }).returningAll().executeTakeFirst()

    res.status(201).json(job)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors })
    }
    res.status(500).json({ error: String(error) })
  }
})

// ─── Accept/Reject Candidate ─────────────────────────────────

jobsRouter.post('/:id/decisions', async (req: Request, res: Response) => {
  try {
    const body = DecisionSchema.parse(req.body)

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
