import { Router, Request, Response } from 'express'
import { db, pool } from '../db/index.js'

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
