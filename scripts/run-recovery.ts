/**
 * Run resume recovery (re-parsing of badly parsed resumes) from a long-lived local
 * process instead of the serverless API, which stops background work after responding.
 *
 *   npx tsx scripts/run-recovery.ts check                 readiness checks, writes nothing
 *   npx tsx scripts/run-recovery.ts start 20 [--concurrency 3]
 *                                                         run the next stage (20 → 100 → 300 → remaining) and wait
 *   npx tsx scripts/run-recovery.ts status <batchId>      counts and before/after sample
 *   npx tsx scripts/run-recovery.ts approve <batchId> --notes "checked sample"
 *   npx tsx scripts/run-recovery.ts reject  <batchId> --notes "names wrong"
 *   npx tsx scripts/run-recovery.ts resume                continue batches left 'running' by a crash
 *   npx tsx scripts/run-recovery.ts match-local <folder>  dry run: backlog resumes that have a file in a local folder
 *
 * Set RESUME_LOCAL_DIR=<folder> to read original files from a local folder instead of Cloudinary.
 *
 * Each stage stops at 'review_required'; the next stage is allowed only after approve.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })

const [command, arg, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}

function summarise(profile: any): string {
  if (!profile) return '-'
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  return `${String(profile.name || '?').slice(0, 24)} | ${profile.email ? 'email' : '-'} ${profile.phone ? 'phone' : '-'} | skills ${n(profile.skills)} work ${n(profile.work_history)} edu ${n(profile.education)}`
}

async function printBatch(batchId: string) {
  const { getRecoveryBatch } = await import('../src/services/resume-recovery.js')
  const detail = await getRecoveryBatch(batchId)
  if (!detail) throw new Error(`Batch ${batchId} not found`)
  const b = detail.batch
  console.log(`\nBatch ${b.id}  stage=${b.stage}  status=${b.status}`)
  console.log('Counts:', JSON.stringify(detail.counts))
  console.log('Extraction:', detail.methods.map((m: any) => `${m.extraction_method || 'n/a'}/${m.index_status}: ${m.count}`).join(', '))
  console.log('\nReview sample (worst first):')
  for (const r of detail.review_sample) {
    console.log(`\n- ${r.resume_id}  ${r.status}  quality ${r.old_quality_score ?? '-'} → ${r.quality_score ?? '-'}  ${r.error_code || ''}`)
    console.log(`    before: ${summarise(r.old_profile)}`)
    console.log(`    after : ${summarise(r.new_profile)}`)
    const c = r.comparison || {}
    if (c.improvedFields?.length || c.lostFields?.length) console.log(`    improved: ${(c.improvedFields || []).join(',') || '-'}  lost: ${(c.lostFields || []).join(',') || '-'}`)
    if (r.error_message) console.log(`    error: ${String(r.error_message).slice(0, 160)}`)
    if (r.recommended_next_action) console.log(`    next: ${r.recommended_next_action}`)
  }
  return detail
}

async function waitForBatch(batchId: string) {
  const { pool } = await import('../src/db/index.js')
  let last = ''
  while (true) {
    const { rows } = await pool.query(
      `SELECT b.status,
              COUNT(r.*) FILTER (WHERE r.status IN ('success','partial','low_quality','failed','skipped'))::int AS done,
              COUNT(r.*)::int AS total
       FROM resume_recovery_batches b LEFT JOIN resume_parse_runs r ON r.batch_id = b.id
       WHERE b.id = $1 GROUP BY b.status`,
      [batchId]
    )
    const row = rows[0]
    const line = `${row?.status}: ${row?.done}/${row?.total}`
    if (line !== last) { console.log(`[${new Date().toLocaleTimeString()}] ${line}`); last = line }
    if (!row || row.status !== 'running') return
    await new Promise(r => setTimeout(r, 5000))
  }
}

async function check() {
  const { pool } = await import('../src/db/index.js')
  const { cloudNameFromUrl, credentialsForCloud, fetchFromCloudinary } = await import('../src/services/cloudinary.js')
  const { checkDocumentIntelligenceHealth } = await import('../src/services/document-intelligence.js')
  const { getRecoveryReport } = await import('../src/services/resume-recovery.js')
  let ok = true

  const report = await getRecoveryReport()
  console.log('Backlog:', JSON.stringify(report.counts))
  console.log('Parser version:', report.parser_version, '| next stage:', report.next_stage ?? '(none: review or finish the current batch)')

  const clouds = await pool.query<{ cloud: string; n: number }>(
    `SELECT substring(resume_url from 'res\\.cloudinary\\.com/([^/]+)/') AS cloud, COUNT(*)::int AS n
     FROM candidates WHERE resume_url IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`
  )
  for (const { cloud, n } of clouds.rows) {
    if (!cloud) continue
    const has = !!credentialsForCloud(cloud)
    console.log(`Cloudinary ${cloud}: ${n} files, credentials ${has ? 'OK' : 'MISSING'}`)
    if (!has) ok = false
  }

  const sample = await pool.query<{ resume_url: string }>(
    `SELECT resume_url FROM candidates WHERE resume_url ILIKE '%.pdf' ORDER BY random() LIMIT 3`
  )
  for (const { resume_url } of sample.rows) {
    const publicId = resume_url.split('/upload/')[1]?.replace(/^v\d+\//, '').split('?')[0]
    try {
      const bytes = await fetchFromCloudinary(resume_url, publicId)
      console.log(`PDF download OK (${cloudNameFromUrl(resume_url)}, ${bytes.length} bytes)`)
    } catch (e: any) {
      ok = false
      console.log(`PDF download FAILED: ${String(e.message).slice(0, 200)}`)
    }
  }

  const di = await checkDocumentIntelligenceHealth()
  console.log(`Document service: ${di ? 'UP' : 'DOWN (local extraction only; scanned PDFs will fail)'}`)
  console.log(`LLM fallback: ${process.env.RESUME_LLM_FALLBACK === 'off' ? 'off' : 'not used by recovery (uploads only)'}`)
  console.log(ok ? '\nREADY' : '\nNOT READY: fix the items marked MISSING/FAILED above')
}

/** recovery batches record who ran them as a users.id; use the admin account from ADMIN_EMAIL */
async function operatorId(): Promise<string> {
  const { pool } = await import('../src/db/index.js')
  const email = flag('as') || process.env.ADMIN_EMAIL
  const { rows } = await pool.query<{ id: string }>(
    email
      ? `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`
      : `SELECT id FROM users ORDER BY created_at LIMIT 1`,
    email ? [email] : []
  )
  if (!rows[0]) throw new Error(`No user found for ${email || 'operator'}; pass --as <user email>`)
  return rows[0].id
}

async function main() {
  const recovery = await import('../src/services/resume-recovery.js')
  const { pool } = await import('../src/db/index.js')
  try {
    switch (command) {
      case 'check':
        await check()
        break
      case 'start': {
        if (!arg) throw new Error('Usage: start <20|100|300|remaining> [--concurrency N]')
        const concurrency = parseInt(flag('concurrency') || '3', 10)
        const { batchId, queued } = await recovery.startRecoveryBatch(arg as any, concurrency, await operatorId())
        console.log(`Started batch ${batchId} with ${queued} resumes (concurrency ${concurrency})`)
        await waitForBatch(batchId)
        await printBatch(batchId)
        console.log(`\nReview the sample, then:\n  npx tsx scripts/run-recovery.ts approve ${batchId} --notes "..."`)
        break
      }
      case 'status':
        if (!arg) throw new Error('Usage: status <batchId>')
        await printBatch(arg)
        break
      case 'approve':
      case 'reject': {
        if (!arg) throw new Error(`Usage: ${command} <batchId> --notes "..."`)
        const notes = flag('notes')
        if (!notes) throw new Error('--notes is required')
        const detail = await recovery.getRecoveryBatch(arg)
        if (!detail) throw new Error('Batch not found')
        const ids = detail.review_sample.map((r: { resume_id: string }) => r.resume_id)
        await recovery.reviewRecoveryBatch(arg, ids, notes, await operatorId(), command === 'approve')
        console.log(`Batch ${arg} ${command === 'approve' ? 'approved; the next stage can start' : 'rejected and stopped'}`)
        break
      }
      case 'resume': {
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM resume_recovery_batches WHERE status = 'running'`)
        if (!rows.length) { console.log('No running batches'); break }
        await recovery.resumeActiveRecoveryBatches()
        for (const { id } of rows) { await waitForBatch(id); await printBatch(id) }
        break
      }
      case 'match-local': {
        // Dry run: how many backlog resumes have a file in the local folder (writes nothing)
        const dir = arg || process.env.RESUME_LOCAL_DIR
        if (!dir) throw new Error('Usage: match-local <folder>  (or set RESUME_LOCAL_DIR)')
        const { buildLocalIndex, findLocalResumePath } = await import('../src/services/local-resume-store.js')
        const index = buildLocalIndex(dir)
        console.log(`Folder: ${dir}\nResume files found: ${index.files} (${index.byRecordId.size} with a Zoho record id)`)
        const report = await recovery.getRecoveryBacklogForCsv()
        const rows = await pool.query<{ id: string; resume_url: string | null; source_file: string | null; has_text: boolean }>(
          `SELECT id, resume_url, source_file, COALESCE(raw_text, '') <> '' AS has_text FROM candidates WHERE id = ANY($1::uuid[])`,
          [report.map(r => r.id)]
        )
        let matched = 0, matchedNoText = 0, noText = 0
        const missing: string[] = []
        for (const r of rows.rows) {
          const hit = findLocalResumePath(r.resume_url || r.source_file || '', dir)
          if (!r.has_text) noText++
          if (hit) { matched++; if (!r.has_text) matchedNoText++ }
          else if (!r.has_text && missing.length < 10) missing.push(decodeURIComponent((r.resume_url || r.source_file || '').split('/').pop() || ''))
        }
        console.log(`Backlog resumes: ${rows.rows.length}`)
        console.log(`  with a local file: ${matched}`)
        console.log(`  without stored text (cannot be re-parsed otherwise): ${noText}, of which found locally: ${matchedNoText}`)
        if (missing.length) console.log(`  examples still missing:\n    ${missing.join('\n    ')}`)
        break
      }
      default:
        console.log('Commands: check | start <stage> | status <id> | approve <id> --notes | reject <id> --notes | resume')
    }
  } finally {
    await pool.end()
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
