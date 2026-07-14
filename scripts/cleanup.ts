import { pool } from '../src/db/index.js'

async function main() {
  // Delete test jobs and their embeddings + rankings
  const testRoles = ['Test Delete Me', 'Full Stack Developer']
  
  for (const role of testRoles) {
    const job = await pool.query('SELECT id FROM jobs WHERE role = $1', [role])
    if (job.rows.length === 0) continue
    const jobId = job.rows[0].id
    
    await pool.query('DELETE FROM ranked_candidates WHERE job_id = $1', [jobId])
    await pool.query('DELETE FROM embeddings WHERE entity_id = $1 AND entity_type = $2', [jobId, 'job'])
    await pool.query('DELETE FROM jobs WHERE id = $1', [jobId])
    console.log(`Deleted job: ${role} (${jobId})`)
  }

  // Verify remaining jobs
  const remaining = await pool.query('SELECT id, role, status FROM jobs ORDER BY created_at DESC')
  console.log('\nRemaining jobs:')
  for (const j of remaining.rows) {
    console.log(`  ${j.role} [${j.status}]`)
  }

  await pool.end()
}

main().catch(console.error)
