import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { sql } from 'kysely'

export const resumeSearchRouter = Router()

const ResumeSearchSchema = z.object({
  query: z.string().max(500).optional(),
  skills: z.array(z.string().max(100)).max(20).optional(),
  location: z.string().max(200).optional(),
  industry: z.string().max(200).optional(),
  experienceMin: z.number().min(0).max(50).optional(),
  experienceMax: z.number().min(0).max(50).optional(),
  size: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
})

const CANDIDATE_COLUMNS = [
  'candidates.id', 'candidates.name', 'candidates.email', 'candidates.phone',
  'candidates.linkedin_url', 'candidates.github_url', 'candidates.portfolio_url',
  'candidates.headline', 'candidates.location', 'candidates.summary',
  'candidates.experience_years', 'candidates.skills', 'candidates.companies', 'candidates.resume_url',
  'candidates.parse_status', 'candidates.data_quality_score', 'candidates.missing_fields',
  'candidates.stage', 'candidates.stage_updated_at', 'candidates.industry',
  'candidates.region', 'candidates.source', 'candidates.pdl_id',
  'candidates.created_at', 'candidates.updated_at',
] as const

function applyResumeFilters(body: z.infer<typeof ResumeSearchSchema>) {
  return (eb: any) => {
    const c: any[] = [
      eb('candidates.parse_status', '=', 'completed'),
      eb('candidates.source', 'in', ['resume', 'webhook']),
    ]

    if (body.query?.trim()) {
      const kw = `%${body.query.trim()}%`
      c.push(eb.or([
        eb('candidates.name', 'ilike', kw),
        eb('candidates.headline', 'ilike', kw),
        eb('candidates.summary', 'ilike', kw),
        eb('candidates.location', 'ilike', kw),
        eb('candidates.industry', 'ilike', kw),
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.skills) AS s WHERE LOWER(COALESCE(s->>'name', s::text)) LIKE ${kw.toLowerCase()}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.companies) AS x WHERE x->>'name' ILIKE ${kw}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.work_history) AS w WHERE w->>'title' ILIKE ${kw} OR w->>'company' ILIKE ${kw}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.education) AS e WHERE e->>'school' ILIKE ${kw} OR e->>'degree' ILIKE ${kw}) `,
      ]))
    }

    if (body.skills?.length) {
      const skillOrs = body.skills.map(skill =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.skills) AS s WHERE LOWER(COALESCE(s->>'name', s::text)) LIKE ${`%${skill.toLowerCase()}%`}) `
      )
      c.push(eb.or(skillOrs))
    }

    if (body.location?.trim()) {
      const loc = `%${body.location.trim()}%`
      c.push(sql<boolean>`(candidates.location ILIKE ${loc} OR candidates.region ILIKE ${loc})`)
    }

    if (body.industry?.trim()) {
      c.push(eb('candidates.industry', 'ilike', `%${body.industry.trim()}%`))
    }

    if (body.experienceMin !== undefined) {
      c.push(eb('candidates.experience_years', '>=', body.experienceMin))
    }
    if (body.experienceMax !== undefined) {
      c.push(eb('candidates.experience_years', '<=', body.experienceMax))
    }

    return eb.and(c)
  }
}

resumeSearchRouter.post('/search/resume', async (req: Request, res: Response) => {
  try {
    const body = ResumeSearchSchema.parse(req.body)
    const limit = body.size || 25
    const offset = body.offset || 0

    console.log('[ResumeSearch] Query:', JSON.stringify({ ...body, query: body.query?.substring(0, 80) }))

    const whereClause = applyResumeFilters(body)

    const [countResult, results] = await Promise.all([
      db.selectFrom('candidates')
        .select(sql<number>`COUNT(*)::int`.as('count'))
        .where(whereClause)
        .executeTakeFirst(),
      db.selectFrom('candidates')
        .select(CANDIDATE_COLUMNS)
        .where(whereClause)
        .orderBy(sql`COALESCE(candidates.data_quality_score, 0)`, 'desc')
        .orderBy('candidates.created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
    ])

    const total = countResult?.count || 0

    console.log(`[ResumeSearch] Found ${total} resume candidates, returning ${results.length}`)

    res.json({
      candidates: results,
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((e: any) => ({ path: e.path.join('.'), message: e.message })),
      })
    }
    console.error('[ResumeSearch] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
