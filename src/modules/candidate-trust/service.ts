import type { Pool } from 'pg';
import { evaluateCandidate } from './engine/run-checks.js';
import {
  buildLocalIndex, enrollCandidates, finishRun, loadCandidates, markCandidates, refreshStaleFingerprints,
  saveResults, startRun, toTrustCandidate, writeFingerprints, type TrustTrigger,
} from './repository.js';
import type { TrustSection } from './types.js';

export interface TrustCheckSummary {
  runId: string;
  checked: number;
  notParsed: string[];
  signals: number;
  bySeverity: Record<'high' | 'medium' | 'low' | 'info', number>;
}

/** Max candidates per check call; larger sets are split by the caller. */
export const MAX_CHECK_BATCH = 200;

/**
 * Checks the given candidates (and only those). Other candidates are used as
 * comparison data but get no signals. Candidates still being parsed are queued
 * as 'not_parsed' and checked once parsing finishes or on the nightly re-check.
 */
export async function runTrustCheck(
  pool: Pool,
  candidateIds: string[],
  opts: { trigger: TrustTrigger; requestedBy?: string | null; sections?: TrustSection[]; enroll?: boolean } = { trigger: 'manual' },
): Promise<TrustCheckSummary> {
  const ids = [...new Set(candidateIds)].slice(0, MAX_CHECK_BATCH);
  const sections = opts.sections ?? ['fake', 'resume'];
  if (opts.enroll !== false && opts.trigger !== 'nightly') {
    await enrollCandidates(pool, ids, opts.trigger, opts.requestedBy ?? null);
  }

  // Catch up on a few candidates imported since the last refresh, so new resumes are compared too.
  // (The nightly script refreshes everything; this only covers the gap during the day.)
  await refreshStaleFingerprints(pool, { limit: 300 });

  const rows = await loadCandidates(pool, ids);
  const parsed = rows.filter(r => r.parse_status === 'completed');
  const notParsed = ids.filter(id => !parsed.some(r => r.id === id));
  await markCandidates(pool, notParsed, 'not_parsed');
  await writeFingerprints(pool, parsed);

  const runId = await startRun(pool, opts.trigger, sections, opts.requestedBy);
  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  let signals = 0;
  try {
    const targets = parsed.map(toTrustCandidate);
    const index = await buildLocalIndex(pool, targets);
    const { rows: [{ n }] } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM candidate_fingerprint_state`);
    const comparedAgainst = Math.max(n, index.size);
    const results = targets.map(t => evaluateCandidate(t, index, sections, new Date(), comparedAgainst));
    for (const r of results) for (const s of r.signals) { signals++; bySeverity[s.severity]++; }
    await saveResults(pool, runId, results, id => index.get(id)?.organizationId ?? null, comparedAgainst);
    await finishRun(pool, runId, { status: 'completed', candidatesChecked: results.length, signalsFound: signals, summary: { bySeverity, notParsed: notParsed.length } });
  } catch (err) {
    await finishRun(pool, runId, { status: 'failed', candidatesChecked: 0, signalsFound: 0, summary: {}, error: String(err) });
    await markCandidates(pool, parsed.map(r => r.id), 'failed');
    throw err;
  }
  return { runId, checked: parsed.length, notParsed, signals, bySeverity };
}

/**
 * For other features (saving to a project, uploads): check these candidates
 * without ever failing the caller. Returns null when the check could not run.
 */
export async function trustCheckSafely(
  pool: Pool, candidateIds: string[], trigger: 'saved' | 'upload', requestedBy?: string | null,
): Promise<TrustCheckSummary | null> {
  if (!candidateIds.length || process.env.TRUST_CHECK_ENABLED === 'false') return null;
  try {
    let last: TrustCheckSummary | null = null;
    for (let i = 0; i < candidateIds.length; i += MAX_CHECK_BATCH) {
      last = await runTrustCheck(pool, candidateIds.slice(i, i + MAX_CHECK_BATCH), { trigger, requestedBy });
    }
    return last;
  } catch (err) {
    console.error(`[trust] ${trigger} check failed (the ${trigger === 'saved' ? 'save' : 'upload'} itself succeeded):`, String(err).slice(0, 300));
    return null;
  }
}

/** Re-checks every candidate in the Trust Check queue (nightly), in batches. */
export async function recheckTrackedCandidates(pool: Pool, onProgress?: (done: number, total: number) => void): Promise<{ checked: number; signals: number }> {
  const { rows } = await pool.query<{ candidate_id: string }>(`SELECT candidate_id FROM trust_candidates ORDER BY created_at`);
  let checked = 0;
  let signals = 0;
  for (let i = 0; i < rows.length; i += MAX_CHECK_BATCH) {
    const batch = rows.slice(i, i + MAX_CHECK_BATCH).map(r => r.candidate_id);
    const s = await runTrustCheck(pool, batch, { trigger: 'nightly', enroll: false });
    checked += s.checked;
    signals += s.signals;
    onProgress?.(Math.min(i + MAX_CHECK_BATCH, rows.length), rows.length);
  }
  return { checked, signals };
}
