import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import type { WorkHistoryEntry } from '../../types.js';
import { MAX_CONTENT_LINE_SPREAD, TRUST_RULE_VERSION } from './constants.js';
import { IdentityIndex, identityKeys } from './engine/identity-index.js';
import { contentLineHashes, extractClaimedYears } from './utils/normalize.js';
import { findTemplatePhrases } from './utils/placeholders.js';
import type { CandidateTrustResult, TrustCandidate, TrustSection } from './types.js';

export type TrustTrigger = 'saved' | 'upload' | 'manual' | 'nightly';

interface CandidateRow {
  id: string;
  organization_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  location: string | null;
  work_history: unknown;
  data_quality_score: number | null;
  text_hash: string | null;
  raw_text: string | null;
  parse_status: string;
  updated_at: Date;
}

function asWorkHistory(v: unknown): WorkHistoryEntry[] {
  return Array.isArray(v) ? (v.filter(x => x && typeof x === 'object') as WorkHistoryEntry[]) : [];
}

export function toTrustCandidate(row: Omit<CandidateRow, 'parse_status' | 'updated_at'>): TrustCandidate {
  const workHistory = asWorkHistory(row.work_history);
  const lines: string[] = [];
  for (const w of workHistory) {
    if (w.description) lines.push(...w.description.split(/(?<=[.!?])\s+/));
    if (Array.isArray(w.achievements)) lines.push(...w.achievements.filter(a => typeof a === 'string'));
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    location: row.location,
    workHistory,
    dataQualityScore: row.data_quality_score,
    textHash: row.text_hash,
    claimedYears: extractClaimedYears(row.raw_text),
    contentHashes: contentLineHashes(lines),
    templatePhrases: findTemplatePhrases([row.raw_text ?? '', ...lines].join('\n')),
  };
}

const CANDIDATE_COLUMNS = `
  id, organization_id, name, email, phone, linkedin_url, github_url, location, work_history, data_quality_score,
  parse_status, updated_at,
  CASE WHEN length(coalesce(raw_text, '')) >= 200 THEN md5(raw_text) END AS text_hash,
  left(raw_text, 6000) AS raw_text`;

/** All comparison keys of one candidate, as (kind, value) rows for candidate_fingerprints. */
export function fingerprintRows(c: TrustCandidate): Array<{ kind: string; value: string }> {
  const rows = Object.entries(identityKeys(c)).map(([kind, value]) => ({ kind, value: value as string }));
  for (const h of c.contentHashes) rows.push({ kind: 'line', value: h });
  return rows;
}

export async function loadCandidates(pool: Pool, ids: string[]): Promise<CandidateRow[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<CandidateRow>(`SELECT ${CANDIDATE_COLUMNS} FROM candidates WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

/** Replaces the stored fingerprints of these (parsed) candidates. */
export async function writeFingerprints(pool: Pool, rows: CandidateRow[]): Promise<void> {
  const parsed = rows.filter(r => r.parse_status === 'completed');
  if (!parsed.length) return;
  const ids: string[] = [];
  const orgs: Array<string | null> = [];
  const kinds: string[] = [];
  const values: string[] = [];
  for (const r of parsed) {
    for (const f of fingerprintRows(toTrustCandidate(r))) {
      ids.push(r.id); orgs.push(r.organization_id); kinds.push(f.kind); values.push(f.value);
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM candidate_fingerprints WHERE candidate_id = ANY($1::uuid[])`, [parsed.map(r => r.id)]);
    if (ids.length) {
      await client.query(
        `INSERT INTO candidate_fingerprints (candidate_id, organization_id, kind, value)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
         ON CONFLICT DO NOTHING`,
        [ids, orgs, kinds, values],
      );
    }
    await client.query(
      `INSERT INTO candidate_fingerprint_state (candidate_id, source_updated_at, fingerprinted_at)
       SELECT * , NOW() FROM unnest($1::uuid[], $2::timestamptz[])
       ON CONFLICT (candidate_id) DO UPDATE SET source_updated_at = EXCLUDED.source_updated_at, fingerprinted_at = NOW()`,
      [parsed.map(r => r.id), parsed.map(r => r.updated_at)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fingerprints parsed candidates that are new or changed since they were last
 * fingerprinted. Returns how many were refreshed. `limit` caps the work per call.
 */
export async function refreshStaleFingerprints(pool: Pool, opts: { limit?: number; pageSize?: number; onProgress?: (n: number) => void } = {}): Promise<number> {
  const limit = opts.limit ?? Infinity;
  const pageSize = opts.pageSize ?? 500;
  let done = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (done < limit) {
    const { rows: stale } = await pool.query<{ id: string }>(
      `SELECT c.id FROM candidates c
       LEFT JOIN candidate_fingerprint_state s ON s.candidate_id = c.id
       WHERE c.parse_status = 'completed' AND c.id > $1
         AND (s.candidate_id IS NULL OR s.source_updated_at < c.updated_at)
       ORDER BY c.id LIMIT $2`,
      [lastId, Math.min(pageSize, limit - done)],
    );
    if (!stale.length) break;
    await writeFingerprints(pool, await loadCandidates(pool, stale.map(r => r.id)));
    done += stale.length;
    lastId = stale[stale.length - 1].id;
    opts.onProgress?.(done);
  }
  return done;
}

/** Caps how many comparison candidates one check may pull in (a vendor email can match hundreds). */
const MAX_RELATED = 3000;

/**
 * Builds an index holding the targets plus every candidate that shares any
 * fingerprint with them, using the fingerprint table instead of loading the
 * whole database.
 */
export async function buildLocalIndex(pool: Pool, targets: TrustCandidate[]): Promise<IdentityIndex> {
  const index = new IdentityIndex();
  targets.forEach(t => index.add(t));
  const targetIds = targets.map(t => t.id);

  // Database-wide counts for each target content line (to skip boilerplate).
  const lineHashes = [...new Set(targets.flatMap(t => t.contentHashes))];
  const usefulLines = new Set<string>();
  if (lineHashes.length) {
    const { rows } = await pool.query<{ value: string; organization_id: string | null; n: number }>(
      `SELECT value, organization_id, count(*)::int AS n FROM candidate_fingerprints
       WHERE kind = 'line' AND value = ANY($1::text[]) GROUP BY value, organization_id`,
      [lineHashes],
    );
    for (const r of rows) {
      index.setLineSpread(r.organization_id, r.value, r.n);
      if (r.n >= 2 && r.n <= MAX_CONTENT_LINE_SPREAD) usefulLines.add(`${r.organization_id ?? '-'}|${r.value}`);
    }
  }

  // Every (org, kind, value) key of the targets worth looking up.
  const orgs: Array<string | null> = [];
  const kinds: string[] = [];
  const values: string[] = [];
  for (const t of targets) {
    for (const f of fingerprintRows(t)) {
      if (f.kind === 'line' && !usefulLines.has(`${t.organizationId ?? '-'}|${f.value}`)) continue;
      orgs.push(t.organizationId); kinds.push(f.kind); values.push(f.value);
    }
  }
  if (!kinds.length) return index;

  const { rows: related } = await pool.query<{ candidate_id: string }>(
    `SELECT DISTINCT f.candidate_id
     FROM unnest($1::uuid[], $2::text[], $3::text[]) AS k(org, kind, value)
     JOIN candidate_fingerprints f
       ON f.kind = k.kind AND f.value = k.value AND f.organization_id IS NOT DISTINCT FROM k.org
     WHERE NOT (f.candidate_id = ANY($4::uuid[]))
     LIMIT $5`,
    [orgs, kinds, values, targetIds, MAX_RELATED],
  );
  const rows = await loadCandidates(pool, related.map(r => r.candidate_id));
  for (const r of rows) if (r.parse_status === 'completed') index.add(toTrustCandidate(r));
  return index;
}

/** Full in-memory index of every parsed candidate (audit/analysis only). */
export async function buildFullIndex(pool: Pool, opts: { pageSize?: number; onProgress?: (n: number) => void } = {}): Promise<IdentityIndex> {
  const index = new IdentityIndex();
  const pageSize = opts.pageSize ?? 500;
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { rows } = await pool.query<CandidateRow>(
      `SELECT ${CANDIDATE_COLUMNS} FROM candidates WHERE parse_status = 'completed' AND id > $1 ORDER BY id LIMIT $2`,
      [lastId, pageSize],
    );
    if (!rows.length) break;
    for (const row of rows) index.add(toTrustCandidate(row));
    lastId = rows[rows.length - 1].id;
    opts.onProgress?.(index.size);
  }
  return index;
}

/** Adds candidates to the Trust Check queue (keeps the first trigger if already there). */
export async function enrollCandidates(
  pool: Pool, candidateIds: string[], trigger: Exclude<TrustTrigger, 'nightly'>, requestedBy: string | null,
): Promise<void> {
  if (!candidateIds.length) return;
  await pool.query(
    `INSERT INTO trust_candidates (candidate_id, organization_id, first_trigger, requested_by)
     SELECT c.id, c.organization_id, $2, $3 FROM candidates c WHERE c.id = ANY($1::uuid[])
     ON CONFLICT (candidate_id) DO NOTHING`,
    [candidateIds, trigger, requestedBy],
  );
}

export async function startRun(pool: Pool, trigger: TrustTrigger, sections: TrustSection[], startedBy?: string | null): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO trust_runs (id, trigger, sections, rule_version, started_by) VALUES ($1, $2, $3, $4, $5)`,
    [id, trigger, sections, TRUST_RULE_VERSION, startedBy ?? null],
  );
  return id;
}

export async function finishRun(
  pool: Pool, runId: string,
  result: { status: 'completed' | 'failed'; candidatesChecked: number; signalsFound: number; summary: unknown; error?: string },
): Promise<void> {
  await pool.query(
    `UPDATE trust_runs SET status = $2, candidates_checked = $3, signals_found = $4, summary = $5,
       error_message = $6, completed_at = NOW() WHERE id = $1`,
    [runId, result.status, result.candidatesChecked, result.signalsFound, JSON.stringify(result.summary), result.error ?? null],
  );
}

/**
 * Saves results. Each finding is upserted by (candidate, fingerprint), so a
 * recruiter's review survives re-runs. Open findings for the checked sections
 * that this run no longer produces are marked 'resolved' (never deleted).
 */
export async function saveResults(
  pool: Pool, runId: string, results: CandidateTrustResult[], orgOf: (id: string) => string | null, comparedAgainst?: number,
): Promise<void> {
  if (!results.length) return;
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      for (const s of r.signals) {
        await client.query(
          `INSERT INTO trust_signals (
             id, run_id, candidate_id, organization_id, section, signal_type, severity, engine, rule_version,
             fingerprint, title, explanation, evidence, related_candidate_ids, status, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'rule', $8, $9, $10, $11, $12, $13, 'open', NOW())
           ON CONFLICT (candidate_id, fingerprint) DO UPDATE SET
             run_id = EXCLUDED.run_id, severity = EXCLUDED.severity, rule_version = EXCLUDED.rule_version,
             title = EXCLUDED.title, explanation = EXCLUDED.explanation, evidence = EXCLUDED.evidence,
             related_candidate_ids = EXCLUDED.related_candidate_ids, status = 'open',
             last_seen_at = NOW(), updated_at = NOW()`,
          [randomUUID(), runId, r.candidateId, orgOf(r.candidateId), s.section, s.signalType, s.severity,
            TRUST_RULE_VERSION, s.fingerprint, s.title, s.explanation, JSON.stringify(s.evidence), s.relatedCandidateIds],
        );
      }
      await client.query(
        `UPDATE trust_signals SET status = 'resolved', updated_at = NOW()
         WHERE candidate_id = $1 AND status = 'open' AND engine = 'rule'
           AND section = ANY($2) AND NOT (fingerprint = ANY($3))`,
        [r.candidateId, r.sections, r.signals.map(s => s.fingerprint)],
      );
      await client.query(
        `UPDATE trust_candidates SET checklist = $2, compared_against = $3 WHERE candidate_id = $1`,
        [r.candidateId, JSON.stringify(r.checklist), comparedAgainst ?? null],
      );
    }
    // Refresh the queue's per-candidate counts (dismissed / false-positive signals don't count).
    await client.query(
      `UPDATE trust_candidates tc SET
         status = 'checked', last_run_id = $2, last_checked_at = NOW(), updated_at = NOW(),
         open_high = coalesce(s.high, 0), open_medium = coalesce(s.medium, 0),
         open_low = coalesce(s.low, 0), open_info = coalesce(s.info, 0)
       FROM (SELECT x.id,
               count(*) FILTER (WHERE ts.severity = 'high') AS high,
               count(*) FILTER (WHERE ts.severity = 'medium') AS medium,
               count(*) FILTER (WHERE ts.severity = 'low') AS low,
               count(*) FILTER (WHERE ts.severity = 'info') AS info
             FROM unnest($1::uuid[]) AS x(id)
             LEFT JOIN trust_signals ts ON ts.candidate_id = x.id AND ts.status = 'open'
               AND ts.review_status NOT IN ('dismissed', 'false_positive')
             GROUP BY x.id) s
       WHERE tc.candidate_id = s.id`,
      [results.map(r => r.candidateId), runId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markCandidates(pool: Pool, candidateIds: string[], status: 'not_parsed' | 'failed'): Promise<void> {
  if (!candidateIds.length) return;
  await pool.query(
    `UPDATE trust_candidates SET status = $2, updated_at = NOW() WHERE candidate_id = ANY($1::uuid[])`,
    [candidateIds, status],
  );
}
