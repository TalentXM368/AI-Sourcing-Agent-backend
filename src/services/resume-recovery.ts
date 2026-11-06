import { createHash, randomUUID } from 'crypto'
import { pool } from '../db/index.js'
import { detectMimetype, extractTextFromBuffer, extractTextFromDocx, extractTextFromPdf } from '../parsers/text-extractor.js'
import { PARSER_VERSION } from '../modules/candidate-intelligence/constants/index.js'
import { runPipeline } from '../modules/candidate-intelligence/pipeline.js'
import type { StructuredDocument } from '../modules/candidate-intelligence/types/input.types.js'
import type { CandidateProfile } from '../modules/candidate-intelligence/types/profile.types.js'
import type { ParsedCandidate } from '../types.js'
import { computeDataQuality } from '../scoring/data-quality.js'
import { checkDocumentIntelligenceHealth, extractWithDocumentIntelligence } from './document-intelligence.js'
import { fetchFromCloudinary } from './cloudinary.js'
import { generateEmbeddings } from './openai.js'
import { VECTOR_CONSTANTS } from '../modules/vector-intelligence/constants/index.js'
import { QdrantManager } from '../modules/vector-intelligence/qdrant/qdrant-manager.js'
import {
  classifyRecoveryQuality,
  compareRecoveryProfiles,
  isRecoveryResultClearlyWorse,
} from './resume-recovery-rules.js'

export const RECOVERY_STAGES = ['20', '100', '300', 'remaining'] as const
export type RecoveryStage = typeof RECOVERY_STAGES[number]

export const RECOVERY_QUALITY_THRESHOLDS = {
  success: Number(process.env.RESUME_RECOVERY_SUCCESS_SCORE || 75),
  partial: Number(process.env.RESUME_RECOVERY_PARTIAL_SCORE || 60),
  lowQuality: Number(process.env.RESUME_RECOVERY_LOW_QUALITY_SCORE || 40),
}

const RECOVERY_PARSER_VERSION = `candidate-intelligence-${PARSER_VERSION}`
const MAX_RECOVERY_CONCURRENCY = 5
const RETRY_LIMIT = 3

interface BacklogRow {
  id: string
  name: string | null
  source_file: string | null
  resume_url: string | null
  parse_status: string
  parse_error: string | null
  data_quality_score: number | null
  created_at: Date
  updated_at: Date
}

interface RecoveryRun {
  id: string
  batch_id: string
  resume_id: string
  attempt_count: number
}

interface RecoveryBatch {
  id: string
  stage: RecoveryStage
  status: string
  concurrency: number
}

type Extraction = {
  text: string
  method: string
  fileHash: string
  filename: string
  fileSize: number
  mimeType: string
  sections: StructuredDocument['sections']
  tables: NonNullable<StructuredDocument['tables']>
  images: NonNullable<StructuredDocument['images']>
  pages: number
}

function numberEnv(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100
}

if (
  !numberEnv(RECOVERY_QUALITY_THRESHOLDS.success)
  || !numberEnv(RECOVERY_QUALITY_THRESHOLDS.partial)
  || !numberEnv(RECOVERY_QUALITY_THRESHOLDS.lowQuality)
  || RECOVERY_QUALITY_THRESHOLDS.success < RECOVERY_QUALITY_THRESHOLDS.partial
  || RECOVERY_QUALITY_THRESHOLDS.partial < RECOVERY_QUALITY_THRESHOLDS.lowQuality
) {
  throw new Error('Resume recovery score thresholds must be ordered integer values from 0 to 100')
}

function backlogPredicate(alias = 'c'): string {
  return `(
    LOWER(COALESCE(${alias}.parse_status, '')) NOT IN ('completed', 'success')
    OR COALESCE(${alias}.data_quality_score, 0) < ${RECOVERY_QUALITY_THRESHOLDS.success}
    OR (
      COALESCE(${alias}.email, '') = ''
      AND COALESCE(${alias}.phone, '') = ''
      AND COALESCE(${alias}.headline, '') = ''
      AND COALESCE(${alias}.summary, '') = ''
      AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(${alias}.skills) = 'array' THEN ${alias}.skills ELSE '[]'::jsonb END), 0) = 0
      AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(${alias}.work_history) = 'array' THEN ${alias}.work_history ELSE '[]'::jsonb END), 0) = 0
      AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(${alias}.education) = 'array' THEN ${alias}.education ELSE '[]'::jsonb END), 0) = 0
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM resume_parse_runs prior
    WHERE prior.resume_id = ${alias}.id
      AND prior.parser_version = '${RECOVERY_PARSER_VERSION.replace(/'/g, "''")}'
      AND prior.status IN ('success', 'partial')
      AND prior.completed_at IS NOT NULL
      AND prior.completed_at >= ${alias}.updated_at
      AND NULLIF(prior.old_profile->>'source_file', '') IS NOT DISTINCT FROM NULLIF(${alias}.source_file, '')
      AND NULLIF(prior.old_profile->>'resume_url', '') IS NOT DISTINCT FROM NULLIF(${alias}.resume_url, '')
  )`
}

const RESUME_SCOPE = `(COALESCE(c.source, 'resume') = 'resume' OR c.resume_url IS NOT NULL)`

export async function getRecoveryReport() {
  const predicate = backlogPredicate()
  const [counts, backlog] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE})::int AS total_resumes,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND LOWER(COALESCE(c.parse_status, '')) LIKE '%fail%')::int AS failed,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND (
           LOWER(COALESCE(c.parse_status, '')) LIKE '%pending%'
           OR LOWER(COALESCE(c.parse_status, '')) = 'queued'
         ))::int AS pending,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND (
           LOWER(COALESCE(c.parse_status, '')) LIKE '%stuck%'
           OR (LOWER(COALESCE(c.parse_status, '')) = 'processing' AND c.updated_at < NOW() - INTERVAL '30 minutes')
         ))::int AS stuck,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND (
           LOWER(COALESCE(c.parse_status, '')) IN ('', 'unparsed', 'empty_profile')
           OR LOWER(COALESCE(c.parse_status, '')) NOT IN (
             'completed', 'success', 'failed', 'parse_failed', 'extraction_failed',
             'pending', 'queued', 'processing', 'processing_stuck', 'stuck',
             'unparsed', 'empty_profile', 'low_quality'
           )
         ))::int AS unparsed,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND
           COALESCE(email, '') = '' AND COALESCE(phone, '') = '' AND COALESCE(headline, '') = '' AND COALESCE(summary, '') = ''
           AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(skills) = 'array' THEN skills ELSE '[]'::jsonb END), 0) = 0
           AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(work_history) = 'array' THEN work_history ELSE '[]'::jsonb END), 0) = 0
           AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(education) = 'array' THEN education ELSE '[]'::jsonb END), 0) = 0
         )::int AS empty_profile,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND COALESCE(data_quality_score, 0) < ${RECOVERY_QUALITY_THRESHOLDS.success})::int AS low_quality,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND LOWER(COALESCE(c.parse_status, '')) IN ('completed', 'success')
           AND COALESCE(data_quality_score, 0) >= ${RECOVERY_QUALITY_THRESHOLDS.success})::int AS already_successful,
         COUNT(*) FILTER (WHERE ${RESUME_SCOPE} AND ${predicate})::int AS requires_recovery
       FROM candidates c`
    ),
    pool.query<BacklogRow>(
      `SELECT c.id, c.name, c.source_file, c.resume_url, c.parse_status, c.parse_error,
              c.data_quality_score, c.created_at, c.updated_at
       FROM candidates c
       WHERE ${RESUME_SCOPE} AND ${predicate}
       ORDER BY
         CASE WHEN LOWER(COALESCE(c.parse_status, '')) LIKE '%fail%' THEN 0
              WHEN LOWER(COALESCE(c.parse_status, '')) = 'pending' THEN 1
              WHEN LOWER(COALESCE(c.parse_status, '')) = 'processing' THEN 2
              ELSE 3 END,
         c.created_at ASC
       LIMIT 1000`
    ),
  ])

  const latest = await pool.query<RecoveryBatch>(
    `SELECT id, stage, status, concurrency FROM resume_recovery_batches ORDER BY created_at DESC LIMIT 1`
  )
  const active = await pool.query(
    `SELECT id, stage, status, started_at, completed_at, summary
     FROM resume_recovery_batches
     ORDER BY created_at DESC LIMIT 10`
  )
  const countsRow = counts.rows[0] || {}

  return {
    counts: countsRow,
    thresholds: RECOVERY_QUALITY_THRESHOLDS,
    parser_version: RECOVERY_PARSER_VERSION,
    backlog: backlog.rows.map(row => ({ ...row, old_parser_version: null })),
    backlog_truncated: Number(countsRow.requires_recovery || 0) > backlog.rows.length,
    next_stage: await getNextRecoveryStage(latest.rows[0]),
    batches: active.rows,
  }
}

export async function getRecoveryBacklogForCsv(): Promise<BacklogRow[]> {
  const predicate = backlogPredicate()
  const { rows } = await pool.query<BacklogRow>(
    `SELECT c.id, c.name, c.source_file, c.resume_url, c.parse_status, c.parse_error,
            c.data_quality_score, c.created_at, c.updated_at
     FROM candidates c
     WHERE ${RESUME_SCOPE} AND ${predicate}
     ORDER BY c.created_at ASC`
  )
  return rows
}

async function getNextRecoveryStage(latest?: RecoveryBatch): Promise<RecoveryStage | null> {
  const result = await pool.query<RecoveryBatch>(
    `SELECT id, stage, status, concurrency
     FROM resume_recovery_batches
     WHERE status <> 'stopped'
     ORDER BY created_at DESC LIMIT 1`
  )
  const previous = result.rows[0]
  if (!previous) return '20'
  if (previous.status === 'running' || previous.status === 'review_required') return null
  if (previous.status === 'failed') return previous.stage
  if (previous.status === 'completed') return null
  if (previous.status === 'approved') {
    const next = RECOVERY_STAGES[RECOVERY_STAGES.indexOf(previous.stage) + 1]
    return next || null
  }
  if (latest?.status === 'stopped') return latest.stage
  return '20'
}

function getStageLimit(stage: RecoveryStage, available: number): number {
  return stage === 'remaining' ? available : Math.min(Number(stage), available)
}

export async function startRecoveryBatch(
  stage: RecoveryStage,
  concurrency: number,
  requestedBy: string,
): Promise<{ batchId: string; queued: number }> {
  if (!RECOVERY_STAGES.includes(stage)) throw new Error('Invalid recovery stage')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_RECOVERY_CONCURRENCY) {
    throw new Error(`Concurrency must be between 1 and ${MAX_RECOVERY_CONCURRENCY}`)
  }

  const expected = await getNextRecoveryStage()
  if (stage !== expected) {
    throw new Error(expected
      ? `The next allowed recovery stage is ${expected}`
      : 'Review the current batch before starting another stage')
  }

  const predicate = backlogPredicate()
  const result = await pool.query<BacklogRow>(
    `SELECT c.id, c.name, c.source_file, c.resume_url, c.parse_status, c.parse_error,
            c.data_quality_score, c.created_at, c.updated_at
     FROM candidates c
     WHERE ${RESUME_SCOPE} AND ${predicate}
     ORDER BY c.created_at ASC
     LIMIT $1`,
    [stage === 'remaining' ? 100000 : Number(stage)]
  )
  const candidates = result.rows
  if (!candidates.length) throw new Error('There are no resumes that currently meet the recovery criteria')

  const batchId = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, ['resume-recovery-stage'])
    const freshExpected = await getNextRecoveryStage()
    if (stage !== freshExpected) throw new Error('Another admin changed the recovery stage. Refresh and try again.')

    await client.query(
      `INSERT INTO resume_recovery_batches (id, stage, status, concurrency, requested_by, summary)
       VALUES ($1, $2, 'running', $3, $4, $5::jsonb)`,
      [batchId, stage, concurrency, requestedBy, JSON.stringify({ total: candidates.length, queued: candidates.length })]
    )

    for (const candidate of candidates) {
      const oldProfile = await client.query(
        `SELECT name, email, phone, linkedin_url, github_url, portfolio_url, headline, location, summary,
                experience_years, skills, companies, work_history, education, projects, certifications,
                languages, data_quality_score, parse_status, parse_error, source_file, resume_url
         FROM candidates WHERE id = $1`,
        [candidate.id]
      )
      await client.query(
        `INSERT INTO resume_parse_runs
           (id, batch_id, resume_id, parser_version, status, old_quality_score, old_profile)
         VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb)`,
        [
          randomUUID(), batchId, candidate.id, RECOVERY_PARSER_VERSION,
          oldProfile.rows[0]?.data_quality_score ?? null,
          JSON.stringify(oldProfile.rows[0] || {}),
        ]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  void executeRecoveryBatch(batchId)
  return { batchId, queued: candidates.length }
}

export async function getRecoveryBatch(batchId: string) {
  const [batch, totals, methods, runs] = await Promise.all([
    pool.query(
      `SELECT id, stage, status, concurrency, requested_by, reviewed_by, review_notes,
              reviewed_resume_ids, summary, started_at, completed_at, reviewed_at, created_at, updated_at
       FROM resume_recovery_batches WHERE id = $1`,
      [batchId]
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count, ROUND(AVG(quality_score))::int AS average_quality,
              ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000))::int AS average_ms
       FROM resume_parse_runs WHERE batch_id = $1 GROUP BY status`,
      [batchId]
    ),
    pool.query(
      `SELECT extraction_method, index_status, SUM(llm_calls)::int AS llm_calls,
              SUM(attempt_count)::int AS attempts, COUNT(*)::int AS count
       FROM resume_parse_runs WHERE batch_id = $1 GROUP BY extraction_method, index_status`,
      [batchId]
    ),
    pool.query(
      `SELECT r.id, r.resume_id, c.name, c.source_file, c.resume_url, r.status, r.quality_score,
              r.old_quality_score, r.extraction_method, r.file_hash, r.old_profile, r.new_profile,
              r.comparison, r.provenance, r.error_code, r.error_message, r.attempt_count,
              r.recommended_next_action, r.index_status, r.started_at, r.completed_at
       FROM resume_parse_runs r
       JOIN candidates c ON c.id = r.resume_id
       WHERE r.batch_id = $1
       ORDER BY
         CASE r.status WHEN 'failed' THEN 0 WHEN 'low_quality' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END,
         r.quality_score ASC NULLS FIRST, r.created_at
       LIMIT 20`,
      [batchId]
    ),
  ])
  if (!batch.rows.length) return null
  return {
    batch: batch.rows[0],
    counts: totals.rows.reduce((acc: Record<string, unknown>, row: { status: string; count: number; average_quality: number | null; average_ms: number | null }) => {
      acc[row.status] = row.count
      if (row.average_quality != null) acc.average_quality = row.average_quality
      if (row.average_ms != null) acc.average_ms = row.average_ms
      return acc
    }, {}),
    methods: methods.rows,
    review_sample: runs.rows.slice(0, 10),
  }
}

export async function reviewRecoveryBatch(
  batchId: string,
  reviewedResumeIds: string[],
  notes: string,
  reviewedBy: string,
  approved: boolean,
): Promise<void> {
  const detail = await getRecoveryBatch(batchId)
  if (!detail) throw new Error('Recovery batch not found')
  if (detail.batch.status !== 'review_required') throw new Error('This batch is not awaiting human review')
  const sampleIds = detail.review_sample.map((run: { resume_id: string }) => run.resume_id)
  const uniqueReviewed = [...new Set(reviewedResumeIds)]
  const minimumReviews = Math.min(5, sampleIds.length)
  if (uniqueReviewed.length < minimumReviews || uniqueReviewed.some(id => !sampleIds.includes(id))) {
    throw new Error(`Review at least ${minimumReviews} resumes from the displayed sample`)
  }
  if (!notes.trim()) throw new Error('Review notes are required')

  await pool.query(
    `UPDATE resume_recovery_batches
     SET status = $2, reviewed_by = $3, review_notes = $4, reviewed_resume_ids = $5::uuid[],
         reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'review_required'`,
    [batchId, approved ? 'approved' : 'stopped', reviewedBy, notes.trim(), uniqueReviewed]
  )
}

export async function stopRecoveryBatch(batchId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('A stop reason is required')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE resume_recovery_batches
       SET status = 'stopped', review_notes = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'running'
       RETURNING id`,
      [batchId, reason.trim()]
    )
    if (!result.rowCount) throw new Error('Batch is not currently running')
    await client.query(
      `UPDATE resume_parse_runs SET status = 'skipped', error_code = 'BATCH_STOPPED',
              error_message = $2, recommended_next_action = 'Review stop reason before retrying',
              updated_at = NOW(), completed_at = NOW()
       WHERE batch_id = $1 AND status = 'queued'`,
      [batchId, reason.trim()]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function resumeActiveRecoveryBatches(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM resume_recovery_batches WHERE status = 'running' ORDER BY created_at`
  )
  for (const row of rows) void executeRecoveryBatch(row.id)
}

async function executeRecoveryBatch(batchId: string): Promise<void> {
  const lockClient = await pool.connect()
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked`,
      [`resume-recovery:${batchId}`]
    )
    if (!lock.rows[0]?.locked) return

    const batchResult = await pool.query<RecoveryBatch>(
      `SELECT id, stage, status, concurrency FROM resume_recovery_batches WHERE id = $1`,
      [batchId]
    )
    const batch = batchResult.rows[0]
    if (!batch || batch.status !== 'running') return

    await pool.query(
      `UPDATE resume_parse_runs SET status = 'queued', updated_at = NOW()
       WHERE batch_id = $1 AND status = 'processing'`,
      [batchId]
    )

    const workers = Array.from({ length: Math.min(batch.concurrency, MAX_RECOVERY_CONCURRENCY) }, () => runRecoveryWorker(batchId))
    await Promise.all(workers)

    const state = await pool.query<{ status: string }>(
      `SELECT status FROM resume_recovery_batches WHERE id = $1`,
      [batchId]
    )
    if (state.rows[0]?.status !== 'running') return

    const counts = await pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM resume_parse_runs WHERE batch_id = $1 GROUP BY status`,
      [batchId]
    )
    const summary = Object.fromEntries(counts.rows.map(row => [row.status, row.count]))
    const terminal = counts.rows.every(row => ['success', 'partial', 'low_quality', 'failed', 'skipped'].includes(row.status))
    if (!terminal) throw new Error(`Recovery batch ${batchId} ended with non-terminal runs`)

    await pool.query(
      `UPDATE resume_recovery_batches
       SET status = CASE WHEN stage = 'remaining' THEN 'completed' ELSE 'review_required' END,
           summary = $2::jsonb, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [batchId, JSON.stringify({ ...summary, total: counts.rows.reduce((n, row) => n + row.count, 0) })]
    )
  } catch (error) {
    console.error(`[ResumeRecovery] Batch ${batchId} failed:`, error)
    await pool.query(
      `UPDATE resume_recovery_batches
       SET status = 'failed', summary = summary || $2::jsonb,
           completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [batchId, JSON.stringify({ fatal_error: error instanceof Error ? error.message : String(error) })]
    ).catch(dbError => console.error('[ResumeRecovery] Could not persist batch failure:', dbError))
  } finally {
    await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [`resume-recovery:${batchId}`]).catch(() => {})
    lockClient.release()
  }
}

async function runRecoveryWorker(batchId: string): Promise<void> {
  while (true) {
    const batch = await pool.query<{ status: string }>(
      `SELECT status FROM resume_recovery_batches WHERE id = $1`,
      [batchId]
    )
    if (batch.rows[0]?.status !== 'running') return

    const run = await claimRecoveryRun(batchId)
    if (!run) return
    await processRecoveryRun(run)
  }
}

async function claimRecoveryRun(batchId: string): Promise<RecoveryRun | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query<RecoveryRun>(
      `SELECT id, batch_id, resume_id, attempt_count
       FROM resume_parse_runs
       WHERE batch_id = $1 AND status = 'queued'
       ORDER BY created_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [batchId]
    )
    const run = selected.rows[0]
    if (!run) {
      await client.query('COMMIT')
      return null
    }
    await client.query(
      `UPDATE resume_parse_runs
       SET status = 'processing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [run.id]
    )
    await client.query('COMMIT')
    return run
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function processRecoveryRun(run: RecoveryRun): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    await pool.query(
      `UPDATE resume_parse_runs
       SET attempt_count = attempt_count + 1, last_attempt_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [run.id]
    )
    try {
      await processRecoveryRunOnce(run)
      return
    } catch (error) {
      lastError = error
      if (!isTransientError(error) || attempt === RETRY_LIMIT) break
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
  await recordRunFailure(run, lastError)
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|ECONN|temporar|HTTP 429|HTTP 5\d\d|fetch failed|database connection/i.test(message)
}

async function processRecoveryRunOnce(run: RecoveryRun): Promise<void> {
  const { rows } = await pool.query(
    `SELECT c.*, d.content AS stored_raw_text
     FROM candidates c
     LEFT JOIN documents d
       ON d.entity_id = c.id AND d.entity_type = 'candidate' AND d.purpose = 'raw_text'
     WHERE c.id = $1`,
    [run.resume_id]
  )
  const candidate = rows[0]
  if (!candidate) throw Object.assign(new Error('Candidate record no longer exists'), { code: 'CANDIDATE_MISSING' })

  const extraction = await extractResume(candidate)
  const duplicate = await pool.query<{ resume_id: string }>(
    `SELECT resume_id FROM resume_parse_runs
     WHERE resume_id <> $1 AND parser_version = $2 AND file_hash = $3 AND status IN ('success', 'partial')
     ORDER BY completed_at DESC LIMIT 1`,
    [run.resume_id, RECOVERY_PARSER_VERSION, extraction.fileHash]
  )
  if (duplicate.rows.length) {
    await pool.query(
      `UPDATE resume_parse_runs
       SET status = 'skipped', file_hash = $2, extraction_method = $3, last_parser_method = $4,
           recommended_next_action = $5, comparison = jsonb_build_object('duplicateResumeId', $6),
           error_code = 'DUPLICATE_FILE', error_message = $7,
           completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        run.id, extraction.fileHash, extraction.method, RECOVERY_PARSER_VERSION,
        'Review the existing parsed candidate instead of processing this duplicate file',
        duplicate.rows[0].resume_id, `Same resume file was already recovered as ${duplicate.rows[0].resume_id}`,
      ]
    )
    return
  }

  const document: StructuredDocument = {
    markdown: extraction.sections.map(section => `## ${section.name}\n${section.content}`).join('\n\n') || extraction.text,
    plainText: extraction.text,
    sections: extraction.sections.length
      ? extraction.sections
      : [{ name: 'Resume', content: extraction.text, pageNumber: 1 }],
    tables: extraction.tables,
    images: extraction.images,
    metadata: {
      pages: extraction.pages,
      fileName: extraction.filename,
      fileSize: extraction.fileSize,
      mimeType: extraction.mimeType,
    },
  }
  const profile = await runPipeline(document)
  const parsed = toParsedCandidate(profile, candidate.resume_url || candidate.source_file)
  const quality = computeDataQuality(parsed)
  const status = classifyRecoveryQuality(
    quality.quality_score,
    profile.validation.isValid,
    RECOVERY_QUALITY_THRESHOLDS,
  )
  const oldProfile = snapshotProfile(candidate)
  const newProfile = parsed
  const identityDuplicates = await findIdentityDuplicates(run.resume_id, parsed)
  const comparison = { ...compareRecoveryProfiles(oldProfile, newProfile), identityDuplicates }
  const clearlyWorse = isRecoveryResultClearlyWorse(quality.quality_score, candidate.data_quality_score, comparison)
  const canWrite = !clearlyWorse && (status === 'success' || status === 'partial')

  let indexStatus: 'not_eligible' | 'replacement_required' | 'indexed' | 'failed' = 'not_eligible'
  if (canWrite) {
    await persistCandidateProfile(run.resume_id, parsed, quality.quality_score, quality.missing_fields, extraction.text)
    if (status === 'success' && identityDuplicates.length === 0) {
      try {
        await indexValidatedProfile(run.resume_id, parsed)
        indexStatus = 'indexed'
      } catch (error) {
        indexStatus = 'failed'
        console.error(`[ResumeRecovery] Reindex failed for candidate ${run.resume_id}:`, error)
      }
    } else if (identityDuplicates.length === 0 && await hasExistingEmbedding(run.resume_id)) {
      indexStatus = 'replacement_required'
    }
  } else if (await hasExistingEmbedding(run.resume_id)) {
    indexStatus = 'replacement_required'
  }

  await pool.query(
    `UPDATE resume_parse_runs
     SET status = $2, file_hash = $3, extraction_method = $4, quality_score = $5,
         new_profile = $6::jsonb, comparison = $7::jsonb, provenance = $8::jsonb,
         last_parser_method = $9, recommended_next_action = $10, index_status = $11,
         completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [
      run.id, clearlyWorse ? 'low_quality' : status, extraction.fileHash, extraction.method,
      quality.quality_score, JSON.stringify(newProfile), JSON.stringify(comparison),
      JSON.stringify(collectProvenance(profile)), RECOVERY_PARSER_VERSION,
      clearlyWorse
        ? 'Keep the existing profile; review the field comparison before a future parser attempt'
        : identityDuplicates.length
          ? 'Review matching candidate identities before indexing this profile'
        : status === 'low_quality' || status === 'failed'
          ? 'Manual review or improved extraction is required before indexing'
          : status === 'partial'
            ? 'Review missing fields; this profile was not indexed because it is below the success threshold'
            : indexStatus === 'failed'
              ? 'Retry indexing after checking the embedding and Qdrant services'
              : 'No additional action required',
      indexStatus,
    ]
  )
}

async function extractResume(candidate: Record<string, any>): Promise<Extraction> {
  const candidateId = String(candidate.id)
  let filename = candidate.source_file || candidate.resume_url || 'resume'
  let bytes: Buffer | null = null
  const sourceUrl = candidate.resume_url || (isHttpUrl(candidate.source_file) ? candidate.source_file : null)

  if (sourceUrl) {
    if (!isTrustedCloudinaryUrl(sourceUrl)) {
      if (!candidate.stored_raw_text) {
        throw Object.assign(new Error('Resume source URL is not a trusted Cloudinary asset URL'), {
          code: 'SOURCE_URL_UNTRUSTED',
        })
      }
    } else {
      try {
        bytes = await fetchFromCloudinary(sourceUrl, publicIdFromUrl(sourceUrl))
      } catch (error) {
        if (!candidate.stored_raw_text) {
          throw Object.assign(
            new Error(`Source file is inaccessible: ${error instanceof Error ? error.message : String(error)}`),
            { code: 'SOURCE_FILE_MISSING' },
          )
        }
      }
    }
  }

  if (!bytes && !candidate.stored_raw_text) {
    throw Object.assign(new Error('Source file and stored extracted text are unavailable'), { code: 'SOURCE_FILE_MISSING' })
  }

  let text = ''
  let method = 'stored_text'
  let mimeType = 'text/plain'
  let fileSize = Buffer.byteLength(String(candidate.stored_raw_text || ''), 'utf8')
  let fileHash = ''
  let sections: Extraction['sections'] = []
  let tables: Extraction['tables'] = []
  let images: Extraction['images'] = []
  let pages = 1

  if (bytes) {
    filename = basename(filename)
    fileSize = bytes.length
    fileHash = createHash('sha256').update(bytes).digest('hex')
    mimeType = detectMimetype(filename)
    if (mimeType === 'application/octet-stream') {
      throw Object.assign(new Error(`Unsupported resume format: ${filename}`), { code: 'UNSUPPORTED_FORMAT' })
    }

    if (mimeType === 'application/pdf' && await checkDocumentIntelligenceHealth()) {
      try {
        const parsed = await extractWithDocumentIntelligence(bytes, mimeType, filename)
        if (parsed.text.trim().length >= 50) {
          text = parsed.text
          sections = parsed.sections.map(section => ({
            name: section.name,
            content: section.content,
            level: section.level ?? undefined,
          }))
          tables = parsed.tables.map(table => ({ markdown: table.markdown }))
          images = []
          pages = parsed.metadata.pageCount
          method = parsed.quality.needsOcr || parsed.quality.isScanned ? 'document-intelligence-ocr' : 'document-intelligence'
        }
      } catch (error) {
        console.warn(`[ResumeRecovery] Document Intelligence fallback for ${candidateId}:`, error)
      }
    }

    if (!text) {
      try {
        if (mimeType === 'application/pdf') {
          text = await extractTextFromPdf(bytes)
          method = 'pdf-parse'
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          text = await extractTextFromDocx(bytes)
          method = 'mammoth'
        } else {
          text = await extractTextFromBuffer(bytes, mimeType)
          method = 'native-text'
        }
      } catch (error) {
        throw Object.assign(
          new Error(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`),
          { code: 'EXTRACTION_FAILED' },
        )
      }
    }
  } else {
    text = String(candidate.stored_raw_text)
    fileHash = createHash('sha256').update(text, 'utf8').digest('hex')
    filename = basename(filename)
  }

  if (text.trim().length < 50) {
    throw Object.assign(new Error(`Extracted text is too short (${text.trim().length} characters)`), { code: 'EXTRACTION_FAILED' })
  }

  return { text, method, fileHash, filename, fileSize, mimeType, sections, tables, images, pages }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isTrustedCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'cloudinary.com' || url.hostname.endsWith('.cloudinary.com'))
  } catch {
    return false
  }
}

function publicIdFromUrl(value: string): string | undefined {
  return value.match(/\/upload\/(?:v\d+\/)?(.+)$/)?.[1]
}

async function findIdentityDuplicates(candidateId: string, parsed: ParsedCandidate): Promise<Array<{ id: string; name: string; signals: string[] }>> {
  const email = parsed.email?.trim().toLowerCase() || ''
  const phone = (parsed.phone || '').replace(/\D/g, '')
  const normalizedPhone = phone.length >= 7 ? phone : ''
  const linkedin = (parsed.linkedin_url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '')
  const normalizedName = parsed.name.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (!email && !normalizedPhone && !linkedin && (!normalizedName || parsed.experience_years == null)) return []

  const { rows } = await pool.query<{ id: string; name: string; signals: string[] }>(
    `SELECT c.id, c.name,
            ARRAY_REMOVE(ARRAY[
              CASE WHEN $2 <> '' AND LOWER(BTRIM(COALESCE(c.email, ''))) = $2 THEN 'email' END,
              CASE WHEN $3 <> '' AND REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = $3 THEN 'phone' END,
              CASE WHEN $4 <> '' AND REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(SPLIT_PART(SPLIT_PART(LOWER(BTRIM(COALESCE(c.linkedin_url, ''))), '?', 1), '#', 1), '^https?://', ''),
                  '^www\\.', ''
                ),
                '/+$', ''
              ) = $4 THEN 'linkedin' END,
              CASE WHEN $5 <> '' AND $6::numeric IS NOT NULL
                AND REGEXP_REPLACE(LOWER(COALESCE(c.name, '')), '[^a-z0-9]', '', 'g') = $5
                AND c.experience_years IS NOT NULL
                AND ABS(c.experience_years - $6::numeric) <= 2 THEN 'name_experience' END
            ]::text[], NULL) AS signals
     FROM candidates c
     WHERE c.id <> $1 AND (
       ($2 <> '' AND LOWER(BTRIM(COALESCE(c.email, ''))) = $2)
       OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = $3)
       OR ($4 <> '' AND REGEXP_REPLACE(
         REGEXP_REPLACE(
           REGEXP_REPLACE(SPLIT_PART(SPLIT_PART(LOWER(BTRIM(COALESCE(c.linkedin_url, ''))), '?', 1), '#', 1), '^https?://', ''),
           '^www\\.', ''
         ),
         '/+$', ''
       ) = $4)
       OR ($5 <> '' AND $6::numeric IS NOT NULL
         AND REGEXP_REPLACE(LOWER(COALESCE(c.name, '')), '[^a-z0-9]', '', 'g') = $5
         AND c.experience_years IS NOT NULL
         AND ABS(c.experience_years - $6::numeric) <= 2)
     )
     ORDER BY c.created_at ASC
     LIMIT 10`,
    [candidateId, email, normalizedPhone, linkedin, normalizedName, parsed.experience_years ?? null],
  )
  return rows
}

function basename(value: string): string {
  try {
    const fromUrl = new URL(value).pathname.split('/').pop()
    return decodeURIComponent(fromUrl || value)
  } catch {
    return value.split(/[\\/]/).pop() || value
  }
}

function sourceValue(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
    const clean = value.value.trim()
    return clean && clean.toLowerCase() !== 'unknown' ? clean : undefined
  }
  return undefined
}

function toParsedCandidate(profile: CandidateProfile, resumeUrl: string | null): ParsedCandidate {
  const experience = profile.experience.map(entry => ({
    title: sourceValue(entry.title) || '',
    company: sourceValue(entry.company) || '',
    from: sourceValue(entry.startDate),
    to: sourceValue(entry.endDate),
    description: entry.responsibilities.join('\n') || undefined,
    achievements: entry.responsibilities,
    is_current: entry.isCurrent,
  })).filter(entry => entry.title && entry.company)

  const education = profile.education.map(entry => ({
    school: sourceValue(entry.university) || '',
    degree: sourceValue(entry.degree),
    field: sourceValue(entry.specialization),
    year: sourceValue(entry.graduationYear),
  })).filter(entry => entry.school)

  const projects = profile.projects.map(entry => ({
    name: sourceValue(entry.name) || '',
    description: sourceValue(entry.description),
    tech: entry.technologies,
    url: sourceValue(entry.url),
  })).filter(entry => entry.name)

  const certifications = profile.certifications.map(entry => ({
    name: sourceValue(entry.name) || '',
    issuer: sourceValue(entry.issuer),
    year: sourceValue(entry.date),
  })).filter(entry => entry.name)

  const languages = profile.languages.map(entry => ({
    name: sourceValue(entry.name) || '',
    proficiency: sourceValue(entry.proficiency),
  })).filter(entry => entry.name)

  const city = sourceValue(profile.contact.city)
  const state = sourceValue(profile.contact.state)
  const country = sourceValue(profile.contact.country)
  const location = [city, state, country].filter(Boolean).join(', ') || undefined

  return {
    name: sourceValue(profile.personal.name) || 'Unknown',
    email: sourceValue(profile.contact.email),
    phone: sourceValue(profile.contact.phone),
    linkedin_url: sourceValue(profile.contact.linkedin),
    github_url: sourceValue(profile.contact.github),
    portfolio_url: sourceValue(profile.contact.portfolio),
    headline: sourceValue(profile.personal.headline),
    location,
    summary: profile.personal.summary || undefined,
    experience_years: profile.experience.reduce((months, entry) => months + Math.max(0, entry.durationMonths), 0) / 12 || undefined,
    skills: profile.skills.map(skill => ({ name: skill.canonical, category: skill.category as ParsedCandidate['skills'][number]['category'] })),
    companies: experience.map(entry => ({ name: entry.company, title: entry.title, from: entry.from, to: entry.to })),
    work_history: experience,
    education,
    projects,
    certifications,
    languages,
    resume_url: resumeUrl || undefined,
  }
}

function snapshotProfile(candidate: Record<string, any>) {
  return {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    linkedin_url: candidate.linkedin_url,
    github_url: candidate.github_url,
    portfolio_url: candidate.portfolio_url,
    headline: candidate.headline,
    location: candidate.location,
    summary: candidate.summary,
    experience_years: candidate.experience_years,
    skills: parseArray(candidate.skills),
    companies: parseArray(candidate.companies),
    work_history: parseArray(candidate.work_history),
    education: parseArray(candidate.education),
    projects: parseArray(candidate.projects),
    certifications: parseArray(candidate.certifications),
    languages: parseArray(candidate.languages),
    data_quality_score: candidate.data_quality_score,
  }
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function collectProvenance(profile: CandidateProfile) {
  const evidence: Array<Record<string, unknown>> = []
  const add = (field: string, value: unknown) => {
    if (value && typeof value === 'object' && 'value' in value) {
      const source = value as { value: string; sourceSection?: string; extractor?: string; confidence?: { score?: number } }
      if (source.value) evidence.push({
        field,
        value: source.value,
        source: source.sourceSection || 'unknown',
        page: null,
        method: source.extractor || 'candidate-intelligence',
        confidence: source.confidence?.score ?? null,
      })
    }
  }
  add('name', profile.personal.name)
  add('headline', profile.personal.headline)
  for (const field of ['email', 'phone', 'linkedin', 'github', 'portfolio', 'city', 'state', 'country'] as const) {
    add(field, profile.contact[field])
  }
  for (const skill of profile.skills) {
    evidence.push({
      field: 'skills',
      value: skill.canonical,
      source: 'resume skills extraction',
      page: null,
      method: skill.confidence.reasons.join(', ') || 'dictionary',
      confidence: skill.confidence.score,
    })
  }
  return evidence
}

function fieldPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function mergeParsedWithOld(candidate: Record<string, any>, parsed: ParsedCandidate): ParsedCandidate {
  const merged = { ...parsed }
  for (const key of [
    'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url',
    'headline', 'location', 'summary', 'experience_years',
  ] as const) {
    if (!fieldPresent(merged[key]) && fieldPresent(candidate[key])) merged[key] = candidate[key]
  }
  for (const key of ['skills', 'companies', 'work_history', 'education', 'projects', 'certifications', 'languages'] as const) {
    if (!merged[key].length && parseArray(candidate[key]).length) merged[key] = parseArray(candidate[key]) as never
  }
  if (!fieldPresent(merged.name) || merged.name === 'Unknown') {
    if (fieldPresent(candidate.name)) merged.name = candidate.name
  }
  return merged
}

async function persistCandidateProfile(
  candidateId: string,
  parsed: ParsedCandidate,
  qualityScore: number,
  missingFields: string[],
  rawText: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT data_quality_score FROM candidates WHERE id = $1 FOR UPDATE`,
      [candidateId]
    )
    if (!current.rows.length) throw new Error(`Candidate ${candidateId} disappeared before profile update`)
    const { rows } = await client.query(
      `SELECT * FROM candidates WHERE id = $1`,
      [candidateId]
    )
    const merged = mergeParsedWithOld(rows[0], parsed)
    await client.query(
      `UPDATE candidates SET
         name = $2, email = $3, phone = $4, linkedin_url = $5, github_url = $6,
         portfolio_url = $7, headline = $8, location = $9, summary = $10,
         experience_years = $11, skills = $12::jsonb, companies = $13::jsonb,
         work_history = $14::jsonb, education = $15::jsonb, projects = $16::jsonb,
         certifications = $17::jsonb, languages = $18::jsonb,
         data_quality_score = GREATEST(COALESCE(data_quality_score, 0), $19),
         missing_fields = $20, parse_status = 'completed', parse_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [
        candidateId, merged.name, merged.email || null, merged.phone || null, merged.linkedin_url || null,
        merged.github_url || null, merged.portfolio_url || null, merged.headline || null, merged.location || null,
        merged.summary || null, merged.experience_years || null, JSON.stringify(merged.skills),
        JSON.stringify(merged.companies), JSON.stringify(merged.work_history), JSON.stringify(merged.education),
        JSON.stringify(merged.projects), JSON.stringify(merged.certifications), JSON.stringify(merged.languages),
        qualityScore, missingFields,
      ]
    )
    await client.query(
      `INSERT INTO documents (id, entity_type, entity_id, purpose, content, mime_type, created_at, updated_at)
       VALUES ($1, 'candidate', $2, 'raw_text', $3, 'text/plain', NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, purpose)
       DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
      [randomUUID(), candidateId, rawText]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function hasExistingEmbedding(candidateId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM embeddings WHERE entity_type = 'candidate' AND entity_id = $1 LIMIT 1`,
    [candidateId]
  )
  return result.rows.length > 0
}

async function indexValidatedProfile(candidateId: string, profile: ParsedCandidate): Promise<void> {
  const skills = profile.skills.map(skill => skill.name).filter(Boolean)
  const fullText = [
    profile.name, profile.headline, profile.location, profile.summary,
    skills.join(' '),
    profile.work_history.map(entry => `${entry.title} ${entry.company} ${entry.description || ''}`).join(' '),
    profile.education.map(entry => `${entry.degree || ''} ${entry.field || ''} ${entry.school}`).join(' '),
  ].filter(Boolean).join(' ').trim()
  if (!fullText) throw new Error('Validated profile does not contain indexable text')

  const [vector] = await generateEmbeddings([fullText])
  if (!vector?.length) throw new Error('Embedding provider returned an empty vector')

  const manager = new QdrantManager()
  await manager.getClient().upsert(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, {
    wait: true,
    points: [{
      id: candidateId,
      vector,
      payload: {
        entityId: candidateId,
        entityType: 'candidate',
        embeddingVersion: VECTOR_CONSTANTS.EMBEDDING_VERSION,
        profileVersion: VECTOR_CONSTANTS.PROFILE_VERSION,
        provider: process.env.EMBEDDING_PROVIDER || 'openai',
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        dimensions: vector.length,
        indexedAt: new Date().toISOString(),
        name: profile.name,
        headline: profile.headline || undefined,
        skills,
        location: profile.location || undefined,
        experienceYears: profile.experience_years ?? undefined,
      },
    }],
  })

  await pool.query(
    `INSERT INTO embeddings (id, entity_type, entity_id, purpose, model, dimensions, created_at)
     VALUES ($1, 'candidate', $2, 'full_text', $3, $4, NOW())
     ON CONFLICT (entity_type, entity_id, purpose)
     DO UPDATE SET model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, created_at = NOW()`,
    [randomUUID(), candidateId, process.env.EMBEDDING_MODEL || 'text-embedding-3-small', vector.length]
  )
}

async function recordRunFailure(run: RecoveryRun, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'PARSER_FAILED'
  const actionByCode: Record<string, string> = {
    SOURCE_FILE_MISSING: 'Restore or re-upload the original resume, then retry this recovery run',
    UNSUPPORTED_FORMAT: 'Convert the source document to PDF or DOCX before retrying',
    EXTRACTION_FAILED: 'Review the source file; try OCR or a supported document conversion',
    CANDIDATE_MISSING: 'No action required; the candidate was removed during recovery',
  }
  await pool.query(
    `UPDATE resume_parse_runs
     SET status = 'failed', error_code = $2, error_message = $3,
         last_parser_method = $4, recommended_next_action = $5,
         completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [
      run.id, errorCode, message.slice(0, 1000), RECOVERY_PARSER_VERSION,
      actionByCode[errorCode] || 'Review extraction and parser logs; correct the cause before retrying',
    ]
  )

  await pool.query(
    `UPDATE candidates SET parse_status = 'failed', parse_error = $2, updated_at = NOW()
     WHERE id = $1 AND LOWER(COALESCE(parse_status, '')) <> 'completed'`,
    [run.resume_id, `${errorCode}: ${message}`.slice(0, 500)]
  ).catch(dbError => console.error(`[ResumeRecovery] Could not update candidate failure ${run.resume_id}:`, dbError))
}
