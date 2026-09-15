import { Router, Request, Response } from 'express'
import { pool } from '../db/index.js'
import { z } from 'zod'

export const projectsRouter = Router()

const STAGES = ['new', 'contacted', 'screening', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn']

// ─── GET /api/projects ───────────────────────────────────────

projectsRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.description, p.status, p.job_id, p.client_id,
             p.created_at, p.updated_at,
             j.role AS job_role, j.company AS job_company,
             c.account_name AS client_name,
             COUNT(pc.id)::int AS candidate_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'placed')::int AS placed_count
      FROM projects p
      LEFT JOIN jobs j ON j.id = p.job_id
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN project_candidates pc ON pc.project_id = p.id
      GROUP BY p.id, j.role, j.company, c.account_name
      ORDER BY p.created_at DESC
    `)
    res.json(result.rows)
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    res.status(500).json({ error: 'Failed to fetch projects' })
  }
})

// ─── POST /api/projects ──────────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  job_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
})

projectsRouter.post('/projects', async (req: Request, res: Response) => {
  try {
    const body = CreateProjectSchema.parse(req.body)
    const result = await pool.query(
      `INSERT INTO projects (id, name, description, job_id, client_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [body.name, body.description || null, body.job_id || null, body.client_id || null]
    )
    res.status(201).json(result.rows[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors })
      return
    }
    console.error('Failed to create project:', error)
    res.status(500).json({ error: 'Failed to create project' })
  }
})

// ─── GET /api/projects/:id ───────────────────────────────────

projectsRouter.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = await pool.query(`
      SELECT p.id, p.name, p.description, p.status, p.job_id, p.client_id,
             p.created_at, p.updated_at,
             j.role AS job_role, j.company AS job_company, j.location AS job_location,
             j.required_skills AS job_skills,
             c.account_name AS client_name,
             COUNT(pc.id)::int AS candidate_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'placed')::int AS placed_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'new')::int AS new_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'contacted')::int AS contacted_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'screening')::int AS screening_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'interviewing')::int AS interviewing_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'offered')::int AS offered_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'rejected')::int AS rejected_count,
             COUNT(pc.id) FILTER (WHERE LOWER(TRIM(pc.stage)) = 'withdrawn')::int AS withdrawn_count
      FROM projects p
      LEFT JOIN jobs j ON j.id = p.job_id
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN project_candidates pc ON pc.project_id = p.id
      WHERE p.id = $1
      GROUP BY p.id, j.role, j.company, j.location, j.required_skills, c.account_name
    `, [id])
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Failed to fetch project:', error)
    res.status(500).json({ error: 'Failed to fetch project' })
  }
})

// ─── PUT /api/projects/:id ───────────────────────────────────

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'archived', 'closed']).optional(),
})

projectsRouter.put('/projects/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const body = UpdateProjectSchema.parse(req.body)
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        const col = key === 'job_id' ? 'job_id' : key === 'client_id' ? 'client_id' : key
        fields.push(`${col} = $${i}`)
        values.push(value)
        i++
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }
    fields.push(`updated_at = NOW()`)
    values.push(id)
    const result = await pool.query(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(result.rows[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors })
      return
    }
    console.error('Failed to update project:', error)
    res.status(500).json({ error: 'Failed to update project' })
  }
})

// ─── DELETE /api/projects/:id ────────────────────────────────

projectsRouter.delete('/projects/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [id])
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to delete project:', error)
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

// ─── POST /api/projects/:id/candidates ───────────────────────

const AddCandidatesSchema = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1).max(100),
  stage: z.enum(STAGES as [string, ...string[]]).optional().default('new'),
  added_from: z.string().optional(),
})

projectsRouter.post('/projects/:id/candidates', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const body = AddCandidatesSchema.parse(req.body)

    const projectExists = await pool.query('SELECT id FROM projects WHERE id = $1', [id])
    if (projectExists.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const added: string[] = []
    const skipped: string[] = []
    for (const candidateId of body.candidate_ids) {
      try {
        const result = await pool.query(
          `INSERT INTO project_candidates (id, project_id, candidate_id, stage, added_from, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (project_id, candidate_id) DO NOTHING
           RETURNING id`,
          [id, candidateId, body.stage, body.added_from || null]
        )
        if (result.rows.length > 0) {
          added.push(candidateId)
        } else {
          skipped.push(candidateId)
        }
      } catch {
        skipped.push(candidateId)
      }
    }

    res.json({ added: added.length, skipped: skipped.length, added_ids: added, skipped_ids: skipped })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors })
      return
    }
    console.error('Failed to add candidates to project:', error)
    res.status(500).json({ error: 'Failed to add candidates' })
  }
})

// ─── DELETE /api/projects/:id/candidates/:candidateId ────────

projectsRouter.delete('/projects/:id/candidates/:candidateId', async (req: Request, res: Response) => {
  try {
    const { id, candidateId } = req.params
    const result = await pool.query(
      'DELETE FROM project_candidates WHERE project_id = $1 AND candidate_id = $2 RETURNING id',
      [id, candidateId]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Candidate not in this project' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to remove candidate from project:', error)
    res.status(500).json({ error: 'Failed to remove candidate' })
  }
})

// ─── PUT /api/projects/:id/candidates/:candidateId ───────────

const UpdateCandidateInProjectSchema = z.object({
  stage: z.enum(STAGES as [string, ...string[]]).optional(),
  notes: z.string().optional().nullable(),
})

projectsRouter.put('/projects/:id/candidates/:candidateId', async (req: Request, res: Response) => {
  try {
    const { id, candidateId } = req.params
    const body = UpdateCandidateInProjectSchema.parse(req.body)
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    if (body.stage !== undefined) {
      fields.push(`stage = $${i}`)
      values.push(body.stage)
      i++
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${i}`)
      values.push(body.notes)
      i++
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }
    fields.push(`updated_at = NOW()`)
    values.push(id, candidateId)
    const result = await pool.query(
      `UPDATE project_candidates SET ${fields.join(', ')} WHERE project_id = $${i} AND candidate_id = $${i + 1} RETURNING *`,
      values
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Candidate not in this project' })
      return
    }
    res.json(result.rows[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors })
      return
    }
    console.error('Failed to update candidate in project:', error)
    res.status(500).json({ error: 'Failed to update candidate' })
  }
})

// ─── GET /api/projects/:id/pipeline ──────────────────────────

projectsRouter.get('/projects/:id/pipeline', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const projectExists = await pool.query('SELECT id, name FROM projects WHERE id = $1', [id])
    if (projectExists.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const result = await pool.query(`
      SELECT pc.id AS project_candidate_id, LOWER(TRIM(pc.stage)) AS stage, pc.notes, pc.added_from,
             pc.created_at AS added_at,
             c.id, c.name, c.email, c.phone, c.linkedin_url, c.github_url,
             c.headline, c.location, c.resume_url, c.experience_years, c.skills, c.companies,
             c.data_quality_score, c.source, c.industry, c.region
      FROM project_candidates pc
      JOIN candidates c ON c.id = pc.candidate_id
      WHERE pc.project_id = $1
      ORDER BY pc.created_at DESC
    `, [id])

    const pipeline: Record<string, any[]> = {}
    for (const stage of STAGES) {
      pipeline[stage] = []
    }
    for (const row of result.rows) {
      pipeline[row.stage]?.push(row)
    }

    const counts: Record<string, number> = {}
    for (const stage of STAGES) {
      counts[stage] = pipeline[stage].length
    }

    res.json({ pipeline, counts, total: result.rows.length })
  } catch (error) {
    console.error('Failed to fetch project pipeline:', error)
    res.status(500).json({ error: 'Failed to fetch pipeline' })
  }
})

// ─── POST /api/projects/:id/candidates/bulk ──────────────────

projectsRouter.post('/projects/:id/candidates/bulk', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { candidate_ids, added_from } = req.body as { candidate_ids: string[], added_from?: string }

    if (!Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      res.status(400).json({ error: 'candidate_ids array required' })
      return
    }

    const projectExists = await pool.query('SELECT id FROM projects WHERE id = $1', [id])
    if (projectExists.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    let added = 0
    for (const cid of candidate_ids) {
      const r = await pool.query(
        `INSERT INTO project_candidates (id, project_id, candidate_id, stage, added_from, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'new', $3, NOW(), NOW())
         ON CONFLICT (project_id, candidate_id) DO NOTHING RETURNING id`,
        [id, cid, added_from || null]
      )
      if (r.rows.length > 0) added++
    }

    res.json({ added, total: candidate_ids.length })
  } catch (error) {
    console.error('Failed to bulk add candidates:', error)
    res.status(500).json({ error: 'Failed to add candidates' })
  }
})
