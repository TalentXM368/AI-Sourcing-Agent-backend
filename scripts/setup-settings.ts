import { pool } from '../src/db/index.js'

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT 'true',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    INSERT INTO settings (key, value) VALUES
      ('auto_sync_resumes', 'true'),
      ('auto_sync_jds', 'true')
    ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
  `)
  const r = await pool.query('SELECT * FROM settings')
  console.log('Settings:')
  for (const row of r.rows) {
    console.log(`  ${row.key} = ${row.value}`)
  }
  await pool.end()
}
main()
