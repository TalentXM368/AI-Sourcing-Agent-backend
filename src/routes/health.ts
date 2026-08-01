import { Router } from 'express'
import { db } from '../db/index.js'
import { sql } from 'kysely'

export const healthRouter = Router()

healthRouter.get('/', async (_req, res) => {
  try {
    const candidates = await db.selectFrom('candidates').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst()
    const jobs = await db.selectFrom('jobs').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst()
    const clients = await db.selectFrom('clients').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst()
    const rankings = await db.selectFrom('ranked_candidates').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst()

    res.json({
      status: 'ok',
      candidates: Number(candidates?.count ?? 0),
      jobs: Number(jobs?.count ?? 0),
      clients: Number(clients?.count ?? 0),
      rankings_ready: Number(rankings?.count ?? 0),
    })
  } catch (error) {
    res.status(500).json({ status: 'error', error: String(error) })
  }
})

// ─── Scoring Health: shows jobs with incomplete rankings ─────

healthRouter.get('/scoring', async (_req, res) => {
  try {
    const completedCount = await db.selectFrom('candidates')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parse_status', '=', 'completed')
      .executeTakeFirst()

    const total = Number(completedCount?.count ?? 0)

    const jobs = await db.selectFrom('jobs')
      .select(['id', 'role'])
      .where('status', '=', 'open')
      .execute()

    const result = await Promise.all(jobs.map(async (job) => {
      const ranked = await db.selectFrom('ranked_candidates')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('job_id', '=', job.id)
        .executeTakeFirst()

      const rankedCount = Number(ranked?.count ?? 0)
      return {
        id: job.id,
        role: job.role,
        scored: rankedCount,
        total,
        complete: rankedCount >= total,
      }
    }))

    const incomplete = result.filter(j => !j.complete)

    res.json({
      total_completed_candidates: total,
      total_jobs: jobs.length,
      incomplete_count: incomplete.length,
      incomplete,
    })
  } catch (error) {
    res.status(500).json({ status: 'error', error: String(error) })
  }
})
