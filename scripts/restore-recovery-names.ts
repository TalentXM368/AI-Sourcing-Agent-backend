/**
 * Restore candidate names that a recovery run replaced with a non-name (heading, place, role).
 * Uses the earliest recovery run's old_profile as the pre-recovery name.
 *
 *   npx tsx scripts/restore-recovery-names.ts           dry run, prints changes
 *   npx tsx scripts/restore-recovery-names.ts --apply   writes the restored names
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })

const apply = process.argv.includes('--apply')

async function main() {
  const { pool } = await import('../src/db/index.js')
  const { looksLikePersonName } = await import('../src/parsers/deterministic-resume-parser.js')
  const { rows } = await pool.query<{ id: string; current: string; original: string }>(
    `SELECT DISTINCT ON (r.resume_id) r.resume_id AS id, c.name AS current, r.old_profile->>'name' AS original
     FROM resume_parse_runs r JOIN candidates c ON c.id = r.resume_id
     WHERE r.status IN ('success', 'partial')
     ORDER BY r.resume_id, r.created_at ASC`
  )
  const tokens = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ').split(/\s+/).filter(Boolean)
  const changes = rows.filter(r => {
    // Only restore real names; swapping one non-name back for another gains nothing
    if (!r.original || r.current === r.original || !looksLikePersonName(r.original)) return false
    if (!looksLikePersonName(r.current)) return true
    if (!looksLikePersonName(r.current)) return true
    const have = new Set(tokens(r.current))
    return !tokens(r.original).every(t => have.has(t))
  })
  for (const c of changes) console.log(`${c.id}  "${c.current}"  ->  "${c.original}"`)
  console.log(`\n${changes.length} of ${rows.length} recovered candidates need their original name back`)
  if (apply && changes.length) {
    for (const c of changes) {
      await pool.query(`UPDATE candidates SET name = $2, updated_at = NOW() WHERE id = $1`, [c.id, c.original])
    }
    console.log('Applied.')
  } else if (!apply) console.log('Dry run: re-run with --apply to write.')
  await pool.end()
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
