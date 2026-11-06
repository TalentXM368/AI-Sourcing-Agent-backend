import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { pool } from '../db/index.js'
import { requirePlatformAdmin } from '../middleware/auth.js'
import { reprocessCandidate } from './candidates.js'
import {
  RECOVERY_STAGES,
  getRecoveryBacklogForCsv,
  getRecoveryBatch,
  getRecoveryReport,
  reviewRecoveryBatch,
  startRecoveryBatch,
  stopRecoveryBatch,
  type RecoveryStage,
} from '../services/resume-recovery.js'

export const adminRouter = Router()
adminRouter.use(requirePlatformAdmin)

function parsePagination(req: Request): { limit: number; offset: number } {
  const parsed = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query)
  if (!parsed.success) throw new Error('Invalid pagination parameters')
  return parsed.data
}

adminRouter.get('/overview', async (_req: Request, res: Response) => {
  try {
    const [candidateStats, userStats, recentActivity] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total_candidates,
          COUNT(*) FILTER (WHERE parse_status = 'completed')::int AS parsed_candidates,
          COUNT(*) FILTER (WHERE parse_status IN ('pending', 'processing'))::int AS queued_candidates,
          COUNT(*) FILTER (WHERE parse_status = 'failed')::int AS failed_candidates,
          COUNT(*) FILTER (WHERE source = 'resume')::int AS resume_ingested_candidates,
          COUNT(*) FILTER (WHERE source = 'resume' AND created_at >= NOW() - INTERVAL '7 days')::int AS new_resumes_7d,
          COUNT(*) FILTER (WHERE data_quality_score IS NOT NULL AND data_quality_score < 50)::int AS low_quality_candidates,
          ROUND(AVG(data_quality_score))::int AS average_quality
         FROM candidates`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_users,
                COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_users
         FROM users`
      ),
      pool.query(
        `SELECT id, name, source_file, resume_url, parse_status, data_quality_score,
                missing_fields, source, created_at
         FROM candidates
         WHERE source = 'resume'
         ORDER BY created_at DESC
         LIMIT 8`
      ),
    ])
    res.json({
      candidates: candidateStats.rows[0],
      users: userStats.rows[0],
      recent_resumes: recentActivity.rows,
    })
  } catch (error) {
    console.error('[Admin] Failed to load overview:', error)
    res.status(500).json({ error: 'Failed to load admin overview' })
  }
})

adminRouter.get('/candidates', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = parsePagination(req)
    const querySchema = z.object({
      search: z.string().trim().max(200).default(''),
      parse_status: z.string().trim().max(40).default(''),
      source: z.string().trim().max(80).default(''),
    })
    const filters = querySchema.parse(req.query)
    const values: unknown[] = []
    const conditions: string[] = []
    if (filters.search) {
      values.push(`%${filters.search}%`)
      const param = `$${values.length}`
      conditions.push(`(name ILIKE ${param} OR email ILIKE ${param} OR headline ILIKE ${param} OR location ILIKE ${param} OR source_file ILIKE ${param})`)
    }
    if (filters.parse_status) {
      values.push(filters.parse_status)
      conditions.push(`parse_status = $${values.length}`)
    }
    if (filters.source) {
      values.push(filters.source)
      conditions.push(`COALESCE(source, 'unknown') = $${values.length}`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM candidates ${where}`,
      values
    )
    const rows = await pool.query(
      `SELECT id, name, email, phone, linkedin_url, github_url, portfolio_url,
            headline, location, summary, experience_years, skills, companies,
            work_history, education, projects, certifications, languages,
            industry, region, source,
            source_file, resume_url, parse_status, parse_error,
              data_quality_score, missing_fields, created_at, updated_at,
              CASE WHEN jsonb_typeof(skills) = 'array'
                   THEN jsonb_array_length(skills) ELSE 0 END AS skill_count
       FROM candidates ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    )
    res.json({
      candidates: rows.rows,
      total: count.rows[0].total,
      limit,
      offset,
      has_more: offset + rows.rows.length < count.rows[0].total,
    })
  } catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === 'Invalid pagination parameters')) {
      return res.status(400).json({ error: 'Invalid candidate search parameters' })
    }
    console.error('[Admin] Failed to search candidates:', error)
    res.status(500).json({ error: 'Failed to search candidates' })
  }
})

adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = parsePagination(req)
    const search = z.string().trim().max(200).default('').parse(req.query.search)
    const values: unknown[] = []
    const where = search
      ? (() => {
          values.push(`%${search}%`)
          return `WHERE (u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1)`
        })()
      : ''
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, values)
    const rows = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.status,
              u.created_at, u.last_login_at,
              COALESCE(string_agg(DISTINCT o.name, ', '), '') AS organizations,
              COALESCE(string_agg(DISTINCT om.role::text, ', '), '') AS roles
       FROM users u
       LEFT JOIN organization_members om ON om.user_id = u.id AND om.status = 'ACTIVE'
       LEFT JOIN organizations o ON o.id = om.organization_id
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    )
    res.json({
      users: rows.rows,
      total: count.rows[0].total,
      limit,
      offset,
      has_more: offset + rows.rows.length < count.rows[0].total,
    })
  } catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === 'Invalid pagination parameters')) {
      return res.status(400).json({ error: 'Invalid user search parameters' })
    }
    console.error('[Admin] Failed to search users:', error)
    res.status(500).json({ error: 'Failed to search users' })
  }
})

adminRouter.post('/candidates/:id/reparse', async (req: Request, res: Response) => {
  const candidateId = z.string().uuid().safeParse(req.params.id)
  if (!candidateId.success) return res.status(400).json({ error: 'Invalid candidate ID' })
  try {
    const candidate = await pool.query(
      `SELECT id, name, source_file, resume_url
       FROM candidates WHERE id = $1 LIMIT 1`,
      [candidateId.data]
    )
    if (!candidate.rows.length) return res.status(404).json({ error: 'Candidate not found' })
    const fileUrl = candidate.rows[0].source_file || candidate.rows[0].resume_url
    if (!fileUrl) return res.status(400).json({ error: 'Candidate has no resume file to reparse' })

    await pool.query(
      `UPDATE candidates SET parse_status = 'processing', parse_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [candidateId.data]
    )
    reprocessCandidate(candidateId.data, fileUrl).catch(async error => {
      console.error(`[Admin] Reparse failed for ${candidateId.data}:`, error)
      await pool.query(
        `UPDATE candidates SET parse_status = 'failed', parse_error = $2, updated_at = NOW()
         WHERE id = $1`,
        [candidateId.data, String(error).slice(0, 500)]
      ).catch(dbError => console.error('[Admin] Could not save reparse failure:', dbError))
    })
    res.json({ message: 'Reparse started', candidate_id: candidateId.data })
  } catch (error) {
    console.error('[Admin] Failed to start candidate reparse:', error)
    res.status(500).json({ error: 'Failed to start candidate reparse' })
  }
})

adminRouter.get('/recovery/report', async (_req: Request, res: Response) => {
  try {
    res.json(await getRecoveryReport())
  } catch (error) {
    console.error('[Admin] Failed to generate resume recovery report:', error)
    res.status(500).json({ error: 'Failed to generate resume recovery report' })
  }
})

adminRouter.get('/recovery/backlog.csv', async (_req: Request, res: Response) => {
  try {
    const rows = await getRecoveryBacklogForCsv()
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const header = [
      'resume_id', 'filename', 'current_status', 'old_parser_version', 'old_error',
      'created_at', 'updated_at', 'quality_score',
    ]
    const lines = rows.map(row => [
      row.id, row.source_file || row.resume_url, row.parse_status, '', row.parse_error,
      row.created_at?.toISOString?.() || row.created_at, row.updated_at?.toISOString?.() || row.updated_at,
      row.data_quality_score,
    ].map(escape).join(','))
    res.type('text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="resume-recovery-backlog.csv"')
    res.send([header.map(escape).join(','), ...lines].join('\r\n'))
  } catch (error) {
    console.error('[Admin] Failed to export resume recovery backlog:', error)
    res.status(500).json({ error: 'Failed to export resume recovery backlog' })
  }
})

adminRouter.post('/recovery/batches', async (req: Request, res: Response) => {
  const input = z.object({
    stage: z.enum(RECOVERY_STAGES),
    concurrency: z.coerce.number().int().min(1).max(5).default(3),
  }).safeParse(req.body)
  if (!input.success) return res.status(400).json({ error: 'Invalid recovery batch request', details: input.error.issues })
  try {
    const started = await startRecoveryBatch(
      input.data.stage as RecoveryStage,
      input.data.concurrency,
      req.auth!.id,
    )
    res.status(202).json({ ...started, message: `Started stage ${input.data.stage} recovery` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /next allowed|review the current batch|another admin|no resumes/i.test(message) ? 409 : 400
    res.status(status).json({ error: message })
  }
})

adminRouter.get('/recovery/batches/:id', async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid recovery batch ID' })
  try {
    const batch = await getRecoveryBatch(id.data)
    if (!batch) return res.status(404).json({ error: 'Recovery batch not found' })
    res.json(batch)
  } catch (error) {
    console.error(`[Admin] Failed to load recovery batch ${id.data}:`, error)
    res.status(500).json({ error: 'Failed to load recovery batch' })
  }
})

adminRouter.post('/recovery/batches/:id/review', async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const input = z.object({
    reviewed_resume_ids: z.array(z.string().uuid()).max(10),
    notes: z.string().trim().min(1).max(2000),
    approved: z.boolean(),
  }).safeParse(req.body)
  if (!id.success) return res.status(400).json({ error: 'Invalid recovery batch ID' })
  if (!input.success) return res.status(400).json({ error: 'Invalid review submission', details: input.error.issues })
  try {
    await reviewRecoveryBatch(
      id.data,
      input.data.reviewed_resume_ids,
      input.data.notes,
      req.auth!.id,
      input.data.approved,
    )
    res.json({ message: input.data.approved ? 'Batch review approved' : 'Batch stopped after review' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(message === 'Recovery batch not found' ? 404 : 400).json({ error: message })
  }
})

adminRouter.post('/recovery/batches/:id/stop', async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const input = z.object({ reason: z.string().trim().min(1).max(2000) }).safeParse(req.body)
  if (!id.success) return res.status(400).json({ error: 'Invalid recovery batch ID' })
  if (!input.success) return res.status(400).json({ error: 'A stop reason is required' })
  try {
    await stopRecoveryBatch(id.data, input.data.reason)
    res.json({ message: 'Recovery batch stopped; active resume work will finish before the runner exits' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(message === 'Batch is not currently running' ? 409 : 400).json({ error: message })
  }
})
