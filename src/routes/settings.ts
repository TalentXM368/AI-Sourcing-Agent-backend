import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { getPdlQuotaStatus, resetPdlQuota } from '../services/people-data-labs.js'
import {
  PROVIDERS, ProviderId, getApiKey, saveApiKey, deleteApiKey,
  getApiKeyStatus, invalidateKeyCache,
} from '../services/api-key-store.js'
import { decryptKey } from '../services/key-encryption.js'
import { requireAuth } from '../middleware/auth.js'
import { deleteEmailConnection, getEmailConnectionStatus, saveEmailConnection } from '../services/email-settings.js'
import {
  completeGmailAuthorization,
  createGmailAuthorizationUrl,
  disconnectGmailResumeIngestion,
  getGmailResumeIngestionStatus,
  saveGmailOAuthCredentials,
  saveGmailResumeFilters,
  syncGmailResumes,
} from '../services/gmail-resume-ingestion.js'
import {
  completeZohoRecruitAuthorization,
  createZohoRecruitAuthorizationUrl,
  disconnectZohoRecruit,
  getZohoRecruitStatus,
  saveZohoRecruitCredentials,
  syncZohoRecruitResumes,
} from '../services/zoho-recruit-ingestion.js'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

const emailConnectionSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(255),
  password: z.string().max(500).optional(),
  fromEmail: z.string().trim().email().max(254),
  fromName: z.string().trim().max(120).default(''),
})

settingsRouter.get('/email-connection', async (req: Request, res: Response) => {
  try {
    res.json(await getEmailConnectionStatus(req.auth!.organizationId))
  } catch {
    res.status(500).json({ error: 'Failed to load email connection' })
  }
})

settingsRouter.put('/email-connection', async (req: Request, res: Response) => {
  try {
    const input = emailConnectionSchema.parse(req.body)
    await saveEmailConnection(req.auth!.organizationId, input)
    res.json({ message: 'Email connection saved', ...(await getEmailConnectionStatus(req.auth!.organizationId)) })
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid email connection', details: error.errors })
    res.status(500).json({ error: 'Failed to save email connection' })
  }
})

settingsRouter.delete('/email-connection', async (req: Request, res: Response) => {
  try {
    await deleteEmailConnection(req.auth!.organizationId)
    res.json({ message: 'Email connection removed' })
  } catch {
    res.status(500).json({ error: 'Failed to remove email connection' })
  }
})

const gmailFiltersSchema = z.object({
  senderContains: z.string().trim().max(200).default(''),
  subjectKeywords: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  daysBack: z.number().int().min(1).max(365).default(30),
})
const gmailOAuthCredentialsSchema = z.object({
  clientId: z.string().trim().min(10).max(500),
  clientSecret: z.string().trim().min(10).max(500),
  redirectUri: z.string().trim().url().max(1000),
})

settingsRouter.get('/gmail-ingestion', async (req: Request, res: Response) => {
  try {
    res.json(await getGmailResumeIngestionStatus(req.auth!.organizationId))
  } catch (error) {
    console.error('[Settings] Failed to load Gmail ingestion settings:', error)
    res.status(500).json({ error: 'Failed to load Gmail inbox settings' })
  }
})

settingsRouter.post('/gmail-ingestion/connect', async (req: Request, res: Response) => {
  try {
    const authorizationUrl = await createGmailAuthorizationUrl(req.auth!.organizationId, req.auth!.id)
    res.json({ authorizationUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start Gmail authorization'
    res.status(503).json({ error: message })
  }
})

settingsRouter.put('/gmail-ingestion/oauth', async (req: Request, res: Response) => {
  try {
    const credentials = gmailOAuthCredentialsSchema.parse(req.body)
    const redirect = new URL(credentials.redirectUri)
    if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === 'localhost')) {
      return res.status(400).json({ error: 'The callback URL must use HTTPS, except for localhost development' })
    }
    res.json(await saveGmailOAuthCredentials(
      req.auth!.organizationId,
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri,
    ))
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid Google OAuth credentials', details: error.errors })
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to save Google OAuth credentials' })
  }
})

settingsRouter.get('/gmail-ingestion/callback', async (req: Request, res: Response) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '')
  const statusUrl = `${frontendUrl}/settings`
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined
  if (oauthError) return res.redirect(`${statusUrl}?gmail=denied`)

  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!state || !code) return res.redirect(`${statusUrl}?gmail=failed`)

  try {
    await completeGmailAuthorization(req.auth!.organizationId, req.auth!.id, state, code)
    res.redirect(`${statusUrl}?gmail=connected`)
  } catch (error) {
    console.error('[Settings] Gmail authorization failed:', error)
    res.redirect(`${statusUrl}?gmail=failed`)
  }
})

settingsRouter.put('/gmail-ingestion', async (req: Request, res: Response) => {
  try {
    const filters = gmailFiltersSchema.parse(req.body.filters)
    const enabled = req.body.enabled
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' })
    if (enabled && !filters.senderContains && filters.subjectKeywords.length === 0) {
      return res.status(400).json({ error: 'Set at least one sender or subject filter before enabling inbox collection' })
    }
    res.json(await saveGmailResumeFilters(req.auth!.organizationId, filters, enabled))
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid Gmail inbox filters', details: error.errors })
    const message = error instanceof Error ? error.message : 'Failed to save Gmail inbox filters'
    res.status(400).json({ error: message })
  }
})

settingsRouter.post('/gmail-ingestion/sync', async (req: Request, res: Response) => {
  try {
    res.json(await syncGmailResumes(req.auth!.organizationId))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check Gmail inbox'
    res.status(400).json({ error: message })
  }
})

settingsRouter.delete('/gmail-ingestion', async (req: Request, res: Response) => {
  try {
    await disconnectGmailResumeIngestion(req.auth!.organizationId)
    res.json({ message: 'Gmail disconnected. Files already stored in Cloudinary are not deleted.' })
  } catch (error) {
    console.error('[Settings] Failed to disconnect Gmail:', error)
    res.status(500).json({ error: 'Failed to disconnect Gmail' })
  }
})

const zohoCredentialsSchema = z.object({
  clientId: z.string().trim().min(10).max(500),
  clientSecret: z.string().trim().min(10).max(500),
  redirectUri: z.string().trim().url().max(1000).optional(),
})

settingsRouter.get('/zoho-recruit', async (req: Request, res: Response) => {
  try {
    res.json(await getZohoRecruitStatus(req.auth!.organizationId))
  } catch {
    res.status(500).json({ error: 'Failed to load Zoho Recruit settings' })
  }
})

settingsRouter.put('/zoho-recruit/oauth', async (req: Request, res: Response) => {
  try {
    const credentials = zohoCredentialsSchema.parse(req.body)
    res.json(await saveZohoRecruitCredentials(req.auth!.organizationId, credentials.clientId, credentials.clientSecret, credentials.redirectUri))
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid Zoho Recruit OAuth credentials', details: error.errors })
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to save Zoho Recruit credentials' })
  }
})

settingsRouter.post('/zoho-recruit/connect', async (req: Request, res: Response) => {
  try {
    res.json({ authorizationUrl: await createZohoRecruitAuthorizationUrl(req.auth!.organizationId, req.auth!.id) })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to start Zoho Recruit authorization' })
  }
})

settingsRouter.get('/zoho-recruit/callback', async (req: Request, res: Response) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '')
  const statusUrl = `${frontendUrl}/settings`
  if (typeof req.query.error === 'string') return res.redirect(`${statusUrl}?zoho=denied`)
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!state || !code) return res.redirect(`${statusUrl}?zoho=failed`)
  try {
    await completeZohoRecruitAuthorization(req.auth!.organizationId, req.auth!.id, state, code)
    res.redirect(`${statusUrl}?zoho=connected`)
  } catch (error) {
    console.error('[Settings] Zoho Recruit authorization failed:', error)
    res.redirect(`${statusUrl}?zoho=failed`)
  }
})

settingsRouter.post('/zoho-recruit/sync', async (req: Request, res: Response) => {
  try {
    res.json(await syncZohoRecruitResumes(req.auth!.organizationId))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to sync Zoho Recruit resumes' })
  }
})

settingsRouter.delete('/zoho-recruit', async (req: Request, res: Response) => {
  try {
    await disconnectZohoRecruit(req.auth!.organizationId)
    res.json({ message: 'Zoho Recruit disconnected' })
  } catch {
    res.status(500).json({ error: 'Failed to disconnect Zoho Recruit' })
  }
})

// In-memory cache (fast reads, reset on server restart)
const settingsCache = new Map<string, boolean>()
let lastLoadTime = 0
const CACHE_TTL_MS = 30_000 // Refresh from DB every 30 seconds

async function loadSettings(force = false) {
  const now = Date.now()
  if (!force && now - lastLoadTime < CACHE_TTL_MS) return
  const rows = await pool.query('SELECT key, value FROM settings')
  for (const row of rows.rows) {
    settingsCache.set(row.key, row.value === true || row.value === 'true')
  }
  lastLoadTime = now
}

// Load on startup
loadSettings(true).catch(() => {})

// ─── Get All Settings ────────────────────────────────────────

settingsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    await loadSettings()
    res.json({
      auto_sync_resumes: settingsCache.get('auto_sync_resumes') ?? true,
      auto_sync_jds: settingsCache.get('auto_sync_jds') ?? true,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings' })
  }
})

// ─── API Key Management ──────────────────────────────────────

settingsRouter.get('/api-keys', async (_req: Request, res: Response) => {
  try {
    const statuses = await Promise.all(
      (Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => {
        const status = await getApiKeyStatus(id, _req.auth!.organizationId)
        return { ...PROVIDERS[id], ...status }
      })
    )
    res.json({ providers: statuses })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load API key statuses' })
  }
})

settingsRouter.get('/api-keys/:provider', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider)
    if (!(provider in PROVIDERS)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }
    const status = await getApiKeyStatus(provider as ProviderId, req.auth!.organizationId)
    res.json({ ...PROVIDERS[provider as ProviderId], ...status })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load provider status' })
  }
})

settingsRouter.put('/api-keys/:provider', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider)
    if (!(provider in PROVIDERS)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }
    const { key } = req.body
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return res.status(400).json({ error: 'API key is required' })
    }
    await saveApiKey(provider as ProviderId, key.trim(), req.auth!.organizationId)
    invalidateKeyCache()
    const status = await getApiKeyStatus(provider as ProviderId, req.auth!.organizationId)
    console.log(`[Settings] API key saved for provider: ${provider}`)
    res.json({ message: 'API key saved', ...status })
  } catch (error) {
    res.status(500).json({ error: 'Failed to save API key' })
  }
})

settingsRouter.delete('/api-keys/:provider', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider)
    if (!(provider in PROVIDERS)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }
    await deleteApiKey(provider as ProviderId, req.auth!.organizationId)
    invalidateKeyCache()
    console.log(`[Settings] API key deleted for provider: ${provider}`)
    res.json({ message: 'API key removed' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete API key' })
  }
})

settingsRouter.post('/api-keys/:provider/validate', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider)
    if (!(provider in PROVIDERS)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }

    const key = await getApiKey(provider as ProviderId, req.auth!.organizationId)
    if (!key) {
      return res.status(400).json({ valid: false, error: 'No API key configured' })
    }

    let valid = false
    let message = ''

    try {
      if (provider === 'pdl') {
        const resp = await fetch('https://api.peopledatalabs.com/v5/person/search?limit=1', {
          headers: { 'X-Api-Key': key },
        })
        valid = resp.ok
        message = resp.ok ? 'Key is valid' : `API returned ${resp.status}`
      } else if (provider === 'coresignal') {
        const resp = await fetch('https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: key },
          body: JSON.stringify({ size: 1, query: { match_all: {} } }),
        })
        valid = resp.ok
        message = resp.ok ? 'Key is valid' : `API returned ${resp.status}`
      } else if (provider === 'github') {
        const resp = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${key}` },
        })
        valid = resp.ok
        message = resp.ok ? 'Key is valid' : `API returned ${resp.status}`
      } else if (provider === 'kaggle_username' || provider === 'kaggle_key') {
        // Validate Kaggle by checking both are set and making a test request
        const username = provider === 'kaggle_username' ? key : await getApiKey('kaggle_username', req.auth!.organizationId)
        const kaggleKey = provider === 'kaggle_key' ? key : await getApiKey('kaggle_key', req.auth!.organizationId)
        if (!username || !kaggleKey) {
          valid = false
          message = 'Both Kaggle username and API key are required'
        } else {
          const auth = Buffer.from(`${username}:${kaggleKey}`).toString('base64')
          const resp = await fetch('https://www.kaggle.com/api/v1/datasets/list?page=1&pageSize=1', {
            headers: { Authorization: `Basic ${auth}` },
          })
          valid = resp.ok
          message = resp.ok ? 'Key is valid' : `API returned ${resp.status}`
        }
      }
    } catch (err: any) {
      valid = false
      message = err?.message || 'Validation request failed'
    }

    res.json({ valid, message })
  } catch (error) {
    res.status(500).json({ error: 'Failed to validate API key' })
  }
})

// ─── Get Single Setting ──────────────────────────────────────

settingsRouter.get('/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params
    if (key !== 'auto_sync_resumes' && key !== 'auto_sync_jds') {
      return res.status(400).json({ error: 'Invalid setting key' })
    }
    await loadSettings()
    res.json({ key, value: settingsCache.get(key) ?? true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load setting' })
  }
})

// ─── Toggle Setting ──────────────────────────────────────────

settingsRouter.patch('/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params
    if (key !== 'auto_sync_resumes' && key !== 'auto_sync_jds') {
      return res.status(400).json({ error: 'Invalid setting key' })
    }

    const { value } = req.body
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'Value must be a boolean' })
    }

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    )

    settingsCache.set(key, value)
    lastLoadTime = Date.now()
    console.log(`[Settings] ${key} = ${value}`)
    res.json({ key, value })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' })
  }
})

// ─── Helper: check if auto-sync is enabled ───────────────────

export function isAutoSyncEnabled(type: 'resumes' | 'jds'): boolean {
  const key = type === 'resumes' ? 'auto_sync_resumes' : 'auto_sync_jds'
  return settingsCache.get(key) ?? true
}

// ─── PDL Quota Status ────────────────────────────────────────

settingsRouter.get('/pdl-quota', async (_req: Request, res: Response) => {
  try {
    res.json(getPdlQuotaStatus())
  } catch (error) {
    res.status(500).json({ error: 'Failed to get PDL quota status' })
  }
})

// ─── Reset PDL Quota ─────────────────────────────────────────

settingsRouter.post('/pdl-quota/reset', async (_req: Request, res: Response) => {
  try {
    resetPdlQuota()
    res.json({ message: 'PDL quota exhaustion cleared. Next search will attempt PDL again.' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset PDL quota' })
  }
})
