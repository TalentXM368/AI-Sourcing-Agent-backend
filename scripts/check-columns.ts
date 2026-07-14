import { pool } from '../src/db/index.js'

async function main() {
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name IN ('candidates', 'jobs') 
    AND column_name IN ('industry', 'region')
    ORDER BY table_name, column_name
  `)
  console.log('Columns found:', res.rows)
  
  // Also check if it was applied
  const candCheck = await pool.query(`SELECT industry, region FROM candidates LIMIT 1`)
  console.log('Candidates row:', candCheck.rows[0])
  
  await pool.end()
}

main().catch(console.error)
