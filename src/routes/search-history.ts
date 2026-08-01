import { Router, Request, Response } from 'express'
import { pool } from '../db/index.js'

export const searchHistoryRouter = Router()

// ─── GET /api/search-history ──────────────────────────────────

searchHistoryRouter.get('/search-history', async (req: Request, res: Response) => {
  try {
    const { source } = req.query
    let query = `
      SELECT id, source, query, filters, result_count, saved_count, candidate_ids, created_at
      FROM search_history
    `
    const params: unknown[] = []
    if (source && typeof source === 'string') {
      query += ' WHERE source = $1'
      params.push(source)
    }
    query += ' ORDER BY created_at DESC LIMIT 50'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Failed to fetch search history:', error)
    res.status(500).json({ error: 'Failed to fetch search history' })
  }
})

// ─── GET /api/search-history/:id/candidates ───────────────────

searchHistoryRouter.get('/search-history/:id/candidates', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      'SELECT candidate_ids FROM search_history WHERE id = $1',
      [id],
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Search history entry not found' })
      return
    }
    const { candidate_ids } = result.rows[0]
    if (!candidate_ids || candidate_ids.length === 0) {
      res.json([])
      return
    }
    // Use raw SQL with ANY() — skip raw_text (heavy) for speed
    const candidates = await pool.query(
      `SELECT id, name, email, phone, linkedin_url, github_url, portfolio_url,
              headline, location, summary, experience_years, skills, companies,
              work_history, education, projects, certifications, languages,
              parse_status, data_quality_score, missing_fields, stage,
              industry, region, pdl_id, so_id, source, created_at
       FROM candidates WHERE id = ANY($1)`,
      [candidate_ids],
    )
    res.json(candidates.rows)
  } catch (error) {
    console.error('Failed to fetch search history candidates:', error)
    res.status(500).json({ error: 'Failed to fetch candidates' })
  }
})

// ─── DELETE /api/search-history/:id ───────────────────────────

searchHistoryRouter.delete('/search-history/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    await pool.query('DELETE FROM search_history WHERE id = $1', [id])
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to delete search history:', error)
    res.status(500).json({ error: 'Failed to delete search history' })
  }
})

// ─── DELETE /api/search-history ───────────────────────────────

searchHistoryRouter.delete('/search-history', async (req: Request, res: Response) => {
  try {
    const { source } = req.query
    if (source && typeof source === 'string') {
      await pool.query('DELETE FROM search_history WHERE source = $1', [source])
    } else {
      await pool.query('DELETE FROM search_history')
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to clear search history:', error)
    res.status(500).json({ error: 'Failed to clear search history' })
  }
})
