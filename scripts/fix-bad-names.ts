/**
 * Fast fix: re-parse bad names using regex-only (no LLM) from existing raw_text.
 * Falls back to filename extraction if regex fails.
 */
import { db } from '../src/db/index.js'
import { parseResumeRegex } from '../src/parsers/resume-parser.js'

function extractNameFromFilename(source: string): string | null {
  // Extract from paths like "candidates/Resumes/654774000016837068 Sanjna.pdf"
  const basename = source.split('/').pop() || source
  // Remove extension
  const withoutExt = basename.replace(/\.(pdf|docx?|txt)$/i, '')
  // Remove leading numeric IDs (Cloudinary public IDs)
  const cleaned = withoutExt.replace(/^\d+\s*/, '').trim()
  if (cleaned.length >= 3 && /[a-zA-Z]/.test(cleaned) && !/gmail|yahoo|hotmail/i.test(cleaned)) {
    return cleaned
  }
  return null
}

async function main() {
  const badCandidates = await db.selectFrom('candidates')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('name', '=', 'Unknown'),
        eb('name', 'like', 'Processing%'),
        eb('name', 'like', 'Failed%'),
        eb('name', 'like', '%.pdf'),
        eb('name', 'like', '%.docx'),
        eb('name', '=', 'Links'),
        eb('name', '=', 'CONTACT'),
        eb('name', '=', 'LINK'),
        eb('name', '=', 'Location San Jose Costa Rica.'),
      ])
    )
    .execute()

  console.log(`Found ${badCandidates.length} bad candidates`)

  let fixed = 0
  let failed = 0

  for (const c of badCandidates) {
    let newName = ''

    // Try regex from raw_text first
    if (c.raw_text && c.raw_text.trim().length > 50) {
      try {
        const parsed = parseResumeRegex(c.raw_text)
        if (parsed.name && parsed.name !== 'Unknown') {
          newName = parsed.name
        }
      } catch {}
    }

    // Fallback to filename
    if (!newName && c.source_file) {
      const fromFile = extractNameFromFilename(c.source_file)
      if (fromFile) newName = fromFile
    }

    if (newName) {
      await db.updateTable('candidates')
        .set({ name: newName, updated_at: new Date() })
        .where('id', '=', c.id)
        .execute()
      fixed++
      console.log(`  Fixed: "${c.name}" → "${newName}"`)
    } else {
      failed++
      console.log(`  Failed: "${c.name}" (no raw text or filename)`)
    }
  }

  console.log(`\nDone: ${fixed} fixed, ${failed} failed`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
