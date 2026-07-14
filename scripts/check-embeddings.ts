import { pool } from '../src/db/index.js'

async function main() {
  // Check candidate embedding models
  const modelRes = await pool.query(
    `SELECT model, count(*) as cnt, array_length(vector, 1) as dims
     FROM embeddings 
     WHERE entity_type = 'candidate' AND purpose = 'full_text'
     GROUP BY model, array_length(vector, 1)`
  )
  console.log('Candidate embedding models:', JSON.stringify(modelRes.rows, null, 2))

  // Check job embedding models
  const jobModelRes = await pool.query(
    `SELECT model, count(*) as cnt, array_length(vector, 1) as dims
     FROM embeddings 
     WHERE entity_type = 'job'
     GROUP BY model, array_length(vector, 1)`
  )
  console.log('Job embedding models:', JSON.stringify(jobModelRes.rows, null, 2))

  // Try scoring: run matchJobToAllCandidates via a quick test
  // Check if the cosine similarity function works with 384d vectors
  const testRes = await pool.query(
    `SELECT 
       (SELECT vector FROM embeddings WHERE entity_id = $1 AND entity_type = 'job' AND purpose = 'full_text') as job_vec,
       (SELECT vector FROM embeddings WHERE entity_type = 'candidate' AND purpose = 'full_text' LIMIT 1) as cand_vec`,
    ['a8d01eba-8c9d-4f7d-b33f-0866ae21f3e0']
  )
  
  if (testRes.rows[0]) {
    const jobVec = testRes.rows[0].job_vec
    const candVec = testRes.rows[0].cand_vec
    console.log('Job vec type:', typeof jobVec, 'length:', Array.isArray(jobVec) ? jobVec.length : 'N/A')
    console.log('Cand vec type:', typeof candVec, 'length:', Array.isArray(candVec) ? candVec.length : 'N/A')
  }

  await pool.end()
}

main().catch(console.error)
