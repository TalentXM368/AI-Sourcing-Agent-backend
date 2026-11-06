import { pool } from '../db/index.js'
import { decryptKey, encryptKey } from './key-encryption.js'

const SETTINGS_PREFIX = 'org:'
const SETTINGS_SUFFIX = ':email_connection'

export interface EmailConnection {
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName: string
}

export interface EmailConnectionStatus {
  configured: boolean
  host: string | null
  port: number | null
  username: string | null
  fromEmail: string | null
  fromName: string | null
  hasPassword: boolean
}

function settingKey(organizationId: string): string {
  return `${SETTINGS_PREFIX}${organizationId}${SETTINGS_SUFFIX}`
}

export async function getEmailConnection(organizationId: string): Promise<EmailConnection | null> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [settingKey(organizationId)])
  const value = result.rows[0]?.value
  if (!value || typeof value !== 'object') return null

  const config = value as Partial<EmailConnection> & { encryptedPassword?: string }
  if (!config.host || !config.port || !config.username || !config.encryptedPassword || !config.fromEmail) return null

  return {
    host: config.host,
    port: Number(config.port),
    username: config.username,
    password: decryptKey(config.encryptedPassword),
    fromEmail: config.fromEmail,
    fromName: config.fromName || '',
  }
}

export async function getEmailConnectionStatus(organizationId: string): Promise<EmailConnectionStatus> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [settingKey(organizationId)])
  const value = result.rows[0]?.value
  if (!value || typeof value !== 'object') {
    return { configured: false, host: null, port: null, username: null, fromEmail: null, fromName: null, hasPassword: false }
  }

  const config = value as Partial<EmailConnection> & { encryptedPassword?: string }
  return {
    configured: Boolean(config.host && config.port && config.username && config.encryptedPassword && config.fromEmail),
    host: config.host || null,
    port: config.port ? Number(config.port) : null,
    username: config.username || null,
    fromEmail: config.fromEmail || null,
    fromName: config.fromName || null,
    hasPassword: Boolean(config.encryptedPassword),
  }
}

export async function saveEmailConnection(organizationId: string, input: Omit<EmailConnection, 'password'> & { password?: string }): Promise<void> {
  const existing = await getEmailConnection(organizationId)
  const password = input.password || existing?.password
  if (!password) throw new Error('SMTP password is required')

  const value = {
    host: input.host,
    port: input.port,
    username: input.username,
    encryptedPassword: encryptKey(password),
    fromEmail: input.fromEmail,
    fromName: input.fromName,
  }

  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [settingKey(organizationId), JSON.stringify(value)],
  )
}

export async function deleteEmailConnection(organizationId: string): Promise<void> {
  await pool.query('DELETE FROM settings WHERE key = $1', [settingKey(organizationId)])
}
