import { Router, Request, Response } from 'express'
import { db, pool } from '../db/index.js'

export const settingsRouter = Router()

// In-memory cache (fast reads, reset on server restart)
const settingsCache = new Map<string, boolean>()

async function loadSettings() {
  const rows = await pool.query('SELECT key, value FROM settings')
  for (const row of rows.rows) {
    settingsCache.set(row.key, row.value === true || row.value === 'true')
  }
}

// Load on startup
loadSettings().catch(() => {})

// ─── Get All Settings ────────────────────────────────────────

settingsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    await loadSettings()
    res.json({
      auto_sync_resumes: settingsCache.get('auto_sync_resumes') ?? true,
      auto_sync_jds: settingsCache.get('auto_sync_jds') ?? true,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
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
    res.status(500).json({ error: String(error) })
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
    console.log(`[Settings] ${key} = ${value}`)
    res.json({ key, value })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Helper: check if auto-sync is enabled ───────────────────

export function isAutoSyncEnabled(type: 'resumes' | 'jds'): boolean {
  const key = type === 'resumes' ? 'auto_sync_resumes' : 'auto_sync_jds'
  return settingsCache.get(key) ?? false
}
