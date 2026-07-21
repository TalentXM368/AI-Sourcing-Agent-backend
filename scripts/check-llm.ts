import { pool } from '../src/db/index.js'

async function main() {
  const r = await pool.query(`
    SELECT job_id, count(*) as total,
      count(*) FILTER (WHERE llm_score > 0) as with_llm,
      count(*) FILTER (WHERE llm_verdict IS NOT NULL) as with_verdict
    FROM ranked_candidates GROUP BY job_id
  `)
  console.log('LLM evaluation status:')
  for (const row of r.rows) {
    console.log(`  Job ${row.job_id}: ${row.with_llm}/${row.total} with LLM score, ${row.with_verdict} with verdict`)
  }
  await pool.end()
}
main()
