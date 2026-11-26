/**
 * Drop resume candidates that cannot be repaired: still bad after recovery, no stored text,
 * and the original file lives in a Cloudinary account we cannot access.
 *
 *   npx tsx scripts/drop-unrecoverable-resumes.ts            dry run: counts and examples, writes nothing
 *   npx tsx scripts/drop-unrecoverable-resumes.ts --apply    CSV backup -> Qdrant vectors -> DB rows
 *
 * Safety:
 *  - refuses to run while a recovery batch is 'running';
 *  - never touches candidates linked to projects or AI evaluations;
 *  - writes a full-column CSV backup (backups/, git-ignored, contains personal data) before deleting;
 *  - removes search vectors first, so search never returns a deleted id.
 * ranked_candidates and resume_parse_runs rows go with the candidate (ON DELETE CASCADE).
 */
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })

const APPLY = process.argv.includes('--apply')
const INACCESSIBLE_CLOUD = process.env.UNRECOVERABLE_CLOUD_NAME || 'dluwum789'

const SELECT_IDS = `
  SELECT c.id FROM candidates c
  WHERE (COALESCE(c.source, 'resume') = 'resume' OR c.resume_url IS NOT NULL)
    AND (LOWER(COALESCE(c.parse_status, '')) NOT IN ('completed', 'success') OR COALESCE(c.data_quality_score, 0) < 75)
    AND COALESCE(c.raw_text, '') = ''
    AND c.resume_url ILIKE '%res.cloudinary.com/' || $1 || '/%'
    AND c.resume_url !~* '\\.docx?$'
    AND NOT EXISTS (SELECT 1 FROM project_candidates p WHERE p.candidate_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM ai_evaluations e WHERE e.candidate_id = c.id)`

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function main() {
  const { pool } = await import('../src/db/index.js')
  try {
    const running = await pool.query(`SELECT id FROM resume_recovery_batches WHERE status = 'running'`)
    if (running.rows.length) {
      console.log(`A recovery batch is still running (${running.rows.map(r => r.id).join(', ')}). Wait for it to finish.`)
      if (APPLY) process.exitCode = 1
      if (APPLY) return
    }

    const ids = (await pool.query<{ id: string }>(SELECT_IDS, [INACCESSIBLE_CLOUD])).rows.map(r => r.id)
    const summary = await pool.query(
      `SELECT COALESCE(parse_status, '(null)') AS status, COUNT(*)::int AS n, ROUND(AVG(COALESCE(data_quality_score, 0)))::int AS avg_quality
       FROM candidates WHERE id = ANY($1::uuid[]) GROUP BY 1 ORDER BY 2 DESC`, [ids])
    const refs = await pool.query(
      `SELECT (SELECT COUNT(*) FROM ranked_candidates WHERE candidate_id = ANY($1::uuid[]))::int AS ranked,
              (SELECT COUNT(*) FROM embeddings WHERE entity_type = 'candidate' AND entity_id = ANY($1::uuid[]))::int AS embeddings`, [ids])
    const examples = await pool.query(`SELECT name, parse_status, data_quality_score FROM candidates WHERE id = ANY($1::uuid[]) ORDER BY random() LIMIT 8`, [ids])

    console.log(`Unrecoverable candidates (files in Cloudinary account "${INACCESSIBLE_CLOUD}", no stored text, still bad): ${ids.length}`)
    console.table(summary.rows)
    console.log(`Also removed: ${refs.rows[0].ranked} job-match rows, ${refs.rows[0].embeddings} search vectors`)
    console.log('Examples:', examples.rows.map(r => `${r.name} [${r.parse_status}, q=${r.data_quality_score ?? 0}]`).join(' | '))
    if (!APPLY) { console.log('\nDry run: nothing changed. Re-run with --apply to back up and delete.'); return }
    if (!ids.length) { console.log('Nothing to delete.'); return }

    // 1. Full backup
    const rows = (await pool.query(`SELECT * FROM candidates WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids])).rows
    const columns = Object.keys(rows[0])
    const dir = resolve(process.cwd(), 'backups')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, `unrecoverable-candidates-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
    writeFileSync(file, [columns.join(','), ...rows.map(r => columns.map(c => csvCell(r[c])).join(','))].join('\n'), 'utf8')
    console.log(`Backup written: ${file} (${rows.length} rows)`)

    // 2. Search vectors (before DB rows, so search never points at a deleted id)
    const vectorIds = (await pool.query<{ entity_id: string }>(
      `SELECT entity_id FROM embeddings WHERE entity_type = 'candidate' AND entity_id = ANY($1::uuid[])`, [ids])).rows.map(r => r.entity_id)
    if (vectorIds.length) {
      const { QdrantManager } = await import('../src/modules/vector-intelligence/qdrant/qdrant-manager.js')
      const { VECTOR_CONSTANTS } = await import('../src/modules/vector-intelligence/constants/index.js')
      await new QdrantManager().getClient().delete(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, { wait: true, points: vectorIds })
      console.log(`Deleted ${vectorIds.length} Qdrant points`)
    }

    // 3. Database rows, in one transaction
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM embeddings WHERE entity_type = 'candidate' AND entity_id = ANY($1::uuid[])`, [ids])
      const docs = await client.query(`SELECT to_regclass('public.documents') IS NOT NULL AS present`)
      if (docs.rows[0].present) await client.query(`DELETE FROM documents WHERE entity_type = 'candidate' AND entity_id = ANY($1::uuid[])`, [ids])
      const deleted = await client.query(`DELETE FROM candidates WHERE id = ANY($1::uuid[])`, [ids])
      await client.query('COMMIT')
      console.log(`Deleted ${deleted.rowCount} candidates`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1) })
