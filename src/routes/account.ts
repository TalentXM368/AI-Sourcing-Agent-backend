import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { hashPassword, verifyPassword } from '../services/auth.js'

export const accountRouter = Router()
accountRouter.use(requireAuth)

const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  website: z.string().trim().url().max(500),
  role: z.string().trim().min(1).max(80),
  industry: z.string().trim().max(80).optional(),
  company_size: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
})

accountRouter.get('/profile', async (req: Request, res: Response) => {
  const user = await db.selectFrom('users').select(['id', 'first_name', 'last_name', 'email', 'status', 'onboarding_role'])
    .where('id', '=', req.auth!.id).executeTakeFirstOrThrow()
  res.json({ ...user, organization_id: req.auth!.organizationId, role: req.auth!.role, organization_name: req.auth!.organizationName })
})

accountRouter.patch('/profile', async (req: Request, res: Response) => {
  const body = z.object({ first_name: z.string().trim().min(1).max(80), last_name: z.string().trim().min(1).max(80) }).parse(req.body)
  const user = await db.updateTable('users').set({ first_name: body.first_name, last_name: body.last_name, updated_at: new Date() })
    .where('id', '=', req.auth!.id).returning(['id', 'first_name', 'last_name', 'email']).executeTakeFirstOrThrow()
  res.json(user)
})

accountRouter.post('/profile/password', async (req: Request, res: Response) => {
  const body = z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(128) }).parse(req.body)
  const user = await db.selectFrom('users').select('password_hash').where('id', '=', req.auth!.id).executeTakeFirstOrThrow()
  if (!(await verifyPassword(body.current_password, user.password_hash))) return res.status(400).json({ error: 'Current password is incorrect' })
  await db.updateTable('users').set({ password_hash: await hashPassword(body.new_password), updated_at: new Date() }).where('id', '=', req.auth!.id).execute()
  res.json({ message: 'Password updated successfully' })
})

accountRouter.get('/organization', async (req: Request, res: Response) => {
  const organization = await db.selectFrom('organizations').selectAll().where('id', '=', req.auth!.organizationId).executeTakeFirstOrThrow()
  res.json(organization)
})

accountRouter.patch('/organization', requireRole(['OWNER', 'ADMIN']), async (req: Request, res: Response) => {
  const body = onboardingSchema.partial().parse(req.body)
  const organization = await db.updateTable('organizations').set({
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.website !== undefined ? { website: body.website } : {}),
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.company_size !== undefined ? { company_size: body.company_size } : {}),
    ...(body.country !== undefined ? { country: body.country } : {}),
    updated_at: new Date(),
  }).where('id', '=', req.auth!.organizationId).returningAll().executeTakeFirstOrThrow()
  res.json(organization)
})

accountRouter.post('/organization/onboarding', async (req: Request, res: Response) => {
  const body = onboardingSchema.parse(req.body)
  const organization = await db.updateTable('organizations').set({
    name: body.name, website: body.website, industry: body.industry ?? null,
    company_size: body.company_size ?? null, country: body.country ?? null,
    onboarding_completed: true, updated_at: new Date(),
  }).where('id', '=', req.auth!.organizationId).returningAll().executeTakeFirstOrThrow()
  await db.updateTable('users').set({ onboarding_role: body.role, updated_at: new Date() }).where('id', '=', req.auth!.id).execute()
  res.json(organization)
})

accountRouter.get('/organization/members', requireRole(['OWNER', 'ADMIN']), async (req: Request, res: Response) => {
  const members = await db.selectFrom('organization_members').innerJoin('users', 'users.id', 'organization_members.user_id')
    .select(['organization_members.id', 'organization_members.role', 'organization_members.status', 'organization_members.joined_at', 'users.first_name', 'users.last_name', 'users.email'])
    .where('organization_members.organization_id', '=', req.auth!.organizationId).execute()
  res.json(members)
})
