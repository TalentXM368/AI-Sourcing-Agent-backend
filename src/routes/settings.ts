import { Router, Request, Response } from 'express'
import { db, pool } from '../db/index.js'
import { getPdlQuotaStatus, resetPdlQuota } from '../services/people-data-labs.js'
import {
  PROVIDERS, ProviderId, getApiKey, saveApiKey, deleteApiKey,
  getApiKeyStatus, invalidateKeyCache,
} from '../services/api-key-store.js'
import { decryptKey } from '../services/key-encryption.js'

export const settingsRouter = Router()

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
        const status = await getApiKeyStatus(id)
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
    const status = await getApiKeyStatus(provider as ProviderId)
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
    await saveApiKey(provider as ProviderId, key.trim())
    invalidateKeyCache()
    const status = await getApiKeyStatus(provider as ProviderId)
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
    await deleteApiKey(provider as ProviderId)
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

    const key = await getApiKey(provider as ProviderId)
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
        const username = provider === 'kaggle_username' ? key : await getApiKey('kaggle_username')
        const kaggleKey = provider === 'kaggle_key' ? key : await getApiKey('kaggle_key')
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
