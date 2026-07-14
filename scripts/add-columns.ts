import { pool } from '../src/db/index.js'

async function main() {
  await pool.query('ALTER TABLE candidates ADD COLUMN IF NOT EXISTS industry TEXT')
  await pool.query('ALTER TABLE candidates ADD COLUMN IF NOT EXISTS region TEXT')
  await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS industry TEXT')
  await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS region TEXT')
  console.log('Columns added successfully')

  const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('candidates','jobs') AND column_name IN ('industry','region') ORDER BY table_name`)
  console.log('Verified:', res.rows)
  await pool.end()
}

main().catch(console.error)
