const { pool } = require('../dist/db/index.js');

async function main() {
  // 1. Candidate counts by source
  const sources = await pool.query(
    "SELECT COALESCE(source, 'unknown') as source, COUNT(*) as cnt FROM candidates WHERE parse_status = 'completed' GROUP BY source"
  );
  console.log('=== Candidates by Source ===');
  console.table(sources.rows);

  // 2. Embedding counts and dimensions
  const embeds = await pool.query(
    "SELECT purpose, COUNT(*) as cnt, array_length(vector, 1) as dims FROM embeddings GROUP BY purpose, array_length(vector, 1) ORDER BY purpose"
  );
  console.log('=== Embeddings ===');
  console.table(embeds.rows);

  // 3. Processing status distribution
  const statuses = await pool.query(
    "SELECT entity_type, stage, status, COUNT(*) as cnt FROM processing_status GROUP BY entity_type, stage, status ORDER BY entity_type, stage"
  );
  console.log('=== Processing Status ===');
  console.table(statuses.rows);

  // 4. Ranked candidates count
  const ranked = await pool.query(
    "SELECT job_id, COUNT(*) as cnt FROM ranked_candidates GROUP BY job_id ORDER BY cnt DESC LIMIT 5"
  );
  console.log('=== Top Ranked Jobs ===');
  console.table(ranked.rows);

  // 5. AI evaluations count
  const evals = await pool.query(
    "SELECT job_id, COUNT(*) as cnt FROM ai_evaluations GROUP BY job_id ORDER BY cnt DESC LIMIT 5"
  );
  console.log('=== Top AI Evaluated Jobs ===');
  console.table(evals.rows);

  // 6. Jobs with pipeline status
  const jobs = await pool.query(
    "SELECT id, role FROM jobs ORDER BY created_at DESC LIMIT 5"
  );
  console.log('=== Recent Jobs ===');
  console.table(jobs.rows);

  // 7. Check for candidates with missing embeddings
  const noEmbed = await pool.query(
    "SELECT COUNT(*) as cnt FROM candidates c WHERE c.parse_status = 'completed' AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.entity_type = 'candidate' AND e.entity_id = c.id AND e.purpose = 'full_text')"
  );
  console.log('=== Candidates WITHOUT embeddings ===');
  console.log(noEmbed.rows[0]);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
