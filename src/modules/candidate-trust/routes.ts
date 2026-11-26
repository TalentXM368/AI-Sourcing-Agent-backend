import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../../db/index.js';
import { MAX_CHECK_BATCH, runTrustCheck } from './service.js';

/** Mounted at /api/trust. */
export const trustRouter = Router();

const REVIEW_STATUSES = ['unreviewed', 'accepted', 'dismissed', 'false_positive', 'needs_info'] as const;

/** Keeps only candidate ids that belong to the caller's organization. */
async function scopeToOrg(req: Request, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM candidates WHERE id = ANY($1::uuid[])
       AND (organization_id IS NOT DISTINCT FROM $2::uuid OR organization_id IS NULL)`,
    [ids, req.auth?.organizationId ?? null],
  );
  return rows.map(r => r.id);
}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.errors });
    return;
  }
  const msg = String(err);
  if (/relation "(trust_|candidate_fingerprint)/.test(msg)) {
    res.status(503).json({ error: 'Trust Check is not set up yet (database tables missing).' });
    return;
  }
  console.error(`[trust] ${what} failed:`, err);
  res.status(500).json({ error: `Failed to ${what}` });
}

// ─── POST /api/trust/check  { candidate_ids } ──────────────────
const CheckSchema = z.object({ candidate_ids: z.array(z.string().uuid()).min(1).max(MAX_CHECK_BATCH) });

trustRouter.post('/check', async (req: Request, res: Response) => {
  try {
    const { candidate_ids } = CheckSchema.parse(req.body);
    const ids = await scopeToOrg(req, candidate_ids);
    if (!ids.length) { res.status(404).json({ error: 'No matching candidates' }); return; }
    res.json(await runTrustCheck(pool, ids, { trigger: 'manual', requestedBy: req.auth?.id }));
  } catch (err) { handleError(res, err, 'run trust check'); }
});

// ─── POST /api/trust/projects/:projectId/check ─────────────────
trustRouter.post('/projects/:projectId/check', async (req: Request, res: Response) => {
  try {
    const projectId = z.string().uuid().parse(req.params.projectId);
    const { rows } = await pool.query<{ candidate_id: string }>(
      `SELECT candidate_id FROM project_candidates WHERE project_id = $1 LIMIT $2`, [projectId, MAX_CHECK_BATCH],
    );
    const ids = await scopeToOrg(req, rows.map(r => r.candidate_id));
    if (!ids.length) { res.status(404).json({ error: 'No candidates in this project' }); return; }
    res.json(await runTrustCheck(pool, ids, { trigger: 'saved', requestedBy: req.auth?.id }));
  } catch (err) { handleError(res, err, 'check project candidates'); }
});

// ─── GET /api/trust/candidates  (the Trust Check queue) ────────
const QueueQuery = z.object({
  severity: z.enum(['high', 'medium', 'low', 'any']).optional().default('any'),
  trigger: z.enum(['saved', 'upload', 'manual']).optional(),
  ids: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

trustRouter.get('/candidates', async (req: Request, res: Response) => {
  try {
    const q = QueueQuery.parse(req.query);
    const where: string[] = ['(tc.organization_id IS NOT DISTINCT FROM $1::uuid OR tc.organization_id IS NULL)'];
    const params: unknown[] = [req.auth?.organizationId ?? null];
    if (q.severity === 'high') where.push('tc.open_high > 0');
    if (q.severity === 'medium') where.push('(tc.open_high + tc.open_medium) > 0');
    if (q.severity === 'low') where.push('(tc.open_high + tc.open_medium + tc.open_low) > 0');
    if (q.trigger) { params.push(q.trigger); where.push(`tc.first_trigger = $${params.length}`); }
    if (q.ids) { params.push(q.ids.split(',').filter(Boolean)); where.push(`tc.candidate_id = ANY($${params.length}::uuid[])`); }
    params.push(q.limit, q.offset);
    const { rows } = await pool.query(
      `SELECT tc.candidate_id AS id, c.name, c.headline, c.location, c.email, c.parse_status,
              tc.first_trigger AS trigger, tc.status, tc.last_checked_at, tc.created_at,
              tc.open_high, tc.open_medium, tc.open_low, tc.open_info,
              jsonb_array_length(tc.checklist) AS checks_total,
              (SELECT count(*)::int FROM jsonb_array_elements(tc.checklist) e WHERE e->>'status' = 'skipped') AS checks_skipped,
              c.data_quality_score,
              count(*) OVER() AS total
       FROM trust_candidates tc JOIN candidates c ON c.id = tc.candidate_id
       WHERE ${where.join(' AND ')}
       ORDER BY tc.open_high DESC, tc.open_medium DESC, tc.open_low DESC, tc.last_checked_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ total: Number(rows[0]?.total ?? 0), candidates: rows.map(({ total: _t, ...r }) => r) });
  } catch (err) { handleError(res, err, 'load trust queue'); }
});

// ─── GET /api/trust/candidates/:id  (signals for one candidate) ─
trustRouter.get('/candidates/:id', async (req: Request, res: Response) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    if (!(await scopeToOrg(req, [id])).length) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const [status, signals] = await Promise.all([
      pool.query(`SELECT first_trigger AS trigger, status, last_checked_at, open_high, open_medium, open_low, open_info,
                         checklist, compared_against
                  FROM trust_candidates WHERE candidate_id = $1`, [id]),
      pool.query(
        `SELECT s.id, s.section, s.signal_type, s.severity, s.engine, s.title, s.explanation, s.evidence,
                s.related_candidate_ids, s.status, s.review_status, s.review_notes, s.reviewed_at,
                trim(concat_ws(' ', u.first_name, u.last_name)) AS reviewer_name, s.first_seen_at, s.last_seen_at
         FROM trust_signals s LEFT JOIN users u ON u.id = s.reviewer_id
         WHERE s.candidate_id = $1
         ORDER BY (s.status = 'open') DESC,
                  array_position(ARRAY['high','medium','low','info'], s.severity), s.last_seen_at DESC`,
        [id],
      ),
    ]);
    res.json({ candidateId: id, tracking: status.rows[0] ?? null, signals: signals.rows });
  } catch (err) { handleError(res, err, 'load trust signals'); }
});

// ─── PATCH /api/trust/signals/:id  { review_status, notes } ────
const ReviewSchema = z.object({ review_status: z.enum(REVIEW_STATUSES), notes: z.string().max(2000).optional() });

trustRouter.patch('/signals/:id', async (req: Request, res: Response) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = ReviewSchema.parse(req.body);
    const { rows } = await pool.query(
      `UPDATE trust_signals SET review_status = $2, review_notes = $3, reviewer_id = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND (organization_id IS NOT DISTINCT FROM $5::uuid OR organization_id IS NULL)
       RETURNING id, candidate_id, review_status, review_notes, reviewed_at`,
      [id, body.review_status, body.notes ?? null, req.auth?.id ?? null, req.auth?.organizationId ?? null],
    );
    if (!rows.length) { res.status(404).json({ error: 'Signal not found' }); return; }
    // Dismissed / false-positive signals stop counting toward the queue badges.
    await pool.query(
      `UPDATE trust_candidates tc SET updated_at = NOW(),
         open_high = s.high, open_medium = s.medium, open_low = s.low, open_info = s.info
       FROM (SELECT count(*) FILTER (WHERE severity = 'high') AS high, count(*) FILTER (WHERE severity = 'medium') AS medium,
                    count(*) FILTER (WHERE severity = 'low') AS low, count(*) FILTER (WHERE severity = 'info') AS info
             FROM trust_signals WHERE candidate_id = $1 AND status = 'open'
               AND review_status NOT IN ('dismissed', 'false_positive')) s
       WHERE tc.candidate_id = $1`,
      [rows[0].candidate_id],
    );
    res.json(rows[0]);
  } catch (err) { handleError(res, err, 'save review'); }
});
