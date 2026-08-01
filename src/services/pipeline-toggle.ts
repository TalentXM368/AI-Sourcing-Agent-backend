import { pool } from '../db/index.js';

export type MatchingMode = 'legacy' | 'new' | 'hybrid';

const MATCHING_MODE_KEY = 'matching_mode';
let cachedMode: MatchingMode | null = null;

export function getMatchingMode(): MatchingMode {
  return cachedMode || (process.env.MATCHING_MODE as MatchingMode) || 'legacy';
}

export async function loadMatchingModeFromDB(): Promise<MatchingMode> {
  try {
    const result = await pool.query(
      `SELECT value FROM settings WHERE key = $1`,
      [MATCHING_MODE_KEY],
    );
    if (result.rows.length > 0) {
      const value = result.rows[0].value;
      if (value === 'legacy' || value === 'new' || value === 'hybrid') {
        cachedMode = value;
        return value;
      }
    }
  } catch {
    // settings table may not exist yet
  }
  cachedMode = (process.env.MATCHING_MODE as MatchingMode) || 'legacy';
  return cachedMode;
}

export async function setMatchingMode(mode: MatchingMode): Promise<void> {
  cachedMode = mode;
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [MATCHING_MODE_KEY, mode],
    );
  } catch {
    console.error('[PipelineToggle] Failed to persist matching mode to DB');
  }
}
