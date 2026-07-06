import { Router } from 'express'
import { db } from '../db/index.js'

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
