import { randomBytes, createHash } from 'crypto'
import { pool } from '../db/index.js'
import { decryptKey, encryptKey } from './key-encryption.js'
import { uploadRawResumeToCloudinary } from './cloudinary.js'

const SETTINGS_SUFFIX = ':zoho_recruit'
const ACCOUNTS_URL = 'https://accounts.zoho.com'
const OAUTH_SCOPE = 'ZohoRecruit.modules.ALL'
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const MAX_RESUME_BYTES = 15 * 1024 * 1024

interface ZohoState {
  encryptedClientId?: string
  encryptedClientSecret?: string
  redirectUri?: string
  encryptedRefreshToken?: string
  apiDomain?: string
  connectedAt?: string
  pendingState?: string
  pendingUserId?: string
  pendingExpiresAt?: number
  lastSyncAt?: string
  lastSyncSummary?: { inspected: number; uploaded: number; skipped: number; failed: number }
  importedAttachmentIds?: string[]
}

export interface ZohoRecruitStatus {
  oauthCredentialsSaved: boolean
  connected: boolean
  lastSyncAt: string | null
  lastSyncSummary: ZohoState['lastSyncSummary'] | null
  redirectUri: string
}

function settingsKey(organizationId: string): string {
  return `org:${organizationId}${SETTINGS_SUFFIX}`
}

async function readState(organizationId: string): Promise<ZohoState> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [settingsKey(organizationId)])
  return result.rows[0]?.value && typeof result.rows[0].value === 'object' ? result.rows[0].value as ZohoState : {}
}

async function writeState(organizationId: string, state: ZohoState): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [settingsKey(organizationId), JSON.stringify(state)],
  )
}

function defaultRedirectUri(): string {
  return `${(process.env.API_URL || `http://localhost:${process.env.PORT || '3000'}`).replace(/\/$/, '')}/api/settings/zoho-recruit/callback`
}

function credentials(state: ZohoState): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = state.encryptedClientId ? decryptKey(state.encryptedClientId) : ''
  const clientSecret = state.encryptedClientSecret ? decryptKey(state.encryptedClientSecret) : ''
  const redirectUri = state.redirectUri || defaultRedirectUri()
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Add Zoho Recruit OAuth credentials in Settings')
  if (!process.env.API_KEY_ENCRYPTION_SECRET) throw new Error('Set API_KEY_ENCRYPTION_SECRET before connecting Zoho Recruit')
  return { clientId, clientSecret, redirectUri }
}

export async function getZohoRecruitStatus(organizationId: string): Promise<ZohoRecruitStatus> {
  const state = await readState(organizationId)
  return {
    oauthCredentialsSaved: Boolean(state.encryptedClientId && state.encryptedClientSecret),
    connected: Boolean(state.encryptedRefreshToken && state.apiDomain),
    lastSyncAt: state.lastSyncAt || null,
    lastSyncSummary: state.lastSyncSummary || null,
    redirectUri: state.redirectUri || defaultRedirectUri(),
  }
}

export async function saveZohoRecruitCredentials(
  organizationId: string,
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
): Promise<ZohoRecruitStatus> {
  if (!process.env.API_KEY_ENCRYPTION_SECRET) throw new Error('Set API_KEY_ENCRYPTION_SECRET on the server before saving credentials')
  const state = await readState(organizationId)
  await writeState(organizationId, {
    ...state,
    encryptedClientId: encryptKey(clientId),
    encryptedClientSecret: encryptKey(clientSecret),
    redirectUri: redirectUri || defaultRedirectUri(),
  })
  return getZohoRecruitStatus(organizationId)
}

export async function createZohoRecruitAuthorizationUrl(organizationId: string, userId: string): Promise<string> {
  const state = await readState(organizationId)
  const { clientId, redirectUri } = credentials(state)
  const stateToken = randomBytes(32).toString('hex')
  await writeState(organizationId, {
    ...state,
    pendingState: stateToken,
    pendingUserId: userId,
    pendingExpiresAt: Date.now() + 10 * 60 * 1000,
  })
  const params = new URLSearchParams({
    scope: OAUTH_SCOPE,
    client_id: clientId,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    redirect_uri: redirectUri,
    state: stateToken,
  })
  return `${ACCOUNTS_URL}/oauth/v2/auth?${params.toString()}`
}

export async function completeZohoRecruitAuthorization(
  organizationId: string,
  userId: string,
  stateToken: string,
  code: string,
): Promise<void> {
  const state = await readState(organizationId)
  if (!state.pendingState || state.pendingState !== stateToken || state.pendingUserId !== userId || !state.pendingExpiresAt || state.pendingExpiresAt < Date.now()) {
    throw new Error('Zoho Recruit authorization expired or did not match the signed-in account. Try connecting again.')
  }
  const { clientId, clientSecret, redirectUri } = credentials(state)
  const response = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }),
  })
  const data = await response.json() as { access_token?: string; refresh_token?: string; api_domain?: string; error?: string }
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Zoho Recruit did not return an access token')
  const refreshToken = data.refresh_token || (state.encryptedRefreshToken ? decryptKey(state.encryptedRefreshToken) : '')
  if (!refreshToken) throw new Error('Zoho Recruit did not provide offline access. Reconnect and approve offline access.')
  await writeState(organizationId, {
    ...state,
    encryptedRefreshToken: encryptKey(refreshToken),
    apiDomain: data.api_domain || 'https://www.zohoapis.com',
    connectedAt: new Date().toISOString(),
    pendingState: undefined,
    pendingUserId: undefined,
    pendingExpiresAt: undefined,
  })
}

async function accessToken(organizationId: string, state: ZohoState): Promise<{ token: string; apiDomain: string }> {
  if (!state.encryptedRefreshToken || !state.apiDomain) throw new Error('Connect Zoho Recruit before syncing resumes')
  const { clientId, clientSecret } = credentials(state)
  const response = await fetch(`${ACCOUNTS_URL}/oauth/v2/token?${new URLSearchParams({
    refresh_token: decryptKey(state.encryptedRefreshToken),
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })}`, { method: 'POST' })
  const data = await response.json() as { access_token?: string; api_domain?: string; error?: string }
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Unable to refresh Zoho Recruit access')
  return { token: data.access_token, apiDomain: data.api_domain || state.apiDomain }
}

function filename(value: unknown): string {
  const safe = String(value || 'resume.pdf').replace(/[^\w.-]+/g, '_').replace(/^\.*/, '').slice(-120)
  return safe || 'resume.pdf'
}

export async function syncZohoRecruitResumes(organizationId: string): Promise<NonNullable<ZohoRecruitStatus['lastSyncSummary']> & { folder: string }> {
  const state = await readState(organizationId)
  const { token, apiDomain } = await accessToken(organizationId, state)
  const headers = { Authorization: `Zoho-oauthtoken ${token}` }
  const imported = new Set(state.importedAttachmentIds || [])
  let page = 1
  let inspected = 0
  let uploaded = 0
  let skipped = 0
  let failed = 0
  while (page <= 100) {
    const recordsResponse = await fetch(`${apiDomain}/recruit/v2/Candidates?${new URLSearchParams({ page: String(page), per_page: '200', fields: 'id,Full_Name' })}`, { headers })
    if (!recordsResponse.ok) throw new Error(`Zoho Recruit candidates request failed (${recordsResponse.status})`)
    const recordsData = await recordsResponse.json() as { data?: Array<{ id?: string; Full_Name?: string }>; info?: { more_records?: boolean } }
    const records = recordsData.data || []
    for (const candidate of records) {
      if (!candidate.id) continue
      const attachmentsResponse = await fetch(`${apiDomain}/recruit/v2/Candidates/${candidate.id}/Attachments`, { headers })
      if (!attachmentsResponse.ok) { failed++; continue }
      const attachmentData = await attachmentsResponse.json() as { data?: Array<{ id?: string; File_Name?: string; file_name?: string; Size?: number }> }
      for (const attachment of attachmentData.data || []) {
        const attachmentId = attachment.id
        const name = filename(attachment.File_Name || attachment.file_name)
        if (!attachmentId || !SUPPORTED_EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase())) continue
        inspected++
        if (imported.has(attachmentId)) { skipped++; continue }
        try {
          const fileResponse = await fetch(`${apiDomain}/recruit/v2/Candidates/${candidate.id}/Attachments/${attachmentId}`, { headers })
          if (!fileResponse.ok) throw new Error(`download failed (${fileResponse.status})`)
          const buffer = Buffer.from(await fileResponse.arrayBuffer())
          if (!buffer.length || buffer.length > MAX_RESUME_BYTES) throw new Error('resume size is outside the supported limit')
          const digest = createHash('sha256').update(`${organizationId}:${attachmentId}`).digest('hex')
          await uploadRawResumeToCloudinary(buffer, `zoho-resumes/${organizationId}`, `${digest}_${name}`)
          imported.add(attachmentId)
          uploaded++
        } catch (error) {
          failed++
          console.error(`[Zoho Recruit] Failed to import ${candidate.id}/${attachmentId}:`, error)
        }
      }
    }
    if (!recordsData.info?.more_records || records.length === 0) break
    page++
  }
  const folder = `zoho-resumes/${organizationId}`
  const summary = { inspected, uploaded, skipped, failed, folder }
  await writeState(organizationId, { ...state, apiDomain, importedAttachmentIds: Array.from(imported).slice(-10000), lastSyncAt: new Date().toISOString(), lastSyncSummary: summary })
  return summary
}

export async function disconnectZohoRecruit(organizationId: string): Promise<void> {
  await pool.query('DELETE FROM settings WHERE key = $1', [settingsKey(organizationId)])
}
