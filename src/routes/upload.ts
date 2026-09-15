import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../db/index.js'
import { pool } from '../db/index.js'
import { extractTextFromBuffer, detectMimetype } from '../parsers/text-extractor.js'
import { parseResume, parseResumeRegex } from '../parsers/resume-parser.js'
import { parseCSV, convertToJDs } from '../parsers/csv-parser.js'
import { parseJobDescription } from '../parsers/jd-parser.js'
import { generateEmbeddings } from '../services/openai.js'
import { matchCandidateToAllJobs, matchJobToAllCandidates } from '../scoring/index.js'
import { listCloudinaryFolder, listAllCloudinaryResumes, fetchFromCloudinary } from '../services/cloudinary.js'
import { computeDataQuality } from '../scoring/data-quality.js'
import { classifyRegion } from '../services/region-classifier.js'
import { classifyIndustry } from '../services/industry-classifier.js'
import { extractWithDocumentIntelligence, checkDocumentIntelligenceHealth, ensureDocumentIntelligenceRunning } from '../services/document-intelligence.js'
import { runFullCandidatePipeline } from '../services/candidate-pipeline.js'
import { runFullJobPipeline } from '../services/jd-pipeline.js'
import { indexCandidateToQdrant } from '../utils/qdrant-indexing.js'

export const uploadRouter = Router()

// ─── Extract name from Cloudinary filename ────────────────────
// Pattern: "654774000016534067_Esteban.pdf" → "Esteban"
// Pattern: "654774000016534067_Esteban.pdf.docx" → "Esteban"
// Pattern: "Rohan Rajendra Thite(Resume).pdf" → "Rohan Rajendra Thite"
function extractNameFromFilename(publicId: string): string | undefined {
  const basename = publicId.split('/').pop() || publicId
  // Strip all extensions (handles double extensions like .pdf.doc)
  const withoutExt = basename.replace(/\.(pdf|docx?|txt)+$/i, '')
  const parts = withoutExt.split('_')
  if (parts.length >= 2) {
    const name = parts.slice(1).join('_').trim()
    if (name && name.length > 1 && !name.match(/^\d+$/)) {
      return name
    }
  }
  // Handle parentheses: "Rohan Rajendra Thite(Resume)" → "Rohan Rajendra Thite"
  const withoutParens = withoutExt.replace(/\s*\(.*?\)\s*/g, '').trim()
  if (withoutParens.length >= 2 && isValidPersonName(withoutParens)) {
    return withoutParens
  }
  // Fallback: strip numeric prefix + extension from full basename
  const cleaned = withoutExt.replace(/^\d+[\s_-]*/, '').replace(/^[_\s]+/, '').trim()
  if (cleaned.length >= 2 && !cleaned.match(/^\d+$/) && /[a-zA-Z]{2,}/.test(cleaned)) {
    return cleaned
  }
  return undefined
}

// ─── Validate that a name looks like a person's name ──────────
const SECTION_HEADERS = new Set([
  'work experience', 'work history', 'professional summary', 'professional summary-',
  'education', 'skills', 'projects', 'certifications', 'languages', 'contact',
  'summary', 'objective', 'experience', 'training', 'internship',
  'summer internship training', 'internship training',
])

function isValidPersonName(name: string): boolean {
  if (!name || name.length < 2) return false
  const normalized = name.toLowerCase().trim().replace(/\s+/g, ' ')
  if (SECTION_HEADERS.has(normalized)) return false
  if (/^\d+$/.test(name)) return false

  // Reject university/college/institute names
  const institutionKeywords = [
    'university', 'college', 'institute', 'academy', 'school',
    'polytechnic', 'faculty', 'department', 'centre', 'center',
    'iit ', 'iim ', 'nit ', 'bits ',
  ]
  if (institutionKeywords.some(kw => normalized.includes(kw))) return false

  // Reject concatenated locations (e.g. "AhmedabadGujaratIndia")
  if (/^[a-z]{6,}[A-Z]/.test(name.replace(/\s/g, '')) && name.replace(/\s/g, '').length > 15) return false

  // Reject names that are clearly locations
  const locationNames = new Set([
    'ahmedabad', 'mumbai', 'bangalore', 'bengaluru', 'delhi', 'chennai',
    'hyderabad', 'pune', 'jaipur', 'lucknow', 'kolkata', 'indore',
    'agra', 'nagpur', 'surat', 'vadodara', 'rajkot',
    'new york', 'san francisco', 'london', 'tokyo', 'singapore',
  ])
  if (locationNames.has(normalized)) return false

  // Reject if it looks like a city+state+country without spaces
  if (/^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/.test(name.replace(/\s/g, ''))) return false

  // Reject if name is too long (likely not a person name)
  if (name.length > 60) return false

  // Must have at least one alphabetic character
  if (!/[a-zA-Z]/.test(name)) return false

  return true
}

function findNameFromResumeText(text: string): string | undefined {
  const ignored = /^(resume|curriculum vitae|cv|profile|contact|personal details|professional summary)$/i
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15)

  for (const line of lines) {
    if (line.length < 3 || line.length > 60 || ignored.test(line)) continue
    if (line.includes('@') || /https?:\/\//i.test(line) || /\d{5,}/.test(line)) continue
    const candidate = line.replace(/^[|•·\-–—]+|[|•·\-–—]+$/g, '').trim()
    if (isValidPersonName(candidate) && candidate.split(/\s+/).length >= 2) return candidate
  }
  return undefined
}

// ─── Extract public_id from Cloudinary URL ────────────────────
// "https://res.cloudinary.com/dluwum789/raw/upload/v1782910497/candidates/Resumes/654774000016534067_Esteban.pdf"
// → "candidates/Resumes/654774000016534067_Esteban.pdf"
// For raw files, public_id INCLUDES the extension
function extractPublicIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/)
  return match?.[1]
}

// ─── Raw SQL embeddings helpers (bypasses Prisma FK issue) ────

async function deleteEmbeddings(entityId: string): Promise<void> {
  await pool.query('DELETE FROM embeddings WHERE entity_id = $1', [entityId])
}

async function insertEmbeddingsMetadata(
  entityId: string,
  dimensions: number,
  purpose: string,
  entityType: string = 'candidate'
): Promise<void> {
  await pool.query(
    `INSERT INTO embeddings (id, entity_type, entity_id, purpose, model, dimensions, created_at)
     VALUES ($1, $2, $3, $4, 'text-embedding-3-small', $5, NOW())
     ON CONFLICT (entity_type, entity_id, purpose) DO NOTHING`,
    [randomUUID(), entityType, entityId, purpose, dimensions]
  )
}

// ─── Sync Resumes from Cloudinary (small batch) ───────────────

uploadRouter.post('/sync-cloudinary', async (req: Request, res: Response) => {
  try {
    const folder = req.body.folder || 'candidates/Resumes'

    const files = await listCloudinaryFolder(folder, 200)
    console.log(`[Sync] Found ${files.length} files in Cloudinary folder: ${folder}`)

    if (files.length === 0) {
      return res.json({ synced: 0, skipped: 0, failed: 0, message: `No files found in folder: ${folder}` })
    }

    const existing = await db.selectFrom('candidates').select('source_file').execute()
    const existingUrls = new Set(existing.map(e => e.source_file))

    let synced = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    // Check pdftext health once
    let diAvailable = await checkDocumentIntelligenceHealth()
    if (!diAvailable) {
      await ensureDocumentIntelligenceRunning()
      diAvailable = await checkDocumentIntelligenceHealth()
    }

    for (const file of files) {
      const url = file.secure_url

      if (existingUrls.has(url)) {
        skipped++
        continue
      }

      let candidateId = randomUUID()
      try {
        const now = new Date()

        await db.insertInto('candidates').values({
          id: candidateId,
          name: 'Processing...',
          source_file: url,
          resume_url: url,
          parse_status: 'processing',
          created_at: now,
          updated_at: now,
        }).execute()

        const pdfBuffer = await fetchFromCloudinary(url, file.public_id)
        const mimetype = detectMimetype(file.public_id)

        // ── TEXT EXTRACTION: pdftext best, fallback to extraction ──
        let text = ''
        if (diAvailable) {
          try {
            const diResult = await extractWithDocumentIntelligence(pdfBuffer, mimetype, file.public_id)
            if (diResult.text.length > 50) {
              text = diResult.text
            }
          } catch (diErr) {
            console.warn(`[Sync] pdftext failed: ${diErr}`)
          }
        }
        if (!text) {
          text = await extractTextFromBuffer(pdfBuffer, mimetype)
        }

        // ── FIELD PARSING: regex only ──
        const parsed = parseResumeRegex(text)

        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(file.public_id)
          if (nameFromFilename) candidateName = nameFromFilename
        }
        if (!isValidPersonName(candidateName) && text) {
          const firstLine = text.split('\n').find(l => l.trim().length > 2 && l.trim().length < 60) || ''
          const firstName = firstLine.trim().replace(/[^a-zA-Z\s.]/g, '').trim()
          if (isValidPersonName(firstName)) candidateName = firstName
        }

        const quality = computeDataQuality(parsed as any)
        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
            languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            industry: industryResult.industry,
            region: regionResult,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidateId)
          .execute()

        // Store raw_text in documents table
        try {
          const { insertDocument } = await import('../db/documents.js')
          await insertDocument(candidateId, 'candidate', 'raw_text', text)
        } catch {}

try {
	           const skillsText = parsed.skills.map((s: any) => s.name).join(' ')
	           const roleText = parsed.headline || parsed.companies[0]?.title || ''
	           const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])
	           await deleteEmbeddings(candidateId)
	           const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'full_text')
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'skills')
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'role')
	           await indexCandidateToQdrant({
            candidateId,
            name: candidateName,
            fullVector: fullVec,
            skills: skillNames,
            headline: parsed.headline || undefined,
            location: parsed.location || undefined,
            experienceYears: parsed.experience_years || undefined,
            industry: industryResult.industry || undefined,
          })
        } catch {}

        synced++
        console.log(`[Sync] ${candidateName} — q=${quality.quality_score} skills=${skillNames.length} work=${parsed.work_history.length} edu=${parsed.education.length}`)
      } catch (error) {
        failed++
        const errMsg = `${file.public_id}: ${String(error)}`
        errors.push(errMsg)
        console.error(`[Sync] Failed:`, errMsg)
        try {
          await db.updateTable('candidates')
            .set({ name: `Failed: ${String(error).slice(0, 50)}`, parse_status: 'failed', parse_error: String(error).slice(0, 500), updated_at: new Date() })
            .where('id', '=', candidateId)
            .execute()
        } catch {}
      }
    }

    res.json({ synced, skipped, failed, total: files.length, errors })
  } catch (error) {
    console.error('[Sync] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Bulk Sync ALL Resumes from Cloudinary (paginated) ────────
// Uses listAllCloudinaryResumes for auto-paginated fetching (all 2000+ files)
// Returns immediately, processes in background with concurrency control

uploadRouter.post('/sync-cloudinary-full', async (req: Request, res: Response) => {
  try {
    const folder = req.body.folder || 'candidates/Resumes'
    const batchSize = Math.min(req.body.batchSize || 10, 20) // max 20 concurrent

    // 1. Fetch ALL files from Cloudinary (auto-paginated)
    console.log(`[Sync Full] Fetching all files from Cloudinary: ${folder}`)
    const files = await listAllCloudinaryResumes(folder)
    console.log(`[Sync Full] Found ${files.length} total files`)

    if (files.length === 0) {
      return res.json({ total: 0, queued: 0, message: `No files found in folder: ${folder}` })
    }

    // 2. Check which ones are already ingested
    const existing = await db.selectFrom('candidates')
      .select('source_file')
      .execute()
    const existingUrls = new Set(existing.map(e => e.source_file))

    // Filter to only unprocessed files
    const toProcess = files.filter(f => !existingUrls.has(f.secure_url))
    const alreadyProcessed = files.length - toProcess.length
    console.log(`[Sync Full] ${alreadyProcessed} already in DB, ${toProcess.length} to process`)

    if (toProcess.length === 0) {
      return res.json({ total: files.length, queued: 0, alreadyProcessed, message: 'All files already processed' })
    }

    // 3. Create placeholder candidates for all files IMMEDIATELY
    const placeholders: Array<{ candidateId: string; file: typeof files[0] }> = []
    for (const file of toProcess) {
      const candidateId = randomUUID()
      const now = new Date()

      await db.insertInto('candidates').values({
        id: candidateId,
        name: 'Processing...',
        source_file: file.secure_url,
        resume_url: file.secure_url,
        parse_status: 'processing',
        created_at: now,
        updated_at: now,
      }).execute()

      placeholders.push({ candidateId, file })
    }

    console.log(`[Sync Full] Created ${placeholders.length} placeholder candidates, processing in background...`)

    // 4. Respond IMMEDIATELY
    res.json({
      total: files.length,
      queued: toProcess.length,
      alreadyProcessed,
      batchSize,
      message: `Processing ${toProcess.length} resumes in background`,
    })

    // 5. Process in background with concurrency control
    processBulkSync(placeholders, existingUrls, batchSize).catch(err => {
      console.error('[Sync Full] Background processing error:', err)
    })
  } catch (error) {
    console.error('[Sync Full] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Background Bulk Processor ─────────────────────────────────
// Text extraction: pdftext (best quality) → fallback to mammoth
// Field parsing: ALWAYS regex (parseResumeRegex) — no AI, no broken section pipeline
// Embeddings + Qdrant indexing happen after parse

async function processBulkSync(
  placeholders: Array<{ candidateId: string; file: { public_id: string; secure_url: string; format: string; filename: string } }>,
  existingUrls: Set<string | null>,
  batchSize: number
) {
  let synced = 0
  let failed = 0
  const errors: string[] = []

  // Check pdftext health once for the whole batch
  let diAvailable = await checkDocumentIntelligenceHealth()
  if (!diAvailable) {
    console.log(`[Sync Full] pdftext is down, attempting auto-restart...`)
    await ensureDocumentIntelligenceRunning()
    diAvailable = await checkDocumentIntelligenceHealth()
  }
  console.log(`[Sync Full] pdftext available: ${diAvailable}`)

  // Process in batches
  for (let i = 0; i < placeholders.length; i += batchSize) {
    const batch = placeholders.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async ({ candidateId, file }) => {
        // Re-check dedup
        if (existingUrls.has(file.secure_url)) {
          await db.deleteFrom('candidates').where('id', '=', candidateId).execute()
          return 'skipped'
        }

        try {
          const pdfBuffer = await fetchFromCloudinary(file.secure_url, file.public_id)
          const mimetype = detectMimetype(file.public_id)

          // ── TEXT EXTRACTION (pdftext only — best quality) ──
          let text = ''
          if (diAvailable) {
            try {
              const diResult = await extractWithDocumentIntelligence(pdfBuffer, mimetype, file.public_id)
              if (diResult.text.length > 50) {
                text = diResult.text
                console.log(`[Sync Full] pdftext extracted: ${file.public_id} — ${text.length} chars`)
              } else {
                console.log(`[Sync Full] pdftext insufficient for ${file.public_id} (${diResult.text.length} chars)`)
              }
            } catch (diErr) {
              console.warn(`[Sync Full] pdftext failed for ${file.public_id}: ${diErr}`)
            }
          }

          // Fallback: extractTextFromBuffer (mammoth for docx, pdf-parse for pdf)
          if (!text) {
            text = await extractTextFromBuffer(pdfBuffer, mimetype)
          }

          if (!text || text.length < 30) {
            console.log(`[Sync Full] No extractable text for ${file.public_id}`)
            await db.updateTable('candidates')
              .set({ name: extractNameFromFilename(file.public_id) || 'Unknown', parse_status: 'failed', parse_error: 'No extractable text', updated_at: new Date() })
              .where('id', '=', candidateId)
              .execute()
            failed++
            return 'failed'
          }

          // ── FIELD PARSING (regex only — no AI) ──
          const parsed = parseResumeRegex(text)

          // ── NAME VALIDATION ──
          let candidateName = parsed.name
          if (!isValidPersonName(candidateName)) {
            const nameFromFilename = extractNameFromFilename(file.public_id)
            if (nameFromFilename) candidateName = nameFromFilename
          }
          if (!isValidPersonName(candidateName) && text) {
            const firstLine = text.split('\n').find(l => l.trim().length > 2 && l.trim().length < 60) || ''
            const firstName = firstLine.trim().replace(/[^a-zA-Z\s.]/g, '').trim()
            if (isValidPersonName(firstName)) candidateName = firstName
          }
          if (!candidateName || !isValidPersonName(candidateName)) {
            candidateName = extractNameFromFilename(file.public_id) || 'Unknown'
          }

          // ── COMPUTE METADATA ──
          const quality = computeDataQuality(parsed as any)
          const skillNames = parsed.skills.map((s: any) => s.name || s)
          const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
          const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
          const regionResult = classifyRegion(parsed.location || '')

          // ── STORE IN DB ──
          await db.updateTable('candidates')
            .set({
              name: candidateName,
              email: parsed.email,
              phone: parsed.phone,
              linkedin_url: parsed.linkedin_url,
              github_url: parsed.github_url,
              portfolio_url: parsed.portfolio_url,
              headline: parsed.headline,
              location: parsed.location,
              summary: parsed.summary,
              experience_years: parsed.experience_years,
              skills: JSON.stringify(parsed.skills),
              companies: JSON.stringify(parsed.companies),
              work_history: JSON.stringify(parsed.work_history),
              education: JSON.stringify(parsed.education),
              projects: JSON.stringify(parsed.projects),
              certifications: JSON.stringify(parsed.certifications),
languages: JSON.stringify(parsed.languages),
               data_quality_score: quality.quality_score,
               missing_fields: quality.missing_fields,
               industry: industryResult.industry,
               region: regionResult,
               parse_status: 'completed',
               parse_error: null,
               updated_at: new Date(),
             })
             .where('id', '=', candidateId)
             .execute()

             // Store raw_text in documents table
             try {
               const { insertDocument } = await import('../db/documents.js')
               await insertDocument(candidateId, 'candidate', 'raw_text', text)
             } catch {}

             console.log(`[Sync Full] ${candidateName} — q=${quality.quality_score} skills=${skillNames.length} work=${parsed.work_history.length} edu=${parsed.education.length}`)
          existingUrls.add(file.secure_url)
          synced++
          return 'synced'
        } catch (error) {
          failed++
          const errMsg = `${file.public_id}: ${String(error)}`
          errors.push(errMsg)
          console.error(`[Sync Full] Failed:`, errMsg)
          try {
            await db.updateTable('candidates')
              .set({ name: `Failed: ${String(error).slice(0, 50)}`, parse_status: 'failed', parse_error: String(error).slice(0, 500), updated_at: new Date() })
              .where('id', '=', candidateId)
              .execute()
          } catch {}
          return 'failed'
        }
      })
    )

    const batchDone = results.filter(r => r.status === 'fulfilled' && r.value === 'synced').length
    const batchSkipped = results.filter(r => r.status === 'fulfilled' && r.value === 'skipped').length
    const batchFailed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === 'failed')).length

    console.log(`[Sync Full] Batch ${Math.floor(i / batchSize) + 1}: ${batchDone} synced, ${batchSkipped} skipped, ${batchFailed} failed (total: ${synced}/${placeholders.length})`)
  }

  console.log(`[Sync Full] COMPLETE: ${synced} synced, ${failed} failed out of ${placeholders.length} total`)
}

// ─── Re-Process All Resumes with Fixed Parser ─────────────────
// Re-parses raw_text with improved regex parser, re-extracts text for candidates missing it

uploadRouter.post('/reprocess-all', async (req: Request, res: Response) => {
  try {
    const batchSize = Math.min(req.body.batchSize || 10, 20)

    // Find all resume candidates that need re-processing (skip completed)
    const candidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'resume_url', 'raw_text', 'parse_status', 'source_file'])
      .where('source', '=', 'resume')
      .where('parse_status', '!=', 'completed')
      .execute()

    console.log(`[Reprocess] Found ${candidates.length} resume candidates`)

    // Filter to those with resume_url (all from Cloudinary)
    const withUrl = candidates.filter(c => c.resume_url)
    const withRawText = withUrl.filter(c => c.raw_text && c.raw_text.length > 100)
    const withoutRawText = withUrl.filter(c => !c.raw_text || c.raw_text.length <= 100)

    console.log(`[Reprocess] ${withRawText.length} with raw_text (re-parse only), ${withoutRawText.length} without raw_text (re-extract + parse)`)

    // Respond immediately
    res.json({
      total: candidates.length,
      withRawText: withRawText.length,
      withoutRawText: withoutRawText.length,
      message: 'Re-processing started in background',
    })

    // Process in background
    reprocessAll(withRawText, withoutRawText, batchSize).catch(err => {
      console.error('[Reprocess] Background error:', err)
    })
  } catch (error) {
    console.error('[Reprocess] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

async function reprocessAll(
  withRawText: Array<{ id: string; name: string | null; raw_text: string | null; resume_url: string | null; source_file: string | null }>,
  withoutRawText: Array<{ id: string; name: string | null; resume_url: string | null; source_file: string | null }>,
  batchSize: number
) {
  let reParsed = 0
  let reExtracted = 0
  let failed = 0

  // Check pdftext health
  let diAvailable = await checkDocumentIntelligenceHealth()
  if (!diAvailable) {
    await ensureDocumentIntelligenceRunning()
    diAvailable = await checkDocumentIntelligenceHealth()
  }
  console.log(`[Reprocess] pdftext available: ${diAvailable}`)

  // 1. Re-parse candidates that already have raw_text
  console.log(`[Reprocess] Phase 1: Re-parsing ${withRawText.length} candidates with existing raw_text...`)
  for (let i = 0; i < withRawText.length; i += batchSize) {
    const batch = withRawText.slice(i, i + batchSize)
    await Promise.allSettled(batch.map(async (c) => {
      try {
        const text = c.raw_text!
        const parsed = parseResumeRegex(text)

        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFile = c.source_file ? extractNameFromFilename(c.source_file) : undefined
          if (nameFromFile) candidateName = nameFromFile
        }
        if (!candidateName || !isValidPersonName(candidateName)) {
          candidateName = c.name || 'Unknown'
        }

        const quality = computeDataQuality(parsed as any)
        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
            languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            industry: industryResult.industry,
            region: regionResult,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', c.id)
          .execute()

        reParsed++
        if (reParsed % 50 === 0) console.log(`[Reprocess] Re-parsed ${reParsed}/${withRawText.length}`)
      } catch (err) {
        failed++
        console.error(`[Reprocess] Failed re-parsing ${c.id}: ${err}`)
      }
    }))
  }
  console.log(`[Reprocess] Phase 1 done: ${reParsed} re-parsed, ${failed} failed`)

  // 2. Re-extract text + parse for candidates without raw_text
  if (withoutRawText.length > 0) {
    console.log(`[Reprocess] Phase 2: Re-extracting text for ${withoutRawText.length} candidates...`)
    for (let i = 0; i < withoutRawText.length; i++) {
      const c = withoutRawText[i]
      try {
        if (!c.resume_url) {
          failed++
          continue
        }

        // Extract from Cloudinary — use archive download with publicId
        const publicId = extractPublicIdFromUrl(c.resume_url)
        if (!publicId) { failed++; continue }
        const pdfBuffer = await fetchFromCloudinary(c.resume_url, publicId)
        const mimetype = detectMimetype(c.resume_url)

        let text = ''
        if (diAvailable) {
          try {
            const diResult = await extractWithDocumentIntelligence(pdfBuffer, mimetype, c.resume_url)
            if (diResult.text.length > 50) {
              text = diResult.text
            }
          } catch {}
        }
        if (!text) {
          text = await extractTextFromBuffer(pdfBuffer, mimetype)
        }

        if (!text || text.length < 30) {
          await db.updateTable('candidates')
            .set({ parse_status: 'failed', parse_error: 'No extractable text', updated_at: new Date() })
            .where('id', '=', c.id)
            .execute()
          failed++
          continue
        }

        const parsed = parseResumeRegex(text)

        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFile = c.source_file ? extractNameFromFilename(c.source_file) : undefined
          if (nameFromFile) candidateName = nameFromFile
        }
        if (!candidateName || !isValidPersonName(candidateName)) {
          candidateName = c.name || 'Unknown'
        }

        const quality = computeDataQuality(parsed as any)
        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
languages: JSON.stringify(parsed.languages),
           data_quality_score: quality.quality_score,
           missing_fields: quality.missing_fields,
           industry: industryResult.industry,
           region: regionResult,
           parse_status: 'completed',
           parse_error: null,
           updated_at: new Date(),
          })
          .where('id', '=', c.id)
          .execute()

        reExtracted++
        if (reExtracted % 10 === 0) console.log(`[Reprocess] Re-extracted ${reExtracted}/${withoutRawText.length} (failed: ${failed})`)
      } catch (err) {
        failed++
        console.error(`[Reprocess] Failed re-extracting ${c.id} (${c.name}): ${err}`)
      }
    }
    console.log(`[Reprocess] Phase 2 done: ${reExtracted} re-extracted, ${failed} total failed`)
  }

  console.log(`[Reprocess] ALL DONE: ${reParsed} re-parsed, ${reExtracted} re-extracted, ${failed} failed`)
}

// ─── Sync All JDs from Cloudinary ────────────────────────────

uploadRouter.post('/sync-jds', async (req: Request, res: Response) => {
  // Disabled: JDs must be uploaded or created by an authenticated user.
  return res.status(410).json({ synced: 0, skipped: 0, failed: 0, total: 0, message: 'Cloudinary JD sync is disabled. Upload or create a job from the application.' })

  /*
  try {
    const folder = req.body.folder || 'candidates/JDs'

    // 1. List all files in Cloudinary folder
    const files = await listCloudinaryFolder(folder, 200)
    console.log(`[JD Sync] Found ${files.length} files in Cloudinary folder: ${folder}`)

    if (files.length === 0) {
      return res.json({ synced: 0, skipped: 0, failed: 0, total: 0, message: `No files found in folder: ${folder}` })
    }

    // 2. Check which ones are already ingested (by raw_text containing the public_id)
    const existingJobs = await db.selectFrom('jobs')
      .select(['id', 'role', 'raw_text'])
      .execute()

    let synced = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    // 3. Process each file
    for (const file of files) {
      const url = file.secure_url
      const publicId = file.public_id

      // Skip already-ingested (check by public_id in description or raw_text)
      const alreadyExists = existingJobs.some(j => j.raw_text?.includes(publicId) || j.role?.includes(publicId.split('/').pop()?.replace(/\.\w+$/, '') || ''))
      if (alreadyExists) {
        skipped++
        continue
      }

      try {
        const jobId = randomUUID()
        const now = new Date()

        // Store job (processing)
        await db.insertInto('jobs').values({
          id: jobId,
          role: 'Processing...',
          status: 'open',
          required_skills: [],
          nice_to_have_skills: [],
          avoid_skills: [],
          created_at: now,
          updated_at: now,
        }).execute()

        // Fetch file from Cloudinary
        const fileBuffer = await fetchFromCloudinary(url, publicId)

        // Detect mimetype
        const mimetype = detectMimetype(publicId)

        // Extract text
        const text = await extractTextFromBuffer(fileBuffer, mimetype)

        // Build StructuredDocument
        const doc = {
          plainText: text,
          markdown: text,
          sections: [{ name: 'jd', content: text }],
          tables: [],
          metadata: { fileName: publicId, mimeType: mimetype, fileSize: fileBuffer.length },
        }

        // Run full pipeline: Docling → Job Intelligence → Embedding → Qdrant → Matching → AI Evaluation
        await runFullJobPipeline(jobId, doc)

        synced++
        console.log(`[JD Sync] Ingested: ${publicId} (${jobId})`)
      } catch (error) {
        failed++
        const errMsg = `${publicId}: ${String(error)}`
        errors.push(errMsg)
        console.error(`[JD Sync] Failed:`, errMsg)
      }
    }

    res.json({ synced, skipped, failed, total: files.length, errors })
  } catch (error) {
    console.error('[JD Sync] Error:', error)
    res.status(500).json({ error: String(error) })
  }
  */
})

// ─── List Cloudinary Files ────────────────────────────────────

uploadRouter.get('/cloudinary-files', async (req: Request, res: Response) => {
  try {
    const folder = (req.query.folder as string) || 'candidates/Resumes'
    const files = await listCloudinaryFolder(folder, 200)

    // Mark which ones are already ingested
    const existing = await db.selectFrom('candidates')
      .select('source_file')
      .execute()
    const existingUrls = new Set(existing.map(e => e.source_file))

    const filesWithStatus = files.map(f => ({
      ...f,
      ingested: existingUrls.has(f.secure_url),
    }))

    res.json({ folder, count: files.length, files: filesWithStatus })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Upload Resumes (base64) — Async Processing ────────────────
// Returns immediately. Files are processed in background.
// Frontend polls processing status for progress.

uploadRouter.post('/resumes', async (req: Request, res: Response) => {
  try {
    const { files } = req.body as { files: Array<{ name: string, buffer: string, mimetype: string }> }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' })
    }

    // Check for existing candidates by filename for dedup
    const existingCandidates = await db.selectFrom('candidates')
      .select(['name', 'source_file', 'email'])
      .where('created_by_id', '=', req.auth!.id)
      .execute()
    const existingFiles = new Set(existingCandidates.map(c => c.source_file?.toLowerCase().trim()).filter(Boolean))

    // Filter out duplicates and create placeholder candidates IMMEDIATELY
    const filesToProcess: Array<{ candidateId: string, name: string, buffer: string, mimetype: string }> = []
    let skipped = 0

    for (const file of files) {
      if (existingFiles.has(file.name.toLowerCase().trim())) {
        console.log(`[Upload] Skipping duplicate file: ${file.name}`)
        skipped++
        continue
      }

      const candidateId = randomUUID()
      const now = new Date()

      await db.insertInto('candidates').values({
        id: candidateId,
        organization_id: req.auth!.organizationId,
        created_by_id: req.auth!.id,
        name: 'Processing...',
        source_file: file.name,
        parse_status: 'processing',
        created_at: now,
        updated_at: now,
      }).execute()

      filesToProcess.push({ candidateId, name: file.name, buffer: file.buffer, mimetype: file.mimetype })
    }

    // Respond IMMEDIATELY — don't wait for processing
    const candidateIds = filesToProcess.map(f => f.candidateId)
    res.json({ uploaded: filesToProcess.length, failed: 0, skipped, errors: [], processing: filesToProcess.length > 0, candidateIds })

    // Process files in background (fire and forget)
    if (filesToProcess.length > 0) {
      processFilesInBackground(filesToProcess, existingCandidates)
    }
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Background File Processor ─────────────────────────────────

async function processFilesInBackground(
  files: Array<{ candidateId: string, name: string, buffer: string, mimetype: string }>,
  existingCandidates: Array<{ name: string | null, source_file: string | null, email: string | null }>,
) {
  const existingNames = new Set(existingCandidates.map(c => c.name?.toLowerCase().trim()).filter(Boolean))
  const existingEmails = new Set(existingCandidates.map(c => c.email?.toLowerCase().trim()).filter(Boolean))

  // Check pdftext health once for the whole batch
  let diAvailable = await checkDocumentIntelligenceHealth()
  if (!diAvailable) {
    console.log(`[Upload] pdftext is down, attempting auto-restart...`)
    await ensureDocumentIntelligenceRunning()
    diAvailable = await checkDocumentIntelligenceHealth()
  }

  for (const file of files) {
    let { candidateId, name: fileName, buffer: b64Buffer, mimetype } = file

    try {
      const buffer = Buffer.from(b64Buffer, 'base64')
      const detectedMimetype = detectMimetype(fileName)
      if (!mimetype || mimetype === 'application/octet-stream' || detectedMimetype !== 'application/octet-stream') {
        mimetype = detectedMimetype
      }

      // ── TEXT EXTRACTION: pdftext best, fallback to extraction ──
      let text = ''
      if (diAvailable) {
        try {
          const diResult = await extractWithDocumentIntelligence(buffer, mimetype, fileName)
          if (diResult.text.length > 50) {
            text = diResult.text
            console.log(`[Upload] pdftext extracted: ${fileName} — ${text.length} chars`)
          }
        } catch (diErr) {
          console.warn(`[Upload] pdftext failed for ${fileName}: ${diErr}`)
        }
      }
      if (!text) {
        text = await extractTextFromBuffer(buffer, mimetype)
      }

      // ── FIELD PARSING: hybrid AI + regex ──
      const parsed = await parseResume(text)

      let candidateName = parsed.name
      if (!isValidPersonName(candidateName)) {
        const nameFromFilename = extractNameFromFilename(fileName)
        if (nameFromFilename) candidateName = nameFromFilename
      }
      if (!isValidPersonName(candidateName) && text) {
        const textName = findNameFromResumeText(text)
        if (textName) candidateName = textName
      }

      if (!isValidPersonName(candidateName)) {
        throw new Error('Could not identify a valid candidate name')
      }

      const hasProfileData = Boolean(
        parsed.email || parsed.phone || parsed.linkedin_url || parsed.github_url ||
        parsed.headline || parsed.summary || parsed.skills.length ||
        parsed.work_history.length || parsed.education.length || parsed.projects.length,
      )
      if (!hasProfileData) {
        throw new Error('Resume text was extracted, but no candidate profile data could be identified')
      }

      const quality = computeDataQuality(parsed as any)
      const skillNames = parsed.skills.map((s: any) => s.name || s)
      const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
      const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
      const regionResult = classifyRegion(parsed.location || '')

      await db.updateTable('candidates')
        .set({
          name: candidateName,
          email: parsed.email,
          phone: parsed.phone,
          linkedin_url: parsed.linkedin_url,
          github_url: parsed.github_url,
          portfolio_url: parsed.portfolio_url,
          headline: parsed.headline,
          location: parsed.location,
          summary: parsed.summary,
          experience_years: parsed.experience_years,
          skills: JSON.stringify(parsed.skills),
          companies: JSON.stringify(parsed.companies),
          work_history: JSON.stringify(parsed.work_history),
          education: JSON.stringify(parsed.education),
          projects: JSON.stringify(parsed.projects),
          certifications: JSON.stringify(parsed.certifications),
languages: JSON.stringify(parsed.languages),
           data_quality_score: quality.quality_score,
          missing_fields: quality.missing_fields,
          industry: industryResult.industry,
          region: regionResult,
          parse_status: 'completed',
          parse_error: null,
          updated_at: new Date(),
})
         .where('id', '=', candidateId)
         .execute()

       // Store raw_text in documents table
       try {
         const { insertDocument } = await import('../db/documents.js')
         await insertDocument(candidateId, 'candidate', 'raw_text', text)
       } catch {}

       // Generate embeddings
      try {
        const skillsText = parsed.skills.map((s: any) => s.name).join(' ')
        const roleText = parsed.headline || parsed.companies[0]?.title || ''
        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])
await deleteEmbeddings(candidateId)
	           const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'full_text')
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'skills')
	           await insertEmbeddingsMetadata(candidateId, embedDim, 'role')
	           await indexCandidateToQdrant({
          candidateId,
          name: candidateName,
          fullVector: fullVec,
          skills: skillNames,
          headline: parsed.headline || undefined,
          location: parsed.location || undefined,
          experienceYears: parsed.experience_years || undefined,
          industry: industryResult.industry || undefined,
        })
      } catch {}

      console.log(`[Upload] ${candidateName} — q=${quality.quality_score} skills=${skillNames.length} work=${parsed.work_history.length} edu=${parsed.education.length}`)

      // Post-pipeline duplicate check
      try {
        const row = await pool.query(`SELECT email, name FROM candidates WHERE id = $1`, [candidateId])
        const r = row.rows[0]
        if (r?.email && existingEmails.has(r.email.toLowerCase().trim())) {
          console.log(`[Upload] Duplicate email found: ${r.email} — deleting ${candidateId}`)
          await pool.query(`DELETE FROM embeddings WHERE entity_id = $1`, [candidateId])
          await pool.query(`DELETE FROM processing_status WHERE entity_id = $1`, [candidateId])
          await db.deleteFrom('candidates').where('id', '=', candidateId).execute()
          continue
        }
        if (r?.name && existingNames.has(r.name.toLowerCase().trim()) && !r.email) {
          console.log(`[Upload] Duplicate name (no email): ${r.name} — deleting ${candidateId}`)
          await pool.query(`DELETE FROM embeddings WHERE entity_id = $1`, [candidateId])
          await pool.query(`DELETE FROM processing_status WHERE entity_id = $1`, [candidateId])
          await db.deleteFrom('candidates').where('id', '=', candidateId).execute()
          continue
        }
      } catch {}

    } catch (error) {
      console.error(`[Upload] Failed to process ${fileName}: ${error}`)
      try {
        await db.updateTable('candidates')
          .set({
            name: `Failed: ${String(error).slice(0, 50)}`,
            parse_status: 'failed',
            parse_error: String(error).slice(0, 500),
            updated_at: new Date(),
          })
          .where('id', '=', candidateId)
          .execute()
      } catch {}
    }
  }

  console.log(`[Upload] Background processing complete for ${files.length} files`)
}

// ─── Re-parse a Single Candidate ──────────────────────────────

uploadRouter.post('/reparse/:id', async (req: Request<{id: string}>, res: Response) => {
  try {
    const candidateId = req.params.id

    const candidate = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
      .where('id', '=', candidateId)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    if (!candidate.source_file) {
      return res.status(400).json({ error: 'No source file for this candidate' })
    }

    console.log(`[Reparse] Re-parsing candidate: ${candidate.name} (${candidate.source_file})`)

    // Extract public_id from URL for Cloudinary archive download
    const publicId = extractPublicIdFromUrl(candidate.source_file)
    if (!publicId) {
      return res.status(400).json({ error: 'Could not extract public_id from source URL' })
    }

    // Fetch file from Cloudinary
    const pdfBuffer = await fetchFromCloudinary(candidate.source_file, publicId)

    // Detect mimetype
    const mimetype = detectMimetype(candidate.source_file)

    // Extract text
    const text = await extractTextFromBuffer(pdfBuffer, mimetype)

    // Parse resume
    const parsed = await parseResume(text)

    // Name fallback from filename
    let candidateName = parsed.name
    if (!isValidPersonName(candidateName)) {
      const nameFromFilename = extractNameFromFilename(candidate.source_file)
      if (nameFromFilename) {
        candidateName = nameFromFilename
        console.log(`[Reparse] Name fallback: "${parsed.name}" → "${candidateName}"`)
      }
    }

    // Generate embeddings
    const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
    const skillsText = parsed.skills.map(s => s.name).join(' ')
    const roleText = parsed.headline || parsed.companies[0]?.title || ''

    const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Compute data quality
        const quality = computeDataQuality(parsed as any)

        // Classify industry and region
        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        // Update candidate
        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
        certifications: JSON.stringify(parsed.certifications),
        languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            industry: industryResult.industry,
            region: regionResult,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidateId)
          .execute()

        // Store raw_text in documents table instead of candidates
        try {
          const { insertDocument } = await import('../db/documents.js')
          await insertDocument(candidateId, 'candidate', 'raw_text', text)
        } catch {}

        // Delete old embeddings and insert new ones (raw SQL to avoid FK issue)
        await deleteEmbeddings(candidateId)
        const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
        await insertEmbeddingsMetadata(candidateId, embedDim, 'full_text')
        await insertEmbeddingsMetadata(candidateId, embedDim, 'skills')
        await insertEmbeddingsMetadata(candidateId, embedDim, 'role')
        await indexCandidateToQdrant({
      candidateId,
      name: candidateName,
      fullVector: fullVec,
      skills: skillNames,
      headline: parsed.headline || undefined,
      location: parsed.location || undefined,
      experienceYears: parsed.experience_years || undefined,
      industry: industryResult.industry || undefined,
    })

    // Re-match against all jobs
    await matchCandidateToAllJobs(candidateId)

    console.log(`[Reparse] Done: ${candidateName}`)
    res.json({ success: true, name: candidateName })
  } catch (error) {
    console.error('[Reparse] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Re-parse All Bad Candidates ──────────────────────────────

uploadRouter.post('/reparse-bad-names', async (_req: Request, res: Response) => {
  try {
    const badCandidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
      .where((eb) =>
        eb.or([
          eb('name', '=', 'WORK EXPERIENCE'),
          eb('name', '=', 'Professional Summary'),
          eb('name', '=', 'Professional Summary-'),
          eb('name', '=', 'Summer Internship  Training'),
          eb('name', '=', 'Summer Internship Training'),
          eb('name', 'like', 'Processing%'),
          eb('parse_status', '=', 'processing'),
        ])
      )
      .execute()

    console.log(`[Reparse] Found ${badCandidates.length} candidates to re-parse`)

    const results: Array<{ id: string; oldName: string; newName: string; success: boolean; error?: string }> = []

    for (const candidate of badCandidates) {
      try {
        if (!candidate.source_file) {
          results.push({ id: candidate.id, oldName: candidate.name, newName: '', success: false, error: 'No source file' })
          continue
        }

        console.log(`[Reparse] Processing: ${candidate.name} (${candidate.source_file})`)

        // Extract public_id from URL for Cloudinary archive download
        const publicId = extractPublicIdFromUrl(candidate.source_file)
        if (!publicId) {
          results.push({ id: candidate.id, oldName: candidate.name, newName: '', success: false, error: 'Could not extract public_id' })
          continue
        }

        // Fetch file
        const pdfBuffer = await fetchFromCloudinary(candidate.source_file, publicId)

        // Detect mimetype
        const mimetype = detectMimetype(candidate.source_file)

        // Extract text (may fail for .doc files)
        let text: string
        try {
          text = await extractTextFromBuffer(pdfBuffer, mimetype)
        } catch (extractError) {
          // For unparseable files (e.g. old .doc), just fix the name from filename
          const nameFromFilename = extractNameFromFilename(candidate.source_file)
          if (nameFromFilename) {
            await db.updateTable('candidates')
              .set({ name: nameFromFilename, parse_status: 'completed', parse_error: `Text extraction failed: ${String(extractError)}`, updated_at: new Date() })
              .where('id', '=', candidate.id)
              .execute()
            results.push({ id: candidate.id, oldName: candidate.name, newName: nameFromFilename, success: true })
            console.log(`[Reparse] Name-only fix: "${candidate.name}" → "${nameFromFilename}" (text extraction failed)`)
          } else {
            results.push({ id: candidate.id, oldName: candidate.name, newName: '', success: false, error: String(extractError) })
          }
          continue
        }

        // Parse
        const parsed = await parseResume(text)

        // Name fallback
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(candidate.source_file)
          if (nameFromFilename) candidateName = nameFromFilename
        }

        // Generate embeddings
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
        const skillsText = parsed.skills.map(s => s.name).join(' ')
        const roleText = parsed.headline || parsed.companies[0]?.title || ''

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Compute data quality
        const quality = computeDataQuality(parsed as any)

        // Update candidate
        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
            languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute()

        // Store raw_text in documents table instead of candidates
        try {
          const { insertDocument } = await import('../db/documents.js')
          await insertDocument(candidate.id, 'candidate', 'raw_text', text)
        } catch {}

        // Update embeddings (raw SQL to avoid FK issue)
        await deleteEmbeddings(candidate.id)

        const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
        await insertEmbeddingsMetadata(candidate.id, embedDim, 'full_text')
        await insertEmbeddingsMetadata(candidate.id, embedDim, 'skills')
        await insertEmbeddingsMetadata(candidate.id, embedDim, 'role')

        // Index into Qdrant for semantic search
        await indexCandidateToQdrant({
          candidateId: candidate.id,
          name: candidateName,
          fullVector: fullVec,
          skills: parsed.skills.map((s: any) => s.name || s),
          headline: parsed.headline || undefined,
          location: parsed.location || undefined,
          experienceYears: parsed.experience_years || undefined,
        })

        // Re-match
        await matchCandidateToAllJobs(candidate.id)

        results.push({ id: candidate.id, oldName: candidate.name, newName: candidateName, success: true })
        console.log(`[Reparse] Fixed: "${candidate.name}" → "${candidateName}"`)
      } catch (error) {
        results.push({ id: candidate.id, oldName: candidate.name, newName: '', success: false, error: String(error) })
        console.error(`[Reparse] Failed for ${candidate.name}:`, error)
      }
    }

    res.json({ total: badCandidates.length, results })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Cleanup Stuck Processing Candidates ─────────────────────

uploadRouter.post('/cleanup-stuck', async (_req: Request, res: Response) => {
  try {
    // Find candidates stuck in 'processing' for > 5 minutes
    const stuck = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'parse_status', 'updated_at'])
      .where('parse_status', '=', 'processing')
      .where('updated_at', '<', new Date(Date.now() - 5 * 60 * 1000))
      .execute()

    console.log(`[Cleanup] Found ${stuck.length} stuck candidates`)

    let fixed = 0
    let failedCleanup = 0

    for (const c of stuck) {
      try {
        // If they have raw_text, try to re-parse
        if (c.raw_text && c.raw_text.trim().length > 50) {
          const parsed = await parseResume(c.raw_text)
          let candidateName = parsed.name
          if (!isValidPersonName(candidateName) && c.source_file) {
            const nameFromFilename = extractNameFromFilename(c.source_file)
            if (nameFromFilename) candidateName = nameFromFilename
          }

          const quality = computeDataQuality(parsed as any)
          await db.updateTable('candidates')
            .set({
              name: candidateName,
              email: parsed.email,
              phone: parsed.phone,
              linkedin_url: parsed.linkedin_url,
              github_url: parsed.github_url,
              portfolio_url: parsed.portfolio_url,
              headline: parsed.headline,
              location: parsed.location,
              summary: parsed.summary,
              experience_years: parsed.experience_years,
              skills: JSON.stringify(parsed.skills),
              companies: JSON.stringify(parsed.companies),
              work_history: JSON.stringify(parsed.work_history),
              education: JSON.stringify(parsed.education),
              projects: JSON.stringify(parsed.projects),
              certifications: JSON.stringify(parsed.certifications),
              languages: JSON.stringify(parsed.languages),
              data_quality_score: quality.quality_score,
              missing_fields: quality.missing_fields,
              parse_status: 'completed',
              parse_error: null,
              updated_at: new Date(),
            })
            .where('id', '=', c.id)
            .execute()

          await matchCandidateToAllJobs(c.id).catch(() => {})
          fixed++
          console.log(`[Cleanup] Fixed: ${c.id} → "${candidateName}"`)
        } else {
          // No raw_text — mark as failed
          await db.updateTable('candidates')
            .set({
              name: 'Failed: no raw text available',
              parse_status: 'failed',
              parse_error: 'Stuck in processing with no extractable text',
              updated_at: new Date(),
            })
            .where('id', '=', c.id)
            .execute()
          failedCleanup++
        }
      } catch (error) {
        // Mark as failed
        await db.updateTable('candidates')
          .set({
            name: `Failed: ${String(error).slice(0, 50)}`,
            parse_status: 'failed',
            parse_error: String(error).slice(0, 500),
            updated_at: new Date(),
          })
          .where('id', '=', c.id)
          .execute()
        failedCleanup++
      }
    }

    res.json({ stuck: stuck.length, fixed, failed: failedCleanup })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Fix All Bad Names (fast, from existing raw_text) ────────

uploadRouter.post('/fix-names', async (_req: Request, res: Response) => {
  try {
    const badNames = ['Unknown', 'Links', 'CONTACT', 'LINK']
    const badCandidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
      .where((eb) =>
        eb.or([
          eb('name', '=', 'Unknown'),
          eb('name', 'like', 'Processing%'),
          eb('name', 'like', 'Failed%'),
          eb('name', 'like', '%.pdf'),
          eb('name', 'like', '%.docx'),
          eb('name', 'like', '%.doc'),
          eb('name', '=', 'Links'),
          eb('name', '=', 'CONTACT'),
          eb('name', '=', 'LINK'),
        ])
      )
      .execute()

    console.log(`[FixNames] Found ${badCandidates.length} candidates with bad names`)

    let fixed = 0
    let failedFix = 0

    for (const c of badCandidates) {
      try {
        if (!c.raw_text || c.raw_text.trim().length < 50) {
          // No raw text — try filename
          if (c.source_file) {
            const nameFromFilename = extractNameFromFilename(c.source_file)
            if (nameFromFilename) {
              await db.updateTable('candidates')
                .set({ name: nameFromFilename, updated_at: new Date() })
                .where('id', '=', c.id)
                .execute()
              fixed++
              console.log(`[FixNames] Name-only fix: "${c.name}" → "${nameFromFilename}"`)
              continue
            }
          }
          failedFix++
          continue
        }

        const parsed = await parseResume(c.raw_text)
        let candidateName = parsed.name

        if (!isValidPersonName(candidateName) && c.source_file) {
          const nameFromFilename = extractNameFromFilename(c.source_file)
          if (nameFromFilename) candidateName = nameFromFilename
        }

        if (candidateName && candidateName !== 'Unknown') {
          // Update all fields, not just name
          const quality = computeDataQuality(parsed as any)
          await db.updateTable('candidates')
            .set({
              name: candidateName,
              email: parsed.email,
              phone: parsed.phone,
              linkedin_url: parsed.linkedin_url,
              github_url: parsed.github_url,
              portfolio_url: parsed.portfolio_url,
              headline: parsed.headline,
              location: parsed.location,
              summary: parsed.summary,
              experience_years: parsed.experience_years,
              skills: JSON.stringify(parsed.skills),
              companies: JSON.stringify(parsed.companies),
              work_history: JSON.stringify(parsed.work_history),
              education: JSON.stringify(parsed.education),
              projects: JSON.stringify(parsed.projects),
              certifications: JSON.stringify(parsed.certifications),
              languages: JSON.stringify(parsed.languages),
              data_quality_score: quality.quality_score,
              missing_fields: quality.missing_fields,
              updated_at: new Date(),
            })
            .where('id', '=', c.id)
            .execute()
          fixed++
          console.log(`[FixNames] Fixed: "${c.name}" → "${candidateName}"`)
        } else {
          failedFix++
        }
      } catch (error) {
        failedFix++
      }
    }

    res.json({ total: badCandidates.length, fixed, failed: failedFix })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Sync JDs from Cloudinary CSV ─────────────────────────────
// Fetches jds_master.csv from Cloudinary, parses each row, and
// runs AI JD parsing + embedding + matching for each

uploadRouter.post('/sync-jds-csv', async (req: Request, res: Response) => {
  // Disabled: JDs must be uploaded or created by an authenticated user.
  return res.status(410).json({ synced: 0, skipped: 0, failed: 0, total: 0, message: 'Cloudinary JD CSV sync is disabled. Upload or create a job from the application.' })

  /*
  try {
    const folder = req.body.folder || 'jds'
    const filename = req.body.filename || 'jds_master.csv'

    // 1. List files in the JDs folder
    const files = await listCloudinaryFolder(folder, 100)
    console.log(`[JD Sync] Found ${files.length} files in folder: ${folder}`)

    // Find the CSV file
    const csvFile = files.find(f => f.public_id.endsWith(filename) || f.public_id.includes(filename.replace('.csv', '')))
    if (!csvFile) {
      return res.status(404).json({ error: `CSV file not found in folder: ${folder}/${filename}` })
    }

    console.log(`[JD Sync] Using CSV: ${csvFile.public_id}`)

    // 2. Fetch CSV from Cloudinary
    const csvBuffer = await fetchFromCloudinary(csvFile.secure_url, csvFile.public_id)
    const csvText = csvBuffer.toString('utf-8')

    // 3. Parse CSV
    const rows = parseCSV(csvText)
    const jds = convertToJDs(rows)
    console.log(`[JD Sync] Parsed ${jds.length} JDs from CSV`)

    // 4. Check existing jobs by zoho_job_id
    const existingJobs = await db.selectFrom('jobs')
      .select(['id', 'role'])
      .execute()
    // We'll match by role title since zoho_job_id isn't stored yet
    const existingRoles = new Set(existingJobs.map(j => j.role.toLowerCase()))

    let synced = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    // 5. Process each JD
    for (const jd of jds) {
      try {
        // Skip test/empty JDs
        if (jd.job_title.toLowerCase().startsWith('test') && jd.job_description.length < 50) {
          skipped++
          continue
        }

        // Skip duplicates by role title
        if (existingRoles.has(jd.job_title.toLowerCase())) {
          skipped++
          continue
        }

        const jobId = randomUUID()

        // Create job record
        await db.insertInto('jobs').values({
          id: jobId,
          role: jd.job_title,
          company: jd.industry || null,
          location: jd.region_preference || null,
          required_skills: jd.required_skills,
          nice_to_have_skills: [],
          avoid_skills: [],
          experience_min: parseExperienceMin(jd.work_experience),
          experience_max: parseExperienceMax(jd.work_experience),
          description: jd.job_description,
          raw_text: jd.job_description,
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        }).execute()

        // Build StructuredDocument from CSV data
        const doc = {
          plainText: jd.job_description,
          markdown: jd.job_description,
          sections: [{ name: 'jd', content: jd.job_description }],
          tables: [],
          metadata: { fileName: `csv-${jd.job_title}`, mimeType: 'text/csv', fileSize: jd.job_description.length },
        }

        // Run full pipeline: Docling → Job Intelligence → Embedding → Qdrant → Matching → AI Evaluation
        await runFullJobPipeline(jobId, doc)

        existingRoles.add(jd.job_title.toLowerCase())
        synced++
        console.log(`[JD Sync] Ingested: ${jd.job_title} (${jobId})`)
      } catch (error) {
        failed++
        const errMsg = `${jd.job_title}: ${String(error)}`
        errors.push(errMsg)
        console.error(`[JD Sync] Failed:`, errMsg)
      }
    }

    res.json({ synced, skipped, failed, total: jds.length, errors })
  } catch (error) {
    console.error('[JD Sync] Error:', error)
    res.status(500).json({ error: String(error) })
  }
  */
})

// ─── Experience Parsing Helpers ───────────────────────────────

function parseExperienceMin(exp: string | null): number | null {
  if (!exp) return null
  const match = exp.match(/(\d+)/)
  return match ? parseInt(match[1]) : null
}

function parseExperienceMax(exp: string | null): number | null {
  if (!exp) return null
  // "5-8 years" → 8, "1-3 years" → 3, "Fresher" → 0
  if (exp.toLowerCase().includes('fresher')) return 0
  const match = exp.match(/(\d+)\s*[-–]\s*(\d+)/)
  return match ? parseInt(match[2]) : parseExperienceMin(exp)
}

// ─── Re-parse ALL Candidates (bulk) ───────────────────────────
// Re-fetches each candidate's file from Cloudinary, re-parses with
// improved AI prompt, and updates the DB + embeddings

uploadRouter.post('/reparse-all', async (req: Request, res: Response) => {
  try {
    const candidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status', 'source'])
      .where('parse_status', '=', 'completed')
      .where('source_file', 'is not', null)
      .orderBy('created_at', 'asc')
      .execute()

    console.log(`[Reparse All] Starting re-parse of ${candidates.length} candidates`)

    const limit = (req.body.limit as number) || candidates.length
    const regexOnly = req.body.regexOnly === true || req.body.regexOnly === 'true'
    const results: Array<{ id: string; name: string; success: boolean; error?: string }> = []
    let processed = 0

    console.log(`[Reparse All] Mode: ${regexOnly ? 'REGEX ONLY (no AI)' : 'Hybrid (regex + AI)'}`)

    for (const candidate of candidates) {
      if (processed >= limit) break
      if (!candidate.source_file) continue

      try {
        const publicId = extractPublicIdFromUrl(candidate.source_file)
        if (!publicId) {
          results.push({ id: candidate.id, name: candidate.name, success: false, error: 'No public_id' })
          continue
        }

        console.log(`[Reparse All] (${processed + 1}/${limit}) Re-parsing: ${candidate.name}`)

        // Fetch file from Cloudinary
        const fileBuffer = await fetchFromCloudinary(candidate.source_file, publicId)

        // Detect mimetype
        const mimetype = detectMimetype(candidate.source_file)

        // Extract text
        let text: string
        try {
          text = await extractTextFromBuffer(fileBuffer, mimetype)
        } catch {
          results.push({ id: candidate.id, name: candidate.name, success: false, error: 'Text extraction failed' })
          continue
        }

        // Parse with improved AI prompt
        const parsed = regexOnly ? parseResumeRegex(text) : await parseResume(text)

        // Name fallback
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(candidate.source_file)
          if (nameFromFilename) candidateName = nameFromFilename
        }

        // Generate embeddings
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
        const skillsText = parsed.skills.map(s => s.name).join(' ')
        const roleText = parsed.headline || parsed.companies[0]?.title || ''

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Compute data quality
        const quality = computeDataQuality(parsed as any)

        // Update candidate
        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
languages: JSON.stringify(parsed.languages),
             data_quality_score: quality.quality_score,
             missing_fields: quality.missing_fields,
             parse_status: 'completed',
             updated_at: new Date(),
           })
           .where('id', '=', candidate.id)
           .execute()

         // Store raw_text in documents table
         try {
           const { insertDocument } = await import('../db/documents.js')
           await insertDocument(candidate.id, 'candidate', 'raw_text', text)
         } catch {}

         // Update embeddings (raw SQL)
        await deleteEmbeddings(candidate.id)
const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'full_text')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'skills')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'role')

        // Index into Qdrant for semantic search
        await indexCandidateToQdrant({
          candidateId: candidate.id,
          name: candidateName,
          fullVector: fullVec,
          skills: parsed.skills.map((s: any) => s.name || s),
          headline: parsed.headline || undefined,
          location: parsed.location || undefined,
          experienceYears: parsed.experience_years || undefined,
        })

        // Re-match against all jobs
        await matchCandidateToAllJobs(candidate.id)

        results.push({ id: candidate.id, name: candidateName, success: true })
        processed++

        // Small delay to avoid rate limits
        if (processed < limit) {
          await new Promise(r => setTimeout(r, 500))
        }
      } catch (error) {
        results.push({ id: candidate.id, name: candidate.name, success: false, error: String(error) })
        console.error(`[Reparse All] Failed: ${candidate.name}:`, error)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    console.log(`[Reparse All] Done: ${successCount} succeeded, ${failCount} failed`)

    res.json({ total: candidates.length, processed: limit, success: successCount, failed: failCount, results })
  } catch (error) {
    console.error('[Reparse All] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Fast Re-parse from Stored raw_text ─────────────────────────
// Uses raw_text already in DB, no Cloudinary download needed

uploadRouter.post('/reparse-fast', async (req: Request, res: Response) => {
  try {
    const candidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
      .where('parse_status', '=', 'completed')
      .where('raw_text', 'is not', null)
      .orderBy('created_at', 'asc')
      .execute()

    console.log(`[Reparse Fast] Starting re-parse of ${candidates.length} candidates from stored raw_text`)

    const limit = (req.body.limit as number) || candidates.length
    const regexOnly = req.body.regexOnly === true || req.body.regexOnly === 'true'
    const skipEmbeddings = req.body.skipEmbeddings === true || req.body.skipEmbeddings === 'true'
    const results: Array<{ id: string; name: string; success: boolean; error?: string }> = []
    let processed = 0

    console.log(`[Reparse Fast] Mode: ${regexOnly ? 'REGEX ONLY' : 'Hybrid'}, Skip embeddings: ${skipEmbeddings}`)

    for (const candidate of candidates) {
      if (processed >= limit) break
      if (!candidate.raw_text) continue

      try {
        // Parse from stored raw_text
        const parsed = regexOnly ? parseResumeRegex(candidate.raw_text) : await parseResume(candidate.raw_text)

        // Name fallback
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(candidate.source_file || '')
          if (nameFromFilename) candidateName = nameFromFilename
        }

        // Compute data quality
        const quality = computeDataQuality(parsed as any)

        // Update candidate
        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
            languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute()

        // Update embeddings when not skipping
        if (!skipEmbeddings) {
          const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${candidate.raw_text}`
          const skillsText = parsed.skills.map(s => s.name).join(' ')
          const roleText = parsed.headline || parsed.companies[0]?.title || ''

          const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

          await deleteEmbeddings(candidate.id)
const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'full_text')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'skills')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'role')

          // Index into Qdrant for semantic search
          await indexCandidateToQdrant({
            candidateId: candidate.id,
            name: candidateName,
            fullVector: fullVec,
            skills: parsed.skills.map((s: any) => s.name || s),
            headline: parsed.headline || undefined,
            location: parsed.location || undefined,
            experienceYears: parsed.experience_years || undefined,
          })
        }

        // Re-match against all jobs (skip if skipEmbeddings)
        if (!skipEmbeddings) {
          await matchCandidateToAllJobs(candidate.id)
        }

        results.push({ id: candidate.id, name: candidateName, success: true })
        processed++
      } catch (error) {
        results.push({ id: candidate.id, name: candidate.name, success: false, error: String(error) })
        console.error(`[Reparse Fast] Failed: ${candidate.name}:`, error)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    console.log(`[Reparse Fast] Done: ${successCount} succeeded, ${failCount} failed`)

    res.json({ total: candidates.length, processed: limit, success: successCount, failed: failCount, results })
  } catch (error) {
    console.error('[Reparse Fast] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Groq-powered Re-parse (latest N candidates) ─────────────
// Uses Groq llama-3.3-70b for re-parsing — good accuracy, fast
// Accepts candidate IDs to reparse, or reparse latest N candidates

uploadRouter.post('/reparse-groq', async (req: Request, res: Response) => {
  try {
    const candidateIds: string[] | undefined = req.body.candidate_ids
    const limit = (req.body.limit as number) || 15

    let candidates
    if (candidateIds && candidateIds.length > 0) {
      candidates = await db.selectFrom('candidates')
        .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
        .where('id', 'in', candidateIds)
        .execute()
    } else {
      candidates = await db.selectFrom('candidates')
        .select(['id', 'name', 'source_file', 'resume_url', 'raw_text', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
        .where('parse_status', '=', 'completed')
        .where('raw_text', 'is not', null)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute()
    }

    console.log(`[Groq Reparse] Starting Groq re-parse of ${candidates.length} candidates`)

    const results: Array<{ id: string; name: string; success: boolean; error?: string }> = []
    let processed = 0

    for (const candidate of candidates) {
      if (!candidate.raw_text) continue

      try {
        console.log(`[Groq Reparse] (${processed + 1}/${candidates.length}) Re-parsing: ${candidate.name}`)

        const { parseResumeWithGroqOnly } = await import('../services/openai.js')
        const parsed = await parseResumeWithGroqOnly(candidate.raw_text)

        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(candidate.source_file || '')
          if (nameFromFilename) candidateName = nameFromFilename
        }

        const quality = computeDataQuality(parsed as any)

        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${candidate.raw_text}`
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        await db.updateTable('candidates')
          .set({
            name: candidateName,
            email: parsed.email,
            phone: parsed.phone,
            linkedin_url: parsed.linkedin_url,
            github_url: parsed.github_url,
            portfolio_url: parsed.portfolio_url,
            headline: parsed.headline,
            location: parsed.location,
            summary: parsed.summary,
            experience_years: parsed.experience_years,
            skills: JSON.stringify(parsed.skills),
            companies: JSON.stringify(parsed.companies),
            work_history: JSON.stringify(parsed.work_history),
            education: JSON.stringify(parsed.education),
            projects: JSON.stringify(parsed.projects),
            certifications: JSON.stringify(parsed.certifications),
            languages: JSON.stringify(parsed.languages),
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            industry: industryResult.industry,
            region: regionResult,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute()

        await deleteEmbeddings(candidate.id)

        const skillsText = parsed.skills.map(s => s.name).join(' ')
        const roleText = parsed.headline || parsed.companies[0]?.title || ''
        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'full_text')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'skills')
	           await insertEmbeddingsMetadata(candidate.id, embedDim, 'role')

        // Index into Qdrant for semantic search
        await indexCandidateToQdrant({
          candidateId: candidate.id,
          name: candidateName,
          fullVector: fullVec,
          skills: skillNames,
          headline: parsed.headline || undefined,
          location: parsed.location || undefined,
          experienceYears: parsed.experience_years || undefined,
          industry: industryResult?.industry || undefined,
        })

        await matchCandidateToAllJobs(candidate.id)

        results.push({ id: candidate.id, name: candidateName, success: true })
        processed++
        console.log(`[Groq Reparse] Done: "${candidate.name}" → "${candidateName}"`)

        if (processed < candidates.length) {
          await new Promise(r => setTimeout(r, 6000))
        }
      } catch (error) {
        results.push({ id: candidate.id, name: candidate.name, success: false, error: String(error) })
        console.error(`[Groq Reparse] Failed: ${candidate.name}:`, error)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    console.log(`[Groq Reparse] Done: ${successCount} succeeded, ${failCount} failed`)

    res.json({ total: candidates.length, processed: candidates.length, success: successCount, failed: failCount, results })
  } catch (error) {
    console.error('[Groq Reparse] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})
