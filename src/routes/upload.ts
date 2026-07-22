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
import { listCloudinaryFolder, fetchFromCloudinary } from '../services/cloudinary.js'
import { computeDataQuality } from '../scoring/data-quality.js'
import { classifyRegion } from '../services/region-classifier.js'
import { classifyIndustry } from '../services/industry-classifier.js'

export const uploadRouter = Router()

// ─── Extract name from Cloudinary filename ────────────────────
// Pattern: "654774000016534067_Esteban.pdf" → "Esteban"
// Pattern: "654774000016534067_Esteban.pdf.docx" → "Esteban"
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

async function insertEmbeddings(
  entityId: string,
  vectors: Array<{ purpose: string; vector: number[] }>,
  entityType: string = 'candidate'
): Promise<void> {
  for (const v of vectors) {
    await pool.query(
      `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
       VALUES ($1, $2, $3, $4, $5, 'text-embedding-3-small', NOW())
       ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $5, model = 'text-embedding-3-small'`,
      [randomUUID(), entityType, entityId, v.purpose, v.vector]
    )
  }
}

// ─── Sync All Resumes from Cloudinary ─────────────────────────

uploadRouter.post('/sync-cloudinary', async (req: Request, res: Response) => {
  try {
    const folder = req.body.folder || 'candidates/Resumes'

    // 1. List all files in Cloudinary folder
    const files = await listCloudinaryFolder(folder, 200)
    console.log(`[Sync] Found ${files.length} files in Cloudinary folder: ${folder}`)

    if (files.length === 0) {
      return res.json({ synced: 0, skipped: 0, failed: 0, message: `No files found in folder: ${folder}` })
    }

    // 2. Check which ones are already ingested (by source_file URL)
    const existing = await db.selectFrom('candidates')
      .select('source_file')
      .execute()
    const existingUrls = new Set(existing.map(e => e.source_file))

    let synced = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    // 3. Process each file
    for (const file of files) {
      const url = file.secure_url

      // Skip already-ingested
      if (existingUrls.has(url)) {
        skipped++
        continue
      }

      let candidateId = randomUUID()
      try {
        const now = new Date()

        // Store candidate (processing)
        await db.insertInto('candidates').values({
          id: candidateId,
          name: 'Processing...',
          source_file: url,
          resume_url: url,
          parse_status: 'processing',
          created_at: now,
          updated_at: now,
        }).execute()

        // Fetch file using signed URL
        const pdfBuffer = await fetchFromCloudinary(url, file.public_id)

        // Detect mimetype from file extension
        const mimetype = detectMimetype(file.public_id)

        // Extract text
        const text = await extractTextFromBuffer(pdfBuffer, mimetype)

        // Parse resume
        const parsed = await parseResume(text)

        // If AI parsing gave a bad name (section header), try filename fallback
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(file.public_id)
          if (nameFromFilename) {
            candidateName = nameFromFilename
            console.log(`[Sync] Name fallback: "${parsed.name}" → "${candidateName}" from ${file.public_id}`)
          }
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
            raw_text: text,
            resume_url: url,
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
          })
          .where('id', '=', candidateId)
          .execute()

        // Store embeddings (raw SQL to avoid FK constraint issue)
        await insertEmbeddings(candidateId, [
          { purpose: 'full_text', vector: fullVec },
          { purpose: 'skills', vector: skillsVec },
          { purpose: 'role', vector: roleVec },
        ])

        // Match against all jobs
        await matchCandidateToAllJobs(candidateId)

        synced++
        console.log(`[Sync] Ingested: ${parsed.name} from ${file.public_id}`)
      } catch (error) {
        failed++
        const errMsg = `${file.public_id}: ${String(error)}`
        errors.push(errMsg)
        console.error(`[Sync] Failed:`, errMsg)
        // Mark candidate as failed instead of leaving 'Processing...'
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

    res.json({ synced, skipped, failed, total: files.length, errors })
  } catch (error) {
    console.error('[Sync] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Sync All JDs from Cloudinary ────────────────────────────

uploadRouter.post('/sync-jds', async (req: Request, res: Response) => {
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

        // Parse JD
        const parsed = await parseJobDescription(text)

        // Generate embeddings
        const fullText = `${parsed.role} ${parsed.description || ''} ${parsed.required_skills.join(' ')} ${text}`
        const skillsText = parsed.required_skills.join(' ')
        const roleText = parsed.role

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Classify industry and region
        const industryResult = await classifyIndustry(fullText, parsed.required_skills, parsed.role)
        const regionResult = classifyRegion(parsed.location || '')

        // Update job with parsed data
        await db.updateTable('jobs')
          .set({
            role: parsed.role,
            company: parsed.company,
            location: parsed.location,
            required_skills: parsed.required_skills,
            nice_to_have_skills: parsed.nice_to_have_skills || [],
            avoid_skills: parsed.avoid_skills || [],
            experience_min: parsed.experience_min,
            experience_max: parsed.experience_max,
            description: parsed.description,
            raw_text: text,
            industry: industryResult.industry,
            region: regionResult,
          })
          .where('id', '=', jobId)
          .execute()

        // Store embeddings (raw SQL)
        for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
          await pool.query(
            `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
             VALUES ($1, 'job', $2, $3, $4, 'text-embedding-3-small', NOW())
             ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $4, model = 'text-embedding-3-small'`,
            [randomUUID(), jobId, purpose, vector]
          )
        }

        // Match against all candidates
        await matchJobToAllCandidates(jobId)

        synced++
        console.log(`[JD Sync] Ingested: ${parsed.role} from ${publicId}`)
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

// ─── Upload Resumes (base64) ──────────────────────────────────

uploadRouter.post('/resumes', async (req: Request, res: Response) => {
  // For file uploads, we expect multipart/form-data
  // Since we don't have multer configured, we'll handle base64 encoded files
  // or direct file buffer uploads

  try {
    const { files } = req.body as { files: Array<{ name: string, buffer: string, mimetype: string }> }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' })
    }

    let uploaded = 0
    let failed = 0
    const errors: string[] = []

    for (const file of files) {
      let candidateId = randomUUID()
      try {
        const now = new Date()

        // Store candidate (status: processing)
        await db.insertInto('candidates').values({
          id: candidateId,
          name: 'Processing...',
          source_file: file.name,
          parse_status: 'processing',
          created_at: now,
          updated_at: now,
        }).execute()

        // Extract text from buffer
        const buffer = Buffer.from(file.buffer, 'base64')
        const text = await extractTextFromBuffer(buffer, file.mimetype)

        // Parse resume
        const parsed = await parseResume(text)

        // If AI parsing gave a bad name, try filename fallback
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const nameFromFilename = extractNameFromFilename(file.name)
          if (nameFromFilename) {
            candidateName = nameFromFilename
          }
        }

        // Generate embeddings
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
        const skillsText = parsed.skills.map(s => s.name).join(' ')
        const roleText = parsed.headline || parsed.companies[0]?.title || ''

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Compute data quality
        const quality = computeDataQuality(parsed as any)

        // Update candidate with parsed data
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
            raw_text: text,
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
          })
          .where('id', '=', candidateId)
          .execute()

        // Store embeddings (raw SQL to avoid FK constraint issue)
        await insertEmbeddings(candidateId, [
          { purpose: 'full_text', vector: fullVec },
          { purpose: 'skills', vector: skillsVec },
          { purpose: 'role', vector: roleVec },
        ])

        // Match against all jobs
        await matchCandidateToAllJobs(candidateId)

        uploaded++
      } catch (error) {
        failed++
        errors.push(`${file.name}: ${String(error)}`)
        // Mark candidate as failed instead of leaving 'Processing...'
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

    res.json({ uploaded, failed, errors })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Re-parse a Single Candidate ──────────────────────────────

uploadRouter.post('/reparse/:id', async (req: Request<{id: string}>, res: Response) => {
  try {
    const candidateId = req.params.id

    const candidate = await db.selectFrom('candidates')
      .selectAll()
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
        raw_text: text,
        resume_url: candidate.source_file,
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

    // Delete old embeddings and insert new ones (raw SQL to avoid FK issue)
    await deleteEmbeddings(candidateId)

    await insertEmbeddings(candidateId, [
      { purpose: 'full_text', vector: fullVec },
      { purpose: 'skills', vector: skillsVec },
      { purpose: 'role', vector: roleVec },
    ])

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
      .selectAll()
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
            raw_text: text,
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
            parse_error: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute()

        // Update embeddings (raw SQL to avoid FK issue)
        await deleteEmbeddings(candidate.id)

        await insertEmbeddings(candidate.id, [
          { purpose: 'full_text', vector: fullVec },
          { purpose: 'skills', vector: skillsVec },
          { purpose: 'role', vector: roleVec },
        ])

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
      .selectAll()
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
      .selectAll()
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

        // Use AI to enhance the parsed data (better skill extraction, summary, etc.)
        let enhancedSkills = jd.required_skills
        let description = jd.job_description

        try {
          const aiParsed = await parseJobDescription(jd.job_description)
          // Merge AI-extracted skills with CSV skills
          const csvSkills = new Set(jd.required_skills.map(s => s.toLowerCase()))
          for (const skill of aiParsed.required_skills) {
            if (!csvSkills.has(skill.toLowerCase())) {
              enhancedSkills.push(skill)
            }
          }
          if (aiParsed.nice_to_have_skills?.length) {
            await db.updateTable('jobs')
              .set({ nice_to_have_skills: aiParsed.nice_to_have_skills })
              .where('id', '=', jobId)
              .execute()
          }
          if (aiParsed.avoid_skills?.length) {
            await db.updateTable('jobs')
              .set({ avoid_skills: aiParsed.avoid_skills })
              .where('id', '=', jobId)
              .execute()
          }
        } catch (aiError) {
          console.warn(`[JD Sync] AI parse failed for "${jd.job_title}", using CSV data:`, aiError)
        }

        // Update with enhanced skills
        await db.updateTable('jobs')
          .set({ required_skills: enhancedSkills })
          .where('id', '=', jobId)
          .execute()

        // Generate embeddings
        const fullText = `${jd.job_title} ${jd.industry || ''} ${jd.region_preference || ''} ${enhancedSkills.join(' ')} ${description}`
        const skillsText = enhancedSkills.join(' ')
        const roleText = jd.job_title

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        // Store embeddings (raw SQL)
        for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
          await pool.query(
            `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
             VALUES ($1, 'job', $2, $3, $4, 'text-embedding-3-small', NOW())
             ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $4, model = 'text-embedding-3-small'`,
            [randomUUID(), jobId, purpose, vector]
          )
        }

        // Match against all existing candidates
        await matchJobToAllCandidates(jobId)

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
      .selectAll()
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
            raw_text: text,
            data_quality_score: quality.quality_score,
            missing_fields: quality.missing_fields,
            parse_status: 'completed',
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute()

        // Update embeddings (raw SQL)
        await deleteEmbeddings(candidate.id)
        await insertEmbeddings(candidate.id, [
          { purpose: 'full_text', vector: fullVec },
          { purpose: 'skills', vector: skillsVec },
          { purpose: 'role', vector: roleVec },
        ])

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
      .selectAll()
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
          await insertEmbeddings(candidate.id, [
            { purpose: 'full_text', vector: fullVec },
            { purpose: 'skills', vector: skillsVec },
            { purpose: 'role', vector: roleVec },
          ])
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
        .selectAll()
        .where('id', 'in', candidateIds)
        .execute()
    } else {
      candidates = await db.selectFrom('candidates')
        .selectAll()
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

        await insertEmbeddings(candidate.id, [
          { purpose: 'full_text', vector: fullVec },
          { purpose: 'skills', vector: skillsVec },
          { purpose: 'role', vector: roleVec },
        ])

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
