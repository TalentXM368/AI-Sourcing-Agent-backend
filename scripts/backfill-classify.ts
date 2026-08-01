import { pool } from '../src/db/index.js'
import { classifyRegion } from '../src/services/region-classifier.js'
import { classifyIndustry } from '../src/services/industry-classifier.js'

async function main() {
  console.log('=== Backfilling industry + region for candidates ===')

  // Backfill candidates
  const candResult = await pool.query(
    `SELECT id, name, location, headline, skills, raw_text FROM candidates WHERE parse_status = 'completed'`
  )
  console.log(`Found ${candResult.rows.length} completed candidates`)

  let candUpdated = 0
  for (const row of candResult.rows) {
    const region = classifyRegion(row.location || '')
    const skills = Array.isArray(row.skills) ? row.skills.map((s: any) => s.name || s) : []
    const text = `${row.name || ''} ${row.headline || ''} ${row.location || ''} ${skills.join(' ')} ${row.raw_text || ''}`
    const industry = await classifyIndustry(text, skills, row.headline || undefined)

    await pool.query(
      `UPDATE candidates SET industry = $1, region = $2 WHERE id = $3`,
      [industry.industry, region, row.id]
    )
    candUpdated++
    if (candUpdated % 10 === 0) {
      console.log(`  Candidates: ${candUpdated}/${candResult.rows.length} updated`)
    }
  }
  console.log(`Candidates: ${candUpdated} updated`)

  // Backfill jobs
  console.log('\n=== Backfilling industry + region for jobs ===')
  const jobResult = await pool.query(
    `SELECT id, role, location, required_skills, description, raw_text FROM jobs`
  )
  console.log(`Found ${jobResult.rows.length} jobs`)

  let jobUpdated = 0
  for (const row of jobResult.rows) {
    const region = classifyRegion(row.location || '')
    const skills = row.required_skills || []
    const text = `${row.role || ''} ${row.description || ''} ${skills.join(' ')} ${row.raw_text || ''}`
    const industry = await classifyIndustry(text, skills, row.role || undefined)

    await pool.query(
      `UPDATE jobs SET industry = $1, region = $2 WHERE id = $3`,
      [industry.industry, region, row.id]
    )
    jobUpdated++
    console.log(`  Job: ${row.role} → industry=${industry.industry}, region=${region}`)
  }
  console.log(`Jobs: ${jobUpdated} updated`)

  // Summary
  console.log('\n=== Summary ===')
  const summary = await pool.query(`
    SELECT 'candidates' as table_name, industry, region, count(*) as cnt
    FROM candidates WHERE parse_status = 'completed'
    GROUP BY industry, region ORDER BY cnt DESC
  `)
  for (const row of summary.rows) {
    console.log(`  ${row.table_name}: ${row.industry} / ${row.region} = ${row.cnt}`)
  }

  const jobSummary = await pool.query(`
    SELECT 'jobs' as table_name, industry, region, count(*) as cnt
    FROM jobs GROUP BY industry, region ORDER BY cnt DESC
  `)
  for (const row of jobSummary.rows) {
    console.log(`  ${row.table_name}: ${row.industry} / ${row.region} = ${row.cnt}`)
  }

  await pool.end()
  console.log('\nDone!')
}

main().catch(console.error)
