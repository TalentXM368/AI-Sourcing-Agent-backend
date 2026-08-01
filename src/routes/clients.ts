import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { randomUUID } from 'crypto'

export const clientsRouter = Router()

// ─── Validation ───────────────────────────────────────────────

const CreateClientSchema = z.object({
  account_name: z.string().min(1).max(120),
  industry: z.string().optional(),
  location: z.string().optional(),
  hiring_preferences: z.object({
    seniority: z.string().optional(),
    must_have: z.array(z.string()).default([]),
    nice_to_have: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
  }).default({ must_have: [], nice_to_have: [], avoid: [] }),
  culture: z.object({
    values: z.array(z.string()).default([]),
    work_style: z.string().default(''),
  }).default({ values: [], work_style: '' }),
  role_context: z.object({
    team_size: z.number().default(0),
    reports_to: z.string().default(''),
    tech_stack: z.array(z.string()).default([]),
  }).default({ team_size: 0, reports_to: '', tech_stack: [] }),
  historical_patterns: z.object({
    avg_tenure_years: z.number().default(0),
    accepted_profiles: z.string().default(''),
    rejected_reasons: z.array(z.string()).default([]),
  }).default({ avg_tenure_years: 0, accepted_profiles: '', rejected_reasons: [] }),
})

// ─── List Clients ─────────────────────────────────────────────

clientsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const clients = await db.selectFrom('clients')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()

    res.json(clients)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Client ───────────────────────────────────────────────

clientsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const client = await db.selectFrom('clients')
      .selectAll()
      .where('id', '=', req.params.id)
      .executeTakeFirst()

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    // Get linked jobs with top candidates
    const jobs = await db.selectFrom('jobs')
      .selectAll()
      .where('client_id', '=', req.params.id)
      .execute()

    res.json({ ...client, jobs })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Create Client ────────────────────────────────────────────

clientsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateClientSchema.parse(req.body)

    const now = new Date()
    const client = await db.insertInto('clients').values({
      id: randomUUID(),
      account_name: body.account_name,
      industry: body.industry,
      location: body.location,
      status: 'active',
      urgency: 'medium',
      open_roles: 0,
      placements_ytd: 0,
      hiring_preferences: JSON.stringify(body.hiring_preferences),
      culture: JSON.stringify(body.culture),
      role_context: JSON.stringify(body.role_context),
      historical_patterns: JSON.stringify(body.historical_patterns),
      created_at: now,
      updated_at: now,
    }).returningAll().executeTakeFirst()

    res.status(201).json(client)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors })
    }
    res.status(500).json({ error: String(error) })
  }
})
