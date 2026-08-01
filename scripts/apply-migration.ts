import { pool } from '../src/db/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function main() {
  const sql = readFileSync(resolve(__dirname, '../prisma/migrations/20260725_add_integration_tables/migration.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migration applied successfully');

  const r1 = await pool.query('SELECT COUNT(*) FROM ai_evaluations');
  const r2 = await pool.query('SELECT COUNT(*) FROM pipeline_runs');
  const r3 = await pool.query('SELECT COUNT(*) FROM processing_status');
  console.log('ai_evaluations:', r1.rows[0].count);
  console.log('pipeline_runs:', r2.rows[0].count);
  console.log('processing_status:', r3.rows[0].count);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
