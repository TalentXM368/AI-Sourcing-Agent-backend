import { pool } from '../db/index.js'
import { decryptKey, encryptKey, maskKey } from './key-encryption.js'

// Provider definitions: DB key → env fallback
export const PROVIDERS = {
  pdl: {
    id: 'pdl',
    name: 'People Data Labs',
    description: 'Person & company data search',
    envKeys: ['PEOPLE_DATA_LABS_API_KEY'],
    icon: 'Users',
  },
  coresignal: {
    id: 'coresignal',
    name: 'Coresignal',
    description: 'Multi-source employee profiles',
    envKeys: ['CORESIGNAL_API_KEY'],
    icon: 'UserSearch',
  },
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Developer profile search',
    envKeys: ['GITHUB_TOKEN'],
    icon: 'Github',
  },
  kaggle_username: {
    id: 'kaggle_username',
    name: 'Kaggle Username',
    description: 'Dataset & notebook search',
    envKeys: ['KAGGLE_USERNAME'],
    icon: 'Database',
  },
  kaggle_key: {
    id: 'kaggle_key',
    name: 'Kaggle API Key',
    description: 'Kaggle authentication',
    envKeys: ['KAGGLE_KEY'],
    icon: 'Key',
  },
} as const

export type ProviderId = keyof typeof PROVIDERS

// In-memory cache for API keys (30s TTL)
const keyCache = new Map<string, string | null>()
let lastLoad = 0
const CACHE_TTL = 30_000

async function loadKey(providerId: ProviderId, force = false): Promise<string | null> {
  const now = Date.now()
  const cacheKey = `api_key:${providerId}`

  if (!force && keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey) ?? null
  }

  try {
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      [cacheKey]
    )

    if (result.rows.length > 0 && result.rows[0].value) {
      const raw = result.rows[0].value
      // Skip boolean values (old toggle settings)
      if (typeof raw === 'boolean') {
        keyCache.set(cacheKey, null)
        return null
      }
      const decrypted = typeof raw === 'string' ? decryptKey(raw) : null
      keyCache.set(cacheKey, decrypted)
      return decrypted
    }

    keyCache.set(cacheKey, null)
    return null
  } catch {
    return null
  }
}

export async function getApiKey(providerId: ProviderId): Promise<string | null> {
  const dbKey = await loadKey(providerId)
  if (dbKey) return dbKey

  // Fall back to environment variables
  const provider = PROVIDERS[providerId]
  for (const envKey of provider.envKeys) {
    const val = process.env[envKey]
    if (val) return val
  }

  return null
}

export async function saveApiKey(providerId: ProviderId, plainTextKey: string): Promise<void> {
  const encrypted = encryptKey(plainTextKey)
  const dbKey = `api_key:${providerId}`

  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::json, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::json, updated_at = NOW()`,
    [dbKey, JSON.stringify(encrypted)]
  )

  keyCache.set(dbKey, plainTextKey)
}

export async function deleteApiKey(providerId: ProviderId): Promise<void> {
  const dbKey = `api_key:${providerId}`
  await pool.query('DELETE FROM settings WHERE key = $1', [dbKey])
  keyCache.delete(dbKey)
}

export async function getApiKeyStatus(providerId: ProviderId): Promise<{
  configured: boolean
  source: 'database' | 'env' | 'none'
  masked: string | null
}> {
  const dbKey = await loadKey(providerId)
  if (dbKey) {
    return { configured: true, source: 'database', masked: maskKey(dbKey) }
  }

  // Check env
  const provider = PROVIDERS[providerId]
  for (const envKey of provider.envKeys) {
    const val = process.env[envKey]
    if (val) {
      return { configured: true, source: 'env', masked: maskKey(val) }
    }
  }

  return { configured: false, source: 'none', masked: null }
}

export function invalidateKeyCache(): void {
  keyCache.clear()
  lastLoad = 0
}
