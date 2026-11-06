import { createHash, randomBytes } from 'crypto'
import { google, type gmail_v1 } from 'googleapis'
import { pool } from '../db/index.js'
import { decryptKey, encryptKey } from './key-encryption.js'
import { uploadRawResumeToCloudinary } from './cloudinary.js'

const GOOGLE_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const SETTINGS_SUFFIX = ':gmail_resume_ingestion'
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const PAGE_SIZE = 10
const FAILED_MESSAGE_RETRY_LIMIT = 10
const POLL_INTERVAL_MS = 5 * 60 * 1000

export interface GmailResumeFilters {
  senderContains: string
  subjectKeywords: string[]
  daysBack: number
}

interface GmailResumeState {
  encryptedClientId?: string
  encryptedClientSecret?: string
  redirectUri?: string
  configured?: true
  accountEmail?: string
  encryptedRefreshToken?: string
  enabled?: boolean
  filters?: GmailResumeFilters
  connectedAt?: string
  lastCheckedAt?: string
  scanQuery?: string
  nextPageToken?: string
  lastSyncAt?: string
  lastSyncSummary?: { inspected: number; uploaded: number; skipped: number; failed: number }
  pendingState?: string
  pendingUserId?: string
  pendingExpiresAt?: number
}

export interface GmailResumeIngestionStatus {
  oauthConfigured: boolean
  oauthCredentialsSaved: boolean
  connected: boolean
  accountEmail: string | null
  enabled: boolean
  filters: GmailResumeFilters
  lastSyncAt: string | null
  lastSyncSummary: GmailResumeState['lastSyncSummary'] | null
}

const DEFAULT_FILTERS: GmailResumeFilters = {
  senderContains: '',
  subjectKeywords: [],
  daysBack: 30,
}

const activeOrganizations = new Set<string>()

function settingsKey(organizationId: string): string {
  return `org:${organizationId}${SETTINGS_SUFFIX}`
}

async function oauthClient(organizationId: string) {
  const state = await readState(organizationId)
  const clientId = state.encryptedClientId ? decryptKey(state.encryptedClientId) : process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = state.encryptedClientSecret ? decryptKey(state.encryptedClientSecret) : process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = state.redirectUri || process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Add your Google OAuth credentials and callback URL in Settings')
  if (!process.env.API_KEY_ENCRYPTION_SECRET) {
    throw new Error('Set API_KEY_ENCRYPTION_SECRET before enabling Gmail inbox connections')
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function parseState(value: unknown): GmailResumeState {
  return value && typeof value === 'object' ? value as GmailResumeState : {}
}

async function readState(organizationId: string): Promise<GmailResumeState> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [settingsKey(organizationId)])
  return parseState(result.rows[0]?.value)
}

async function writeState(organizationId: string, state: GmailResumeState): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [settingsKey(organizationId), JSON.stringify(state)],
  )
}

export async function getGmailResumeIngestionStatus(organizationId: string): Promise<GmailResumeIngestionStatus> {
  const state = await readState(organizationId)
  return {
    oauthConfigured: Boolean(process.env.API_KEY_ENCRYPTION_SECRET && (
      (state.encryptedClientId && state.encryptedClientSecret && state.redirectUri)
      || (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI)
    )),
    oauthCredentialsSaved: Boolean(state.encryptedClientId && state.encryptedClientSecret && state.redirectUri),
    connected: Boolean(state.encryptedRefreshToken && state.accountEmail),
    accountEmail: state.accountEmail || null,
    enabled: Boolean(state.enabled),
    filters: state.filters || DEFAULT_FILTERS,
    lastSyncAt: state.lastSyncAt || null,
    lastSyncSummary: state.lastSyncSummary || null,
  }
}

export async function saveGmailOAuthCredentials(
  organizationId: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<GmailResumeIngestionStatus> {
  if (!process.env.API_KEY_ENCRYPTION_SECRET) throw new Error('Set API_KEY_ENCRYPTION_SECRET on the server before saving credentials')
  const state = await readState(organizationId)
  await writeState(organizationId, {
    ...state,
    encryptedClientId: encryptKey(clientId),
    encryptedClientSecret: encryptKey(clientSecret),
    redirectUri,
  })
  return getGmailResumeIngestionStatus(organizationId)
}

export async function createGmailAuthorizationUrl(organizationId: string, userId: string): Promise<string> {
  const client = await oauthClient(organizationId)
  const stateToken = randomBytes(32).toString('hex')
  const stored = await readState(organizationId)
  await writeState(organizationId, {
    ...stored,
    pendingState: stateToken,
    pendingUserId: userId,
    pendingExpiresAt: Date.now() + 10 * 60 * 1000,
  })

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GOOGLE_GMAIL_READONLY_SCOPE],
    state: stateToken,
  })
}

export async function completeGmailAuthorization(
  organizationId: string,
  userId: string,
  stateToken: string,
  code: string,
): Promise<void> {
  const stored = await readState(organizationId)
  if (
    !stored.pendingState
    || stored.pendingState !== stateToken
    || stored.pendingUserId !== userId
    || !stored.pendingExpiresAt
    || stored.pendingExpiresAt < Date.now()
  ) {
    throw new Error('Gmail authorization expired or did not match the signed-in account. Try connecting again.')
  }

  const client = await oauthClient(organizationId)
  const { tokens } = await client.getToken(code)
  const refreshToken = tokens.refresh_token
    || (stored.encryptedRefreshToken ? decryptKey(stored.encryptedRefreshToken) : undefined)
  if (!refreshToken) {
    throw new Error('Google did not provide offline access. Disconnect the app in Google Account settings and try again.')
  }

  client.setCredentials({ ...tokens, refresh_token: refreshToken })
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const accountEmail = profile.data.emailAddress
  if (!accountEmail) throw new Error('Google did not return the connected email address')

  await writeState(organizationId, {
    ...stored,
    configured: true,
    accountEmail,
    encryptedRefreshToken: encryptKey(refreshToken),
    enabled: false,
    filters: stored.filters || DEFAULT_FILTERS,
    connectedAt: new Date().toISOString(),
    pendingState: undefined,
    pendingUserId: undefined,
    pendingExpiresAt: undefined,
    lastCheckedAt: undefined,
    scanQuery: undefined,
    nextPageToken: undefined,
  })
}

export async function saveGmailResumeFilters(
  organizationId: string,
  filters: GmailResumeFilters,
  enabled: boolean,
): Promise<GmailResumeIngestionStatus> {
  const stored = await readState(organizationId)
  if (!stored.encryptedRefreshToken) throw new Error('Connect a Gmail account before saving inbox filters')

  await pool.query(
    `DELETE FROM gmail_resume_ingestion_events
     WHERE organization_id = $1 AND status = 'SKIPPED'`,
    [organizationId],
  )
  await writeState(organizationId, {
    ...stored,
    filters,
    enabled,
    scanQuery: undefined,
    nextPageToken: undefined,
    lastCheckedAt: undefined,
  })
  return getGmailResumeIngestionStatus(organizationId)
}

export async function disconnectGmailResumeIngestion(organizationId: string): Promise<void> {
  await pool.query('DELETE FROM settings WHERE key = $1', [settingsKey(organizationId)])
}

async function makeGmailClient(organizationId: string, refreshToken: string) {
  const client = await oauthClient(organizationId)
  client.setCredentials({ refresh_token: refreshToken })
  return google.gmail({ version: 'v1', auth: client })
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function collectAttachments(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return []
  const hasFilename = Boolean(part.filename?.trim())
  return [
    ...(hasFilename ? [part] : []),
    ...(part.parts || []).flatMap(collectAttachments),
  ]
}

function matchesFilters(from: string, subject: string, filters: GmailResumeFilters): boolean {
  if (filters.senderContains && !from.toLowerCase().includes(filters.senderContains.toLowerCase())) return false
  if (filters.subjectKeywords.length > 0) {
    const normalizedSubject = subject.toLowerCase()
    if (!filters.subjectKeywords.some(keyword => normalizedSubject.includes(keyword.toLowerCase()))) return false
  }
  return true
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.-]+/g, '_').replace(/^\.*/, '').slice(-120) || 'resume.pdf'
}

async function getAttachmentData(
  gmail: Awaited<ReturnType<typeof makeGmailClient>>,
  messageId: string,
  part: gmail_v1.Schema$MessagePart,
): Promise<Buffer> {
  let encoded = part.body?.data
  if (!encoded && part.body?.attachmentId) {
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: part.body.attachmentId,
    })
    encoded = attachment.data.data
  }
  if (!encoded) throw new Error('Gmail returned an attachment without file data')
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function hasEvent(organizationId: string, messageId: string, attachmentId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM gmail_resume_ingestion_events
     WHERE organization_id = $1 AND message_id = $2 AND attachment_id = $3 AND status IN ('UPLOADED', 'SKIPPED')`,
    [organizationId, messageId, attachmentId],
  )
  return result.rows.length > 0
}

async function recordEvent(
  organizationId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  status: 'UPLOADED' | 'SKIPPED' | 'FAILED',
  reason: string | null,
  publicId: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO gmail_resume_ingestion_events
       (organization_id, message_id, attachment_id, filename, status, reason, cloudinary_public_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (organization_id, message_id, attachment_id) DO UPDATE
       SET filename = EXCLUDED.filename, status = EXCLUDED.status, reason = EXCLUDED.reason,
           cloudinary_public_id = EXCLUDED.cloudinary_public_id, created_at = NOW()`,
    [organizationId, messageId, attachmentId, filename, status, reason, publicId],
  )
}

async function processMessage(
  organizationId: string,
  gmail: Awaited<ReturnType<typeof makeGmailClient>>,
  messageId: string,
  filters: GmailResumeFilters,
): Promise<{ uploaded: number; skipped: number; failed: number }> {
  const result = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
  const message = result.data
  const headers = message.payload?.headers
  const from = headerValue(headers, 'from')
  const subject = headerValue(headers, 'subject')
  const attachments = collectAttachments(message.payload)
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const attachment of attachments) {
    const filename = attachment.filename || 'resume.pdf'
    const attachmentId = attachment.partId || attachment.body?.attachmentId || filename
    if (await hasEvent(organizationId, messageId, attachmentId)) continue
    if (!matchesFilters(from, subject, filters)) {
      await recordEvent(organizationId, messageId, attachmentId, filename, 'SKIPPED', 'Email did not match saved filters')
      skipped++
      continue
    }

    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      await recordEvent(organizationId, messageId, attachmentId, filename, 'SKIPPED', 'Only PDF, DOC, and DOCX resume attachments are supported')
      skipped++
      continue
    }

    try {
      const data = await getAttachmentData(gmail, messageId, attachment)
      if (!data.length) throw new Error('Attachment is empty')
      if (data.length > MAX_ATTACHMENT_BYTES) {
        await recordEvent(organizationId, messageId, attachmentId, filename, 'SKIPPED', 'Attachment exceeds the 15 MB limit')
        skipped++
        continue
      }

      const digest = createHash('sha256').update(data).digest('hex')
      const publicId = `gmail-${digest}-${sanitizeFilename(filename)}`
      await uploadRawResumeToCloudinary(data, `email-resumes/${organizationId}`, publicId)
      await recordEvent(organizationId, messageId, attachmentId, filename, 'UPLOADED', null, publicId)
      uploaded++
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await recordEvent(organizationId, messageId, attachmentId, filename, 'FAILED', reason.slice(0, 500))
      failed++
      console.error(`[Gmail Resume Ingestion] Failed to store attachment ${filename}:`, reason)
    }
  }

  return { uploaded, skipped, failed }
}

export async function syncGmailResumes(organizationId: string): Promise<{
  inspected: number
  uploaded: number
  skipped: number
  failed: number
  complete: boolean
}> {
  if (activeOrganizations.has(organizationId)) {
    throw new Error('A Gmail inbox check is already in progress for this organization')
  }
  activeOrganizations.add(organizationId)
  try {
    const state = await readState(organizationId)
    if (!state.enabled || !state.encryptedRefreshToken) {
      throw new Error('Connect Gmail and enable inbox filters before checking the inbox')
    }
    const gmail = await makeGmailClient(organizationId, decryptKey(state.encryptedRefreshToken))
    const filters = state.filters || DEFAULT_FILTERS
    const now = new Date()
    const startDate = new Date(now.getTime() - filters.daysBack * 24 * 60 * 60 * 1000)
    const query = state.scanQuery
      || `after:${Math.floor((state.lastCheckedAt
        ? new Date(state.lastCheckedAt).getTime() - 5 * 60 * 1000
        : startDate.getTime()) / 1000)} has:attachment`
    const failedMessages = await pool.query(
      `SELECT message_id FROM gmail_resume_ingestion_events
       WHERE organization_id = $1 AND status = 'FAILED'
       GROUP BY message_id ORDER BY MAX(created_at) ASC LIMIT $2`,
      [organizationId, FAILED_MESSAGE_RETRY_LIMIT],
    )
    const totals = { inspected: 0, uploaded: 0, skipped: 0, failed: 0 }
    for (const row of failedMessages.rows as Array<{ message_id: string }>) {
      totals.inspected++
      try {
        const result = await processMessage(organizationId, gmail, row.message_id, filters)
        totals.uploaded += result.uploaded
        totals.skipped += result.skipped
        totals.failed += result.failed
      } catch (error) {
        totals.failed++
        console.error(`[Gmail Resume Ingestion] Failed to retry Gmail message ${row.message_id}:`, error)
      }
    }

    const page = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: PAGE_SIZE,
      pageToken: state.nextPageToken || undefined,
    })
    const messages = page.data.messages || []

    for (const message of messages) {
      if (!message.id) continue
      const result = await processMessage(organizationId, gmail, message.id, filters)
      totals.inspected++
      totals.uploaded += result.uploaded
      totals.skipped += result.skipped
      totals.failed += result.failed
    }

    const complete = !page.data.nextPageToken
    await writeState(organizationId, {
      ...state,
      scanQuery: complete ? undefined : query,
      nextPageToken: page.data.nextPageToken || undefined,
      lastCheckedAt: complete ? now.toISOString() : state.lastCheckedAt,
      lastSyncAt: now.toISOString(),
      lastSyncSummary: totals,
    })
    return { ...totals, complete }
  } finally {
    activeOrganizations.delete(organizationId)
  }
}

export async function pollEnabledGmailInboxes(): Promise<{ checked: number; failed: number }> {
  const result = await pool.query(
    `SELECT key FROM settings WHERE right(key, length($1)) = $1 AND value->>'enabled' = 'true'`,
    [SETTINGS_SUFFIX],
  )
  let failed = 0
  await Promise.all(result.rows.map(async (row: { key: string }) => {
    const organizationId = row.key.slice('org:'.length, -SETTINGS_SUFFIX.length)
    try {
      await syncGmailResumes(organizationId)
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('already in progress'))) {
        failed++
        console.error(`[Gmail Resume Ingestion] Inbox check failed for organization ${organizationId}:`, error)
      }
    }
  }))
  return { checked: result.rows.length, failed }
}

export function startGmailResumeIngestionScheduler(): void {
  const timer = setInterval(() => {
    pollEnabledGmailInboxes().catch(error => console.error('[Gmail Resume Ingestion] Poll failed:', error))
  }, POLL_INTERVAL_MS)
  timer.unref()
  setTimeout(() => {
    pollEnabledGmailInboxes().catch(error => console.error('[Gmail Resume Ingestion] Initial poll failed:', error))
  }, 30_000).unref()
}
