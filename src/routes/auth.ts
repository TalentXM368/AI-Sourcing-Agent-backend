import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { attachAuth, clearedSessionCookie, requireAuth, sessionCookie } from '../middleware/auth.js'
import { createPasswordResetToken, createSession, hashPassword, resetPassword, revokeSession, verifyPassword } from '../services/auth.js'
import { randomUUID, timingSafeEqual } from 'crypto'

export const authRouter = Router()
authRouter.use(attachAuth)

const passwordSchema = z.string().min(8).max(128)
const emailSchema = z.string().trim().toLowerCase().email().max(254)

const signupSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
  confirm_password: z.string(),
}).refine(body => body.password === body.confirm_password, {
  path: ['confirm_password'], message: 'Passwords do not match',
})

function publicUser(user: NonNullable<Request['auth']>) {
  return {
    id: user.id, first_name: user.firstName, last_name: user.lastName, email: user.email,
    organization_id: user.organizationId, organization_name: user.organizationName,
    role: user.role, onboarding_complete: user.onboardingComplete,
    is_platform_admin: user.email.toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@blocktxm.com').trim().toLowerCase()
      && user.role === 'ADMIN',
  }
}

function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'admin@blocktxm.com').trim().toLowerCase()
}

function matchesBootstrapPassword(candidate: string, configured: string): boolean {
  const candidateBytes = Buffer.from(candidate)
  const configuredBytes = Buffer.from(configured)
  return candidateBytes.length === configuredBytes.length
    && timingSafeEqual(candidateBytes, configuredBytes)
}

async function provisionBootstrapAdmin(email: string, password: string): Promise<void> {
  const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()
  const passwordHash = await hashPassword(password)
  await db.transaction().execute(async trx => {
    if (existing) {
      await trx.updateTable('users').set({
        password_hash: passwordHash,
        status: 'ACTIVE',
        updated_at: new Date(),
      }).where('id', '=', existing.id).execute()
      const memberships = await trx.selectFrom('organization_members')
        .select('id')
        .where('user_id', '=', existing.id)
        .execute()
      if (memberships.length) {
        await trx.updateTable('organization_members').set({
          role: 'ADMIN',
          status: 'ACTIVE',
          updated_at: new Date(),
        }).where('user_id', '=', existing.id).execute()
        return
      }
    }

    const userId = existing?.id || randomUUID()
    const organizationId = randomUUID()
    if (!existing) {
      const racedUser = await trx.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()
      if (racedUser) return
    }
    if (!existing) {
      await trx.insertInto('users').values({
        id: userId,
        first_name: 'BlockTXM',
        last_name: 'Admin',
        email,
        password_hash: passwordHash,
        onboarding_role: null,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
        last_login_at: null,
      }).execute()
    }
    await trx.insertInto('organizations').values({
      id: organizationId,
      name: 'BlockTXM Platform',
      website: null,
      industry: null,
      company_size: null,
      country: null,
      logo_url: null,
      onboarding_completed: true,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute()
    await trx.insertInto('organization_members').values({
      id: randomUUID(),
      organization_id: organizationId,
      user_id: userId,
      role: 'ADMIN',
      status: 'ACTIVE',
      joined_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    }).execute()
  })
}

authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const body = signupSchema.parse(req.body)
    if (body.email === adminEmail()) {
      return res.status(403).json({ error: 'This email is reserved for the platform administrator' })
    }
    const existing = await db.selectFrom('users').select('id').where('email', '=', body.email).executeTakeFirst()
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' })

    const passwordHash = await hashPassword(body.password)
    const result = await db.transaction().execute(async trx => {
      const userId = randomUUID()
      const organizationId = randomUUID()
      await trx.insertInto('users').values({
        id: userId, first_name: body.first_name, last_name: body.last_name, email: body.email,
        password_hash: passwordHash, onboarding_role: null, status: 'ACTIVE',
        created_at: new Date(), updated_at: new Date(), last_login_at: null,
      }).execute()
      await trx.insertInto('organizations').values({
        id: organizationId, name: `${body.first_name}'s Organization`, website: null, industry: null,
        company_size: null, country: null, logo_url: null, onboarding_completed: false,
        created_at: new Date(), updated_at: new Date(),
      }).execute()
      await trx.insertInto('organization_members').values({
        id: randomUUID(), organization_id: organizationId, user_id: userId, role: 'OWNER', status: 'ACTIVE',
        joined_at: new Date(), created_at: new Date(), updated_at: new Date(),
      }).execute()
      return { userId }
    })
    const token = await createSession(result.userId)
    res.setHeader('Set-Cookie', sessionCookie(token))
    const auth = await (await import('../services/auth.js')).getAuthUser(token)
    res.status(201).json({ user: auth ? publicUser(auth) : null })
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: error.errors })
    res.status(500).json({ error: 'Unable to create account' })
  }
})

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const body = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(req.body)
    let user = await db.selectFrom('users').select(['id', 'first_name', 'last_name', 'email', 'password_hash', 'onboarding_role', 'status', 'created_at', 'updated_at', 'last_login_at']).where('email', '=', body.email).executeTakeFirst()
    if (!user && body.email === adminEmail()) {
      const bootstrapPassword = process.env.ADMIN_PASSWORD
      if (!bootstrapPassword || bootstrapPassword.length < 12) {
        return res.status(503).json({ error: 'Admin login is not configured on the server' })
      }
    }
    const bootstrapPassword = process.env.ADMIN_PASSWORD
    if (
      body.email === adminEmail()
      && bootstrapPassword
      && bootstrapPassword.length >= 12
      && matchesBootstrapPassword(body.password, bootstrapPassword)
    ) {
      await provisionBootstrapAdmin(body.email, bootstrapPassword)
      user = await db.selectFrom('users').select(['id', 'first_name', 'last_name', 'email', 'password_hash', 'onboarding_role', 'status', 'created_at', 'updated_at', 'last_login_at']).where('email', '=', body.email).executeTakeFirst()
    }
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }
    await db.updateTable('users').set({ last_login_at: new Date(), updated_at: new Date() }).where('id', '=', user.id).execute()
    const token = await createSession(user.id)
    res.setHeader('Set-Cookie', sessionCookie(token))
    const auth = await (await import('../services/auth.js')).getAuthUser(token)
    res.json({ user: auth ? publicUser(auth) : null })
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed' })
    res.status(500).json({ error: 'Unable to log in' })
  }
})

authRouter.post('/logout', async (req: Request, res: Response) => {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('sourcing_session='))
  if (cookie) await revokeSession(decodeURIComponent(cookie.slice('sourcing_session='.length)))
  res.setHeader('Set-Cookie', clearedSessionCookie())
  res.status(204).send()
})

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: publicUser(req.auth!) })
})

authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const body = z.object({ email: emailSchema }).safeParse(req.body)
  if (body.success) {
    const user = await db.selectFrom('users').select('id').where('email', '=', body.data.email).executeTakeFirst()
    if (user) {
      const token = await createPasswordResetToken(user.id)
      if (process.env.NODE_ENV !== 'production') console.info(`[Auth] Password reset token generated: ${token}`)
    }
  }
  res.json({ message: 'If an account exists for that email, password reset instructions have been sent.' })
})

authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const body = z.object({ token: z.string().min(1), password: passwordSchema }).safeParse(req.body)
  if (!body.success || !(await resetPassword(body.data.token, body.data.password))) {
    return res.status(400).json({ error: 'Invalid or expired reset token' })
  }
  res.json({ message: 'Password updated successfully' })
})
