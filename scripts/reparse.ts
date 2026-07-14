#!/usr/bin/env node
// Reparse resumes using multi-provider AI (Groq + Claude + Gemini + OpenAI)
// Usage: npx tsx scripts/reparse.ts [--dry-run] [--limit=N] [--min-quality=N]

import { config } from 'dotenv'
import { resolve } from 'path'
import { Kysely } from 'kysely'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { ParsedCandidate } from '../src/types.js'

config({ path: resolve(__dirname, '../.env') })

// Import the multi-provider parser
import { parseResumeWithAI } from '../src/services/openai.js'

// ─── DB Setup ─────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
})
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) })

// ─── Data Quality ─────────────────────────────────────────────
function computeDataQuality(c: ParsedCandidate): { score: number; missing: string[] } {
  const checks = [
    { field: 'name', present: !!(c.name && c.name !== 'Unknown') },
    { field: 'email', present: !!c.email },
    { field: 'phone', present: !!c.phone },
    { field: 'headline', present: !!c.headline },
    { field: 'location', present: !!c.location },
    { field: 'summary', present: !!c.summary },
    { field: 'skills', present: c.skills.length > 0 },
    { field: 'work_history', present: c.work_history.length > 0 },
    { field: 'education', present: c.education.length > 0 },
    { field: 'experience_years', present: c.experience_years !== undefined },
    { field: 'linkedin', present: !!c.linkedin_url },
  ]
  const present = checks.filter(c => c.present).length
  const missing = checks.filter(c => !c.present).map(c => c.field)
  return { score: Math.round((present / checks.length) * 100), missing }
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 999
  const minQualityArg = args.find(a => a.startsWith('--min-quality='))
  const minQuality = minQualityArg ? parseInt(minQualityArg.split('=')[1]) : 70

  console.log('=== Resume Reparse (Multi-Provider) ===')
  console.log(`Target: quality < ${minQuality}%, limit: ${limit}`)
  console.log('Dry run:', dryRun)

  // Get candidates needing reparse
  const candidates = await db
    .selectFrom('candidates')
    .select(['id', 'name', 'data_quality_score'])
    .where('data_quality_score', '<', minQuality)
    .orderBy('data_quality_score', 'asc')
    .limit(limit)
    .execute()

  console.log(`Found ${candidates.length} candidates to reparse\n`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    console.log(`[${i + 1}/${candidates.length}] ${c.name} (quality: ${c.data_quality_score})`)

    if (dryRun) continue

    try {
      // Fetch raw_text individually (saves memory)
      const row = await db
        .selectFrom('candidates')
        .select(['raw_text'])
        .where('id', '=', c.id)
        .executeTakeFirst()

      if (!row?.raw_text || row.raw_text.length < 50) {
        console.log('  SKIP: no raw_text')
        skipped++
        continue
      }

      const text = row.raw_text
      console.log(`  Text: ${text.length} chars`)

      // Parse with multi-provider AI (Groq + Claude + Gemini + OpenAI in parallel)
      let aiResult: ParsedCandidate
      try {
        aiResult = await parseResumeWithAI(text)
      } catch (e: any) {
        console.log(`  ALL PROVIDERS FAILED: ${e.message?.slice(0, 80)}`)
        failed++
        await new Promise(r => setTimeout(r, 2000))
        continue
      }

      // Compute quality
      const quality = computeDataQuality(aiResult)
      console.log(`  → New quality: ${quality.score}% (missing: ${quality.missing.join(', ') || 'none'})`)

      // Only update if quality improved
      if (quality.score > (c.data_quality_score || 0)) {
        await db
          .updateTable('candidates')
          .set({
            name: aiResult.name,
            headline: aiResult.headline || null,
            location: aiResult.location || null,
            summary: aiResult.summary || null,
            experience_years: aiResult.experience_years || null,
            skills: JSON.stringify(aiResult.skills),
            companies: JSON.stringify(aiResult.companies),
            work_history: JSON.stringify(aiResult.work_history),
            education: JSON.stringify(aiResult.education),
            projects: JSON.stringify(aiResult.projects),
            certifications: JSON.stringify(aiResult.certifications),
            languages: JSON.stringify(aiResult.languages),
            data_quality_score: quality.score,
            missing_fields: quality.missing,
            updated_at: new Date(),
          })
          .where('id', '=', c.id)
          .executeTakeFirst()
        console.log(`  ✓ Updated (${c.data_quality_score} → ${quality.score})`)
        updated++
      } else {
        console.log(`  - No improvement, skipping`)
        skipped++
      }

      // Rate limit: 3 seconds between candidates
      if (i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, 3000))
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message?.slice(0, 100)}`)
      failed++
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)

  await pool.end()
  process.exit(0)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
