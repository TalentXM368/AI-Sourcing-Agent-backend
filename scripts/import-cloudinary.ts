/**
 * Scheduled, resumable import of resume files from the configured Cloudinary account
 * (CLOUDINARY_CLOUD_NAME) into candidates. Deterministic parsing only: no LLM calls.
 *
 *   npx tsx scripts/import-cloudinary.ts inventory            list every resume file into resume_import_items
 *   npx tsx scripts/import-cloudinary.ts status               counts by status
 *   npx tsx scripts/import-cloudinary.ts run [--limit 2000] [--concurrency 4] [--max-minutes 150]
 *                                                             process the next pending files, then stop
 *   npx tsx scripts/import-cloudinary.ts retry-failed         put transient failures back in the queue
 *
 * Every file ends in exactly one status, so a run can stop at any point and the next one continues:
 *   imported            new candidate created (parse_status 'completed' when quality >= 60, else 'needs_review')
 *   merged              same person already existed and this resume parsed better: existing profile updated
 *   duplicate_file      this file (same URL or same bytes) is already in the system
 *   duplicate_person    same email / phone / LinkedIn as an existing candidate, existing profile kept
 *   rejected            too little usable data (quality < 40); nothing written
 *   no_text             no extractable text (scanned image); needs OCR
 *   failed              download/extraction error (retryable)
 *
 * Duplicate protection (ranking depends on one row per person):
 *   1. URL / public id already stored on a candidate
 *   2. SHA-256 of the file bytes seen before (in this import or an earlier recovery run)
 *   3. Identity: normalised email, last 10 phone digits, LinkedIn handle; checked and inserted
 *      under one advisory lock so two workers cannot insert the same person at once.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { createHash, randomUUID } from 'crypto'
import { mergeInfo, parseInfoCsv, tidyName } from '../src/services/zoho-candidate-info.js'
config({ path: resolve(process.cwd(), '.env') })

const args = process.argv.slice(2)
const command = args[0]
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const RESUME_FORMATS = new Set(['pdf', 'docx', 'doc'])
const IDENTITY_LOCK = 'resume-import-identity'

interface ImportItem { public_id: string; secure_url: string; record_id: string | null }

/** Remove NUL (U+0000) characters, which Postgres rejects in text and jsonb values. */
function stripNul(value: string): string {
  return value.includes('\u0000') ? value.replace(/\u0000/g, '') : value
}

async function ensureTable(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_import_items (
      public_id      TEXT PRIMARY KEY,
      cloud_name     TEXT NOT NULL,
      resource_type  TEXT NOT NULL,
      format         TEXT,
      secure_url     TEXT NOT NULL,
      bytes          INTEGER,
      uploaded_at    TIMESTAMPTZ,
      status         TEXT NOT NULL DEFAULT 'pending',
      attempts       INTEGER NOT NULL DEFAULT 0,
      file_hash      TEXT,
      candidate_id   UUID,
      quality_score  INTEGER,
      parser_version TEXT,
      error          TEXT,
      claimed_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  // kind: 'resume' (to process) or 'info' (Zoho Candidate_info CSV, read alongside its resume)
  await pool.query(`ALTER TABLE resume_import_items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'resume'`)
  await pool.query(`ALTER TABLE resume_import_items ADD COLUMN IF NOT EXISTS record_id TEXT`)
  await pool.query(`CREATE INDEX IF NOT EXISTS resume_import_items_status_idx ON resume_import_items (kind, status)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS resume_import_items_hash_idx ON resume_import_items (file_hash)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS resume_import_items_record_idx ON resume_import_items (record_id)`)
}

// ─── Inventory ────────────────────────────────────────────────

function recordIdOf(publicId: string): string | null {
  return publicId.split('/').pop()?.match(/^(\d{15,19})(?=[_.\-]|$)/)?.[1] || null
}

async function inventory() {
  const { pool } = await import('../src/db/index.js')
  const { cloudinary } = await import('../src/services/cloudinary.js')
  await ensureTable(pool)
  const cloud = process.env.CLOUDINARY_CLOUD_NAME!
  const prefix = flag('prefix', 'candidates/')
  const tally = { resume: 0, info: 0, other: 0, added: 0 }
  for (const resourceType of ['raw', 'image']) {
    let cursor: string | undefined
    do {
      const page: any = await cloudinary.api.resources({ type: 'upload', resource_type: resourceType, prefix, max_results: 500, next_cursor: cursor })
      const rows: any[] = []
      for (const r of page.resources || []) {
        const ext = String(r.format || r.public_id.split('.').pop() || '').toLowerCase()
        const kind = RESUME_FORMATS.has(ext) ? 'resume' : ext === 'csv' ? 'info' : null
        if (!kind) { tally.other++; continue }
        tally[kind as 'resume' | 'info']++
        rows.push([r.public_id, resourceType, ext, r.secure_url, r.bytes || null, r.created_at || null, kind, recordIdOf(r.public_id)])
      }
      if (rows.length) {
        const col = (i: number) => rows.map(row => row[i])
        const res = await pool.query(
          `INSERT INTO resume_import_items (public_id, cloud_name, resource_type, format, secure_url, bytes, uploaded_at, kind, record_id, status)
           SELECT p, $1, rt, f, u, b, t, k, rid, CASE WHEN k = 'info' THEN 'info' ELSE 'pending' END
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::timestamptz[], $8::text[], $9::text[])
             AS x(p, rt, f, u, b, t, k, rid)
           ON CONFLICT (public_id) DO NOTHING`,
          [cloud, col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7)]
        )
        tally.added += res.rowCount || 0
      }
      cursor = page.next_cursor
      process.stdout.write(`\r${resourceType}: ${tally.resume} resumes, ${tally.info} info CSVs, ${tally.added} newly queued`)
    } while (cursor)
  }
  console.log(`\nInventory complete for ${cloud}/${prefix}: ${tally.resume} resumes, ${tally.info} info CSVs (${tally.other} other files ignored), ${tally.added} new rows`)
  await printStatus(pool)
  await pool.end()
}

async function printStatus(pool: any) {
  const { rows } = await pool.query(
    `SELECT kind, status, COUNT(*)::int AS files, ROUND(AVG(quality_score))::int AS avg_quality
     FROM resume_import_items GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`)
  console.table(rows)
}

// ─── Processing ───────────────────────────────────────────────

function normaliseEmail(e?: string) { return e ? e.trim().toLowerCase() : '' }
function phoneKey(p?: string) { const d = (p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
function linkedinKey(u?: string) { return (u || '').toLowerCase().match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/)?.[1] || '' }

function nameFromFile(publicId: string): string {
  const base = decodeURIComponent(publicId.split('/').pop() || '').replace(/\.(pdf|docx?)$/i, '')
  return base.replace(/\d{6,}/g, ' ').replace(/[_\-]+/g, ' ').replace(/\b(?:resume|cv|curriculum|updated|final|new)\b/gi, ' ').replace(/\s+/g, ' ').trim()
}


async function run() {
  const limit = parseInt(flag('limit', '2000'), 10)
  const concurrency = Math.min(8, parseInt(flag('concurrency', '4'), 10))
  const deadline = Date.now() + parseInt(flag('max-minutes', '150'), 10) * 60_000

  const { pool } = await import('../src/db/index.js')
  await ensureTable(pool)
  const { fetchFromCloudinary } = await import('../src/services/cloudinary.js')
  const { detectMimetype, extractTextFromBuffer } = await import('../src/parsers/text-extractor.js')
  const { checkDocumentIntelligenceHealth, extractWithDocumentIntelligence } = await import('../src/services/document-intelligence.js')
  const { parseResumeOffline, isExtremeParseFailure, toDocSections } = await import('../src/parsers/resume-parser.js')
  const { DETERMINISTIC_PARSER_VERSION, looksLikePersonName } = await import('../src/parsers/deterministic-resume-parser.js')
  const { computeDataQuality } = await import('../src/scoring/data-quality.js')
  const { classifyByRules } = await import('../src/services/industry-classifier.js')
  const { classifyRegion } = await import('../src/services/region-classifier.js')
  const { persistCandidateProfile, indexValidatedProfile } = await import('../src/services/resume-recovery.js')

  // Release claims left by a crashed run
  await pool.query(`UPDATE resume_import_items SET status = 'pending', claimed_at = NULL WHERE status = 'processing' AND claimed_at < NOW() - INTERVAL '30 minutes'`)
  const diUp = await checkDocumentIntelligenceHealth()
  console.log(`Run: up to ${limit} files, concurrency ${concurrency}, parser ${DETERMINISTIC_PARSER_VERSION}, document service ${diUp ? 'UP' : 'DOWN (local extraction)'}`)

  const counts: Record<string, number> = {}
  let processed = 0
  const started = Date.now()

  const finish = async (publicId: string, status: string, extra: { hash?: string; candidateId?: string; quality?: number; error?: string } = {}) => {
    counts[status] = (counts[status] || 0) + 1
    await pool.query(
      `UPDATE resume_import_items SET status = $2, file_hash = COALESCE($3, file_hash), candidate_id = $4, quality_score = $5,
         error = $6, parser_version = $7, updated_at = NOW() WHERE public_id = $1`,
      [publicId, status, extra.hash || null, extra.candidateId || null, extra.quality ?? null, extra.error?.slice(0, 500) || null, DETERMINISTIC_PARSER_VERSION]
    )
  }

  const claim = async () => {
    const { rows } = await pool.query(
      `UPDATE resume_import_items SET status = 'processing', claimed_at = NOW(), attempts = attempts + 1
       WHERE public_id = (SELECT public_id FROM resume_import_items WHERE kind = 'resume' AND status = 'pending'
                          ORDER BY uploaded_at NULLS LAST, public_id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING public_id, secure_url, record_id`)
    return rows[0] as ImportItem | undefined
  }

  const processOne = async (item: ImportItem) => {
    const fileName = item.public_id.split('/').pop() || item.public_id
    // 1. Same URL / public id already on a candidate
    const byUrl = await pool.query(
      `SELECT id FROM candidates WHERE source_file = $1 OR resume_url = $1 OR resume_url LIKE '%/' || $2 LIMIT 1`, [item.secure_url, fileName])
    if (byUrl.rows[0]) return finish(item.public_id, 'duplicate_file', { candidateId: byUrl.rows[0].id })

    let bytes: Buffer
    try {
      bytes = await fetchFromCloudinary(item.secure_url, item.public_id)
    } catch (error: any) {
      return finish(item.public_id, 'failed', { error: `download: ${error.message}` })
    }
    // 2. Same bytes seen before
    const hash = createHash('sha256').update(bytes).digest('hex')
    const byHash = await pool.query(
      `SELECT candidate_id FROM resume_import_items WHERE file_hash = $1 AND public_id <> $2 AND status IN ('imported', 'merged', 'duplicate_person')
       UNION ALL SELECT resume_id FROM resume_parse_runs WHERE file_hash = $1 AND status IN ('success', 'partial') LIMIT 1`, [hash, item.public_id])
    if (byHash.rows[0]) return finish(item.public_id, 'duplicate_file', { hash, candidateId: byHash.rows[0].candidate_id })

    // Extraction
    const mimetype = detectMimetype(fileName)
    let text = ''
    let sections: any[] = []
    if (diUp && mimetype === 'application/pdf') {
      try {
        const di = await extractWithDocumentIntelligence(bytes, mimetype, fileName)
        if (di.text.trim().length >= 50) { text = di.text; sections = toDocSections(di.sections) }
      } catch { /* fall back to local extraction */ }
    }
    if (!text) {
      try { text = await extractTextFromBuffer(bytes, mimetype) } catch (error: any) {
        // Legacy binary .doc needs a dedicated reader (not installed); park these instead of retrying
        // Scanned/image-only or broken files will never succeed on retry: park them as no_text
        const status = /\.doc$/i.test(fileName) ? 'unsupported_doc'
          : /no extractable text|missing %PDF header|too short/i.test(error.message) ? 'no_text' : 'failed'
        return finish(item.public_id, status, { hash, error: `extract: ${error.message}` })
      }
    }
    // NUL characters from some PDF/DOCX extractors are rejected by Postgres text and jsonb columns
    text = stripNul(text)
    if (text.trim().length < 50) return finish(item.public_id, 'no_text', { hash })

    // Parse (deterministic only) and grade
    const parsed: any = { ...parseResumeOffline(text, sections), resume_url: item.secure_url, parse_source: 'regex' }
    // Recruiter-entered Zoho data (Candidate_info CSV) is authoritative for identity and contact fields
    if (item.record_id) {
      const info = await pool.query(`SELECT secure_url FROM resume_import_items WHERE kind = 'info' AND record_id = $1 LIMIT 1`, [item.record_id])
      if (info.rows[0]) {
        try {
          const csv = parseInfoCsv((await fetchFromCloudinary(info.rows[0].secure_url)).toString('utf8'))
          if (csv) mergeInfo(parsed, csv, looksLikePersonName)
        } catch (error: any) {
          console.warn(`[Import] info CSV unreadable for ${item.record_id}: ${error.message}`)
        }
      }
    }
    if (!looksLikePersonName(parsed.name)) {
      const fromFile = nameFromFile(item.public_id)
      parsed.name = looksLikePersonName(fromFile) ? fromFile : 'Unknown'
    }
    parsed.name = tidyName(parsed.name)
    if (parsed.headline) parsed.headline = parsed.headline.replace(/^[^A-Za-z0-9(]+/, '').trim() || undefined
    const quality = computeDataQuality(parsed)
    if (quality.quality_score < 40 || isExtremeParseFailure(parsed)) {
      return finish(item.public_id, 'rejected', { hash, quality: quality.quality_score })
    }

    // 3. Identity check + insert under one lock so concurrent workers cannot duplicate a person
    const email = normaliseEmail(parsed.email)
    const phone = phoneKey(parsed.phone)
    const linkedin = linkedinKey(parsed.linkedin_url)
    const recordId = item.record_id || ''
    const client = await pool.connect()
    let outcome: { status: string; candidateId?: string; updateExisting?: boolean } = { status: 'imported' }
    const candidateId = randomUUID()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [IDENTITY_LOCK])
      const existing = (email || phone || linkedin || recordId) ? await client.query(
        `SELECT id, COALESCE(data_quality_score, 0) AS q FROM candidates
         WHERE ($1 <> '' AND LOWER(TRIM(email)) = $1)
            OR ($2 <> '' AND RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2)
            OR ($3 <> '' AND LOWER(linkedin_url) LIKE '%/in/' || $3 || '%')
            OR ($4 <> '' AND (resume_url LIKE '%/' || $4 || '%' OR source_file LIKE '%/' || $4 || '%'))
         ORDER BY COALESCE(data_quality_score, 0) DESC LIMIT 1`, [email, phone, linkedin, recordId]) : { rows: [] as any[] }
      if (existing.rows[0]) {
        outcome = existing.rows[0].q < quality.quality_score
          ? { status: 'merged', candidateId: existing.rows[0].id, updateExisting: true }
          : { status: 'duplicate_person', candidateId: existing.rows[0].id }
      } else {
        const skillNames = parsed.skills.map((s: any) => s.name)
        const industry = classifyByRules(`${parsed.headline || ''} ${parsed.summary || ''} ${skillNames.join(' ')} ${text.slice(0, 3000)}`).industry
        await client.query(
          `INSERT INTO candidates (id, name, email, phone, linkedin_url, github_url, portfolio_url, headline, location, summary,
             experience_years, skills, companies, work_history, education, projects, certifications, languages,
             data_quality_score, missing_fields, industry, region, parse_status, source, source_file, resume_url, raw_text, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,
             $19,$20,$21,$22,$23,'resume',$24,$24,$25,NOW(),NOW())`,
          [candidateId, parsed.name, parsed.email || null, parsed.phone || null, parsed.linkedin_url || null, parsed.github_url || null,
            parsed.portfolio_url || null, parsed.headline || null, parsed.location || null, parsed.summary || null, parsed.experience_years || null,
            JSON.stringify(parsed.skills), JSON.stringify(parsed.companies), JSON.stringify(parsed.work_history), JSON.stringify(parsed.education),
            JSON.stringify(parsed.projects), JSON.stringify(parsed.certifications), JSON.stringify(parsed.languages),
            quality.quality_score, quality.missing_fields, industry, classifyRegion(parsed.location || ''),
            quality.quality_score >= 60 ? 'completed' : 'needs_review', item.secure_url, text]
        )
        outcome = { status: 'imported', candidateId }
      }
      await client.query('COMMIT')
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {})
      return finish(item.public_id, 'failed', { hash, error: `save: ${error.message}` })
    } finally {
      client.release()
    }

    if (outcome.updateExisting && outcome.candidateId) {
      // Better resume for a known person: same guarded write path as recovery (keeps a real existing name)
      await persistCandidateProfile(outcome.candidateId, parsed, quality.quality_score, quality.missing_fields, text)
    }
    if (outcome.status !== 'duplicate_person' && outcome.candidateId && quality.quality_score >= 75) {
      try { await indexValidatedProfile(outcome.candidateId, parsed) } catch (error: any) {
        console.warn(`[Import] search indexing failed for ${outcome.candidateId}: ${error.message}`)
      }
    }
    return finish(item.public_id, outcome.status, { hash, candidateId: outcome.candidateId, quality: quality.quality_score })
  }

  const worker = async () => {
    while (processed < limit && Date.now() < deadline) {
      const item = await claim()
      if (!item) return
      processed++
      try { await processOne(item) } catch (error: any) {
        await finish(item.public_id, 'failed', { error: error.message })
      }
      if (processed % 25 === 0) {
        const rate = processed / ((Date.now() - started) / 60_000)
        console.log(`[${new Date().toLocaleTimeString()}] ${processed} processed (${rate.toFixed(1)}/min) ${JSON.stringify(counts)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(`\nRun finished: ${processed} files in ${Math.round((Date.now() - started) / 60_000)} min ${JSON.stringify(counts)}`)
  await printStatus(pool)
  await pool.end()
}

/**
 * Re-parse resumes imported by an older parser version from their stored text (no download),
 * re-applying the Zoho CSV merge, and update the existing candidate through the guarded
 * recovery write path (existing real names are kept). New quality is never lower than old.
 */
async function refresh() {
  const limit = parseInt(flag('limit', '5000'), 10)
  const { pool } = await import('../src/db/index.js')
  await ensureTable(pool)
  const { fetchFromCloudinary } = await import('../src/services/cloudinary.js')
  const { parseResumeOffline } = await import('../src/parsers/resume-parser.js')
  const { DETERMINISTIC_PARSER_VERSION, looksLikePersonName } = await import('../src/parsers/deterministic-resume-parser.js')
  const { computeDataQuality } = await import('../src/scoring/data-quality.js')
  const { persistCandidateProfile, indexValidatedProfile } = await import('../src/services/resume-recovery.js')
  const { rows } = await pool.query(
    `SELECT r.public_id, r.secure_url, r.record_id, r.candidate_id, c.raw_text, info.secure_url AS info_url
     FROM resume_import_items r
     JOIN candidates c ON c.id = r.candidate_id
     LEFT JOIN resume_import_items info ON info.kind = 'info' AND info.record_id = r.record_id
     WHERE r.kind = 'resume' AND r.status IN ('imported', 'merged')
       AND COALESCE(r.parser_version, '') <> $1 AND COALESCE(c.raw_text, '') <> ''
     LIMIT $2`, [DETERMINISTIC_PARSER_VERSION, limit])
  console.log(`Refreshing ${rows.length} imported resumes with ${DETERMINISTIC_PARSER_VERSION}`)
  let done = 0
  for (const r of rows) {
    r.raw_text = stripNul(r.raw_text)
    const parsed: any = { ...parseResumeOffline(r.raw_text), resume_url: r.secure_url, parse_source: 'regex' }
    if (r.info_url) {
      try {
        const csv = parseInfoCsv((await fetchFromCloudinary(r.info_url)).toString('utf8'))
        if (csv) mergeInfo(parsed, csv, looksLikePersonName)
      } catch { /* keep resume-only parse */ }
    }
    parsed.name = tidyName(looksLikePersonName(parsed.name) ? parsed.name : 'Unknown')
    if (parsed.headline) parsed.headline = parsed.headline.replace(/^[^A-Za-z0-9(]+/, '').trim() || undefined
    const quality = computeDataQuality(parsed)
    await persistCandidateProfile(r.candidate_id, parsed, quality.quality_score, quality.missing_fields, r.raw_text)
    if (quality.quality_score >= 75) {
      try { await indexValidatedProfile(r.candidate_id, parsed) } catch { /* search index retried on next refresh */ }
    }
    await pool.query(`UPDATE resume_import_items SET parser_version = $2, quality_score = GREATEST(COALESCE(quality_score, 0), $3), updated_at = NOW() WHERE public_id = $1`,
      [r.public_id, DETERMINISTIC_PARSER_VERSION, quality.quality_score])
    if (++done % 50 === 0) console.log(`  ${done}/${rows.length}`)
  }
  console.log(`Refreshed ${done}`)
  await pool.end()
}

async function main() {
  const { pool } = await import('../src/db/index.js')
  switch (command) {
    case 'inventory': return inventory()
    case 'run': return run()
    case 'refresh': return refresh()
    case 'status': await ensureTable(pool); await printStatus(pool); return pool.end()
    case 'retry-failed': {
      await ensureTable(pool)
      const r = await pool.query(`UPDATE resume_import_items SET status = 'pending' WHERE status = 'failed' AND attempts < 3`)
      console.log(`${r.rowCount} failed files re-queued`)
      return pool.end()
    }
    default:
      console.log('Commands: inventory | status | run [--limit N --concurrency N --max-minutes N] | retry-failed | refresh [--limit N]')
      return pool.end()
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
