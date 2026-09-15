import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { db } from '../db/index.js'

export const SESSION_COOKIE = 'sourcing_session'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365
const RESET_TTL_MS = 1000 * 60 * 60

export type MemberRole = 'OWNER' | 'ADMIN' | 'RECRUITER' | 'HIRING_MANAGER' | 'MEMBER'

export interface AuthUser {
  id: string
  firstName: string
  lastName: string
  email: string
  status: 'ACTIVE' | 'DISABLED'
  organizationId: string
  organizationName: string
  role: MemberRole
  onboardingComplete: boolean
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.insertInto('sessions').values({
    id: randomUUID(),
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
    created_at: new Date(),
    last_used_at: null,
  }).execute()
  return token
}

export async function revokeSession(token: string): Promise<void> {
  await db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute()
}

export async function getAuthUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null
  const row = await db.selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .innerJoin('organization_members', 'organization_members.user_id', 'users.id')
    .innerJoin('organizations', 'organizations.id', 'organization_members.organization_id')
    .select([
      'users.id as user_id', 'users.first_name', 'users.last_name', 'users.email', 'users.status',
      'users.onboarding_role', 'organizations.id as organization_id', 'organizations.name as organization_name',
      'organizations.website', 'organizations.onboarding_completed', 'organization_members.role', 'sessions.id as session_id', 'sessions.expires_at',
    ])
    .where('sessions.token_hash', '=', hashToken(token))
    .where('sessions.expires_at', '>', new Date())
    .where('users.status', '=', 'ACTIVE')
    .where('organization_members.status', '=', 'ACTIVE')
    .executeTakeFirst()

  if (!row) return null
  const now = new Date()
  await db.updateTable('sessions')
    .set({ last_used_at: now, expires_at: new Date(now.getTime() + SESSION_TTL_MS) })
    .where('id', '=', row.session_id)
    .execute()
  return {
    id: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    status: row.status,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.role,
    onboardingComplete: row.onboarding_completed,
  }
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.updateTable('password_reset_tokens')
    .set({ used_at: new Date() })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute()
  await db.insertInto('password_reset_tokens').values({
    id: randomUUID(), user_id: userId, token_hash: hashToken(token),
    expires_at: new Date(Date.now() + RESET_TTL_MS), used_at: null, created_at: new Date(),
  }).execute()
  return token
}

export async function resetPassword(token: string, password: string): Promise<boolean> {
  const tokenHash = hashToken(token)
  const passwordHash = await hashPassword(password)
  const result = await db.transaction().execute(async (trx) => {
    const reset = await trx.selectFrom('password_reset_tokens').select(['id', 'user_id'])
      .where('token_hash', '=', tokenHash).where('expires_at', '>', new Date()).where('used_at', 'is', null)
      .executeTakeFirst()
    if (!reset) return false
    await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: new Date() })
      .where('id', '=', reset.user_id).execute()
    await trx.updateTable('password_reset_tokens').set({ used_at: new Date() })
      .where('id', '=', reset.id).execute()
    await trx.deleteFrom('sessions').where('user_id', '=', reset.user_id).execute()
    return true
  })
  return result
}
