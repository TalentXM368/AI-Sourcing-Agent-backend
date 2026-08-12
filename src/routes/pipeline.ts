import { Router, Request, Response } from 'express'
import { db, pool } from '../db/index.js'

export const pipelineRouter = Router()

const VALID_STAGES = ['new', 'contacted', 'screening', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn'] as const

pipelineRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        id, name, headline, location, skills, companies, work_history,
        education, experience_years, source, stage, stage_updated_at,
        data_quality_score, resume_url, created_at, industry, region,
        source_file
      FROM candidates
      WHERE parse_status = 'completed'
      ORDER BY
        CASE COALESCE(stage, 'new')
          WHEN 'new' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'screening' THEN 3
          WHEN 'interviewing' THEN 4
          WHEN 'offered' THEN 5
          WHEN 'placed' THEN 6
          WHEN 'rejected' THEN 7
          WHEN 'withdrawn' THEN 8
          ELSE 99
        END,
        created_at DESC
    `)

    const candidates = result.rows

    // Group by stage
    const pipeline: Record<string, typeof candidates> = {}
    for (const stage of VALID_STAGES) {
      pipeline[stage] = []
    }

    for (const candidate of candidates) {
      const stage = (candidate.stage as string) || 'new'
      if (!pipeline[stage]) pipeline[stage] = []
      pipeline[stage].push(candidate)
    }

    // Counts per stage
    const counts: Record<string, number> = {}
    for (const stage of VALID_STAGES) {
      counts[stage] = pipeline[stage]?.length || 0
    }

    res.json({ pipeline, counts, total: candidates.length })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})
