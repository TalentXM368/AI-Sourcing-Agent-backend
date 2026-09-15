import type { NextFunction, Request, Response } from 'express'
import { getAuthUser, SESSION_TTL_MS, type AuthUser, type MemberRole } from '../services/auth.js'
import { withOrganization } from '../services/request-context.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser
    }
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  const item = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined
}

export async function attachAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookie(req.headers.cookie, 'sourcing_session')
    req.auth = await getAuthUser(token) ?? undefined
    if (req.auth && token) {
      _res.setHeader('Set-Cookie', sessionCookie(token))
    }
    withOrganization(req.auth?.organizationId, next)
  } catch (error) {
    next(error)
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  next()
}

export function requireRole(roles: MemberRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_MS): string {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.VERCEL === '1'
  const secure = isProduction ? '; Secure' : ''
  const sameSite = isProduction ? 'None' : 'Lax'
  return `sourcing_session=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`
}

export function clearedSessionCookie(): string {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.VERCEL === '1'
  const secure = isProduction ? '; Secure' : ''
  const sameSite = isProduction ? 'None' : 'Lax'
  return `sourcing_session=; Max-Age=0; Path=/; HttpOnly; SameSite=${sameSite}${secure}`
}
