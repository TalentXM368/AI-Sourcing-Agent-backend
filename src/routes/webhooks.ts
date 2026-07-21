import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { extractTextFromBuffer, detectMimetype } from '../parsers/text-extractor.js'
import { parseResume } from '../parsers/resume-parser.js'
import { parseJobDescription } from '../parsers/jd-parser.js'
import { parseCSV, convertToJDs } from '../parsers/csv-parser.js'
import { generateEmbeddings } from '../services/openai.js'
import { fetchFromCloudinary } from '../services/cloudinary.js'
import { matchCandidateToAllJobs, matchJobToAllCandidates } from '../scoring/index.js'
import { classifyRegion } from '../services/region-classifier.js'
import { classifyIndustry } from '../services/industry-classifier.js'
import { isAutoSyncEnabled } from './settings.js'

export const webhooksRouter = Router()

// ─── Validation Schema ────────────────────────────────────────

const WebhookSchema = z.object({
  type: z.enum(['resume', 'jd', 'client']),
  url: z.string().url().optional(),
  data: z.record(z.any()).optional(),
  zoho_id: z.string().optional(),
  client_id: z.string().uuid().optional(),
})

// ─── Webhook Handler ──────────────────────────────────────────

webhooksRouter.post('/ingest', async (req: Request, res: Response) => {
  // Always return 200 to prevent retry storms from callers
  try {
    const body = WebhookSchema.parse(req.body)
    console.log(`[Webhook] Received ${body.type}`, body.zoho_id ? `(zoho: ${body.zoho_id})` : '')

    switch (body.type) {
      case 'resume':
        if (!body.url) { res.json({ received: true, error: 'Missing url' }); return }
        handleResume(body.url, body.zoho_id).catch(err => console.error('[Webhook] Async resume error:', err))
        break
      case 'jd':
        if (!body.url) { res.json({ received: true, error: 'Missing url' }); return }
        handleJD(body.url, body.client_id, body.zoho_id).catch(err => console.error('[Webhook] Async jd error:', err))
        break
      case 'client':
        if (!body.data) { res.json({ received: true, error: 'Missing data' }); return }
        handleClient(body.data, body.zoho_id).catch(err => console.error('[Webhook] Async client error:', err))
        break
    }

    res.json({ received: true })
  } catch (error) {
    console.error('[Webhook] Error:', error)
    res.status(200).json({ received: true, error: String(error) })
  }
})

// ─── Resume Handler ───────────────────────────────────────────

async function handleResume(url: string, zohoId?: string) {
  const candidateId = randomUUID()

  // 1. Store candidate (status: processing)
  const now = new Date()
  await db.insertInto('candidates').values({
    id: candidateId,
    name: 'Processing...',
    source_file: url,
    parse_status: 'processing',
    created_at: now,
    updated_at: now,
  }).execute()

  try {
    // 2. Fetch file from Cloudinary
    const pdfBuffer = await fetchFromCloudinary(url)

    // 3. Detect mimetype and extract text
    const mimetype = detectMimetype(url)
    const text = await extractTextFromBuffer(pdfBuffer, mimetype)

    // 4. Parse resume
    const parsed = await parseResume(text)

    // 5. Generate embeddings
    const fullText = `${parsed.name} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
    const skillsText = parsed.skills.map(s => s.name).join(' ')
    const roleText = parsed.headline || parsed.companies[0]?.title || ''

    const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

    // Classify industry and region
    const skillNames = parsed.skills.map((s: any) => s.name || s)
    const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
    const regionResult = classifyRegion(parsed.location || '')

    // 6. Update candidate with parsed data
    await db.updateTable('candidates')
      .set({
        name: parsed.name,
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
        industry: industryResult.industry,
        region: regionResult,
        parse_status: 'completed',
      })
      .where('id', '=', candidateId)
      .execute()

    // 7. Store embeddings (raw SQL to avoid FK constraint issue)
    for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
         VALUES ($1, 'candidate', $2, $3, $4, 'text-embedding-3-small', NOW())`,
        [randomUUID(), candidateId, purpose, vector]
      )
    }

    // 8. Match against ALL existing jobs
    await matchCandidateToAllJobs(candidateId)

    console.log(`[Resume] Processed: ${parsed.name} (${candidateId})`)
  } catch (error) {
    await db.updateTable('candidates')
      .set({ parse_status: 'failed', parse_error: String(error) })
      .where('id', '=', candidateId)
      .execute()
    console.error(`[Resume] Failed:`, error)
  }
}

// ─── JD Handler ───────────────────────────────────────────────

async function handleJD(url: string, clientId?: string, zohoId?: string) {
  const jobId = randomUUID()

  // 1. Store job (status: processing)
  const now = new Date()
  await db.insertInto('jobs').values({
    id: jobId,
    client_id: clientId || null,
    role: 'Processing...',
    status: 'open',
    required_skills: [],
    nice_to_have_skills: [],
    avoid_skills: [],
    created_at: now,
    updated_at: now,
  }).execute()

  try {
    // 2. Fetch file from Cloudinary
    const pdfBuffer = await fetchFromCloudinary(url)

    // 3. Detect mimetype and extract text
    const mimetype = detectMimetype(url)
    const text = await extractTextFromBuffer(pdfBuffer, mimetype)

    // 4. Parse JD
    const parsed = await parseJobDescription(text)

    // 5. Generate embeddings
    const fullText = `${parsed.role} ${parsed.description || ''} ${parsed.required_skills.join(' ')} ${text}`
    const skillsText = parsed.required_skills.join(' ')
    const roleText = parsed.role

    const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

    // Classify industry and region
    const industryResult = await classifyIndustry(fullText, parsed.required_skills, parsed.role)
    const regionResult = classifyRegion(parsed.location || '')

    // 6. Update job with parsed data
    await db.updateTable('jobs')
      .set({
        role: parsed.role,
        company: parsed.company,
        location: parsed.location,
        required_skills: parsed.required_skills,
        nice_to_have_skills: parsed.nice_to_have_skills,
        avoid_skills: parsed.avoid_skills,
        experience_min: parsed.experience_min,
        experience_max: parsed.experience_max,
        description: parsed.description,
        raw_text: text,
        industry: industryResult.industry,
        region: regionResult,
      })
      .where('id', '=', jobId)
      .execute()

    // 7. Store embeddings (raw SQL to avoid FK constraint issue)
    for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
         VALUES ($1, 'job', $2, $3, $4, 'text-embedding-3-small', NOW())`,
        [randomUUID(), jobId, purpose, vector]
      )
    }

    // 8. Match against ALL existing candidates
    await matchJobToAllCandidates(jobId)

    console.log(`[JD] Processed: ${parsed.role} (${jobId})`)
  } catch (error) {
    await db.updateTable('jobs')
      .set({ role: 'Failed to parse' })
      .where('id', '=', jobId)
      .execute()
    console.error(`[JD] Failed:`, error)
  }
}

// ─── Client Handler ───────────────────────────────────────────

async function handleClient(data: Record<string, any>, zohoId?: string) {
  try {
    const clientId = randomUUID()

    // Upsert client
    const now = new Date()
    await db.insertInto('clients').values({
      id: clientId,
      zoho_account_id: zohoId || null,
      account_name: data.account_name || 'Unknown',
      industry: data.industry || null,
      location: data.location || null,
      status: 'active',
      urgency: 'medium',
      open_roles: 0,
      placements_ytd: 0,
      hiring_preferences: JSON.stringify(data.hiring_preferences || {}),
      culture: JSON.stringify(data.culture || {}),
      role_context: JSON.stringify(data.role_context || {}),
      historical_patterns: JSON.stringify(data.historical_patterns || {}),
      created_at: now,
      updated_at: now,
    }).onConflict((oc) => oc.column('zoho_account_id').doUpdateSet({
      account_name: data.account_name || 'Unknown',
      industry: data.industry || null,
      hiring_preferences: JSON.stringify(data.hiring_preferences || {}),
      culture: JSON.stringify(data.culture || {}),
      role_context: JSON.stringify(data.role_context || {}),
      historical_patterns: JSON.stringify(data.historical_patterns || {}),
      updated_at: new Date(),
    })).execute()

    // Re-score all jobs linked to this client
    const linkedJobs = await db.selectFrom('jobs')
      .select('id')
      .where('client_id', '=', clientId)
      .execute()

    for (const job of linkedJobs) {
      await matchJobToAllCandidates(job.id)
    }

    console.log(`[Client] Processed: ${data.account_name} (${clientId}), re-scored ${linkedJobs.length} jobs`)
  } catch (error) {
    console.error(`[Client] Failed:`, error)
  }
}

// ─── Cloudinary Webhook Signature Verification ────────────────

function verifyCloudinarySignature(body: string, signature: string, timestamp: string): boolean {
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!apiSecret) {
    console.warn('[Cloudinary Webhook] No API secret configured, skipping verification')
    return true
  }

  // Cloudinary signs: timestamp + body (sorted params) + api_secret
  // The signature header format is: "timestamp=<ts>|signature=<sig>"
  const expectedSig = createHash('sha1')
    .update(timestamp + body + apiSecret)
    .digest('hex')

  return expectedSig === signature
}

// ─── Cloudinary Webhook Handler ───────────────────────────────
// Receives notifications when files are uploaded/deleted in Cloudinary
// Configure in Cloudinary Dashboard → Settings → Webhook notifications

webhooksRouter.post('/cloudinary', async (req: Request, res: Response) => {
  try {
    const payload = req.body
    const timestamp = req.headers['x-cloudinary-timestamp'] as string || ''
    const signature = req.headers['x-cloudinary-signature'] as string || ''

    // Verify signature (skip if no secret configured)
    if (process.env.CLOUDINARY_API_SECRET && signature) {
      const rawBody = JSON.stringify(payload)
      if (!verifyCloudinarySignature(rawBody, signature, timestamp)) {
        console.warn('[Cloudinary Webhook] Invalid signature, rejecting')
        return res.status(401).json({ error: 'Invalid signature' })
      }
    }

    const { notification_type, public_id, secure_url, resource_type } = payload

    // Only process raw file uploads (resumes, JDs)
    if (resource_type !== 'raw') {
      return res.json({ received: true, skipped: true, reason: 'not raw resource' })
    }

    console.log(`[Cloudinary Webhook] ${notification_type}: ${public_id}`)

    // Check if auto-sync is enabled
    const isResume = public_id.includes('Resumes') || public_id.includes('resumes')
    const isJD = public_id.includes('JDs') || public_id.includes('jds') || public_id.includes('JobDescriptions')

    if (isResume && !isAutoSyncEnabled('resumes')) {
      console.log(`[Cloudinary Webhook] Auto-sync disabled for resumes, skipping: ${public_id}`)
      return res.json({ received: true, skipped: true, reason: 'auto_sync_disabled' })
    }
    if (isJD && !isAutoSyncEnabled('jds')) {
      console.log(`[Cloudinary Webhook] Auto-sync disabled for JDs, skipping: ${public_id}`)
      return res.json({ received: true, skipped: true, reason: 'auto_sync_disabled' })
    }

    // Return 200 immediately, process in background to avoid Vercel timeout
    res.json({ received: true })

    // Process async — errors won't affect the response
    if (notification_type === 'upload') {
      const isCSV = public_id.endsWith('.csv')

      if (isCSV) {
        processCloudinaryJDSCSV(secure_url, public_id).catch(err =>
          console.error(`[Cloudinary Webhook] CSV processing failed:`, err))
      } else if (isResume) {
        processCloudinaryResume(secure_url, public_id).catch(err =>
          console.error(`[Cloudinary Webhook] Resume processing failed:`, err))
      } else if (isJD) {
        processCloudinaryJD(secure_url, public_id).catch(err =>
          console.error(`[Cloudinary Webhook] JD processing failed:`, err))
      } else {
        console.log(`[Cloudinary Webhook] Unknown folder for ${public_id}, processing as resume`)
        processCloudinaryResume(secure_url, public_id).catch(err =>
          console.error(`[Cloudinary Webhook] Resume processing failed:`, err))
      }
    } else if (notification_type === 'delete') {
      db.updateTable('candidates')
        .set({ parse_status: 'deleted', updated_at: new Date() })
        .where('source_file', '=', secure_url)
        .execute().catch(err =>
          console.error(`[Cloudinary Webhook] Delete handling failed:`, err))
    }
  } catch (error) {
    console.error('[Cloudinary Webhook] Error:', error)
    // Always return 200 to prevent Cloudinary retries
    if (!res.headersSent) {
      res.status(200).json({ received: true, error: String(error) })
    }
  }
})

// ─── Process Resume from Cloudinary Webhook ───────────────────

async function processCloudinaryResume(url: string, publicId: string) {
  // Dedup check
  const existing = await db.selectFrom('candidates')
    .select('id')
    .where('source_file', '=', url)
    .executeTakeFirst()
  if (existing) {
    console.log(`[Cloudinary Webhook] Resume already ingested: ${publicId}`)
    return
  }

  const candidateId = randomUUID()

  // Store candidate (processing)
  await db.insertInto('candidates').values({
    id: candidateId,
    name: 'Processing...',
    source_file: url,
    resume_url: url,
    parse_status: 'processing',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute()

  try {
    // Extract public_id from URL for archive download
    const cloudinaryPublicId = publicId

    // Fetch file
    const fileBuffer = await fetchFromCloudinary(url, cloudinaryPublicId)

    // Detect mimetype
    const mimetype = detectMimetype(publicId)

    // Extract text
    let text: string
    try {
      text = await extractTextFromBuffer(fileBuffer, mimetype)
    } catch (extractError) {
      // For unparseable files (e.g. old .doc), just fix the name from filename
      const nameFromFilename = extractNameFromFilename(publicId)
      if (nameFromFilename) {
        await db.updateTable('candidates')
          .set({ name: nameFromFilename, parse_status: 'completed', parse_error: `Text extraction failed: ${String(extractError)}`, updated_at: new Date() })
          .where('id', '=', candidateId)
          .execute()
        console.log(`[Cloudinary Webhook] Name-only: "${nameFromFilename}" (text extraction failed)`)
      } else {
        await db.updateTable('candidates')
          .set({ parse_status: 'failed', parse_error: String(extractError), updated_at: new Date() })
          .where('id', '=', candidateId)
          .execute()
      }
      return
    }

    // Parse resume
    const parsed = await parseResume(text)

    // Name fallback from filename
    let candidateName = parsed.name
    const SECTION_HEADERS = new Set([
      'work experience', 'work history', 'professional summary', 'professional summary-',
      'education', 'skills', 'projects', 'certifications', 'languages', 'contact',
      'summary', 'objective', 'experience', 'training', 'internship',
      'summer internship training', 'internship training',
    ])
    const normalized = candidateName.toLowerCase().trim().replace(/\s+/g, ' ')
    if (!candidateName || candidateName.length < 2 || SECTION_HEADERS.has(normalized) || /^\d+$/.test(candidateName)) {
      const nameFromFilename = extractNameFromFilename(publicId)
      if (nameFromFilename) {
        candidateName = nameFromFilename
        console.log(`[Cloudinary Webhook] Name fallback: "${parsed.name}" → "${candidateName}"`)
      }
    }

    // Generate embeddings
    const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${parsed.skills.map(s => s.name).join(' ')} ${parsed.summary || ''} ${text}`
    const skillsText = parsed.skills.map(s => s.name).join(' ')
    const roleText = parsed.headline || parsed.companies[0]?.title || ''

    const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

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
        resume_url: url,
        industry: industryResult.industry,
        region: regionResult,
        parse_status: 'completed',
      })
      .where('id', '=', candidateId)
      .execute()

    // Store embeddings (raw SQL)
    for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
         VALUES ($1, 'candidate', $2, $3, $4, 'text-embedding-3-small', NOW())`,
        [randomUUID(), candidateId, purpose, vector]
      )
    }

    // Match against all jobs
    await matchCandidateToAllJobs(candidateId)

    console.log(`[Cloudinary Webhook] Ingested resume: ${candidateName} (${candidateId})`)
  } catch (error) {
    await db.updateTable('candidates')
      .set({ parse_status: 'failed', parse_error: String(error), updated_at: new Date() })
      .where('id', '=', candidateId)
      .execute()
    console.error(`[Cloudinary Webhook] Resume failed:`, error)
  }
}

// ─── Process JD from Cloudinary Webhook ───────────────────────

async function processCloudinaryJD(url: string, publicId: string) {
  // Dedup check
  const existing = await db.selectFrom('jobs')
    .select('id')
    .where('raw_text', 'is not', null)
    .executeTakeFirst()
  if (existing) {
    // Simple dedup — check if a job with same source already exists
    const jobExists = await pool.query(
      `SELECT id FROM jobs WHERE description LIKE $1 LIMIT 1`,
      [`%${publicId}%`]
    )
    if (jobExists.rows.length > 0) {
      console.log(`[Cloudinary Webhook] JD already ingested: ${publicId}`)
      return
    }
  }

  const jobId = randomUUID()

  // Store job (processing)
  await db.insertInto('jobs').values({
    id: jobId,
    role: 'Processing...',
    status: 'open',
    required_skills: [],
    nice_to_have_skills: [],
    avoid_skills: [],
    created_at: new Date(),
    updated_at: new Date(),
  }).execute()

  try {
    // Fetch file
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

    // Update job
    await db.updateTable('jobs')
      .set({
        role: parsed.role,
        company: parsed.company,
        location: parsed.location,
        required_skills: parsed.required_skills,
        nice_to_have_skills: parsed.nice_to_have_skills,
        avoid_skills: parsed.avoid_skills,
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
         VALUES ($1, 'job', $2, $3, $4, 'text-embedding-3-small', NOW())`,
        [randomUUID(), jobId, purpose, vector]
      )
    }

    // Match against all candidates
    await matchJobToAllCandidates(jobId)

    console.log(`[Cloudinary Webhook] Ingested JD: ${parsed.role} (${jobId})`)
  } catch (error) {
    await db.updateTable('jobs')
      .set({ role: 'Failed to parse' })
      .where('id', '=', jobId)
      .execute()
    console.error(`[Cloudinary Webhook] JD failed:`, error)
  }
}

// ─── Process JDs CSV from Cloudinary Webhook ─────────────────
// Downloads CSV, parses each row, runs AI parsing + embeddings + matching

async function processCloudinaryJDSCSV(url: string, publicId: string) {
  try {
    // Fetch CSV
    const csvBuffer = await fetchFromCloudinary(url, publicId)
    const csvText = csvBuffer.toString('utf-8')

    // Parse CSV
    const rows = parseCSV(csvText)
    const jds = convertToJDs(rows)
    console.log(`[Cloudinary Webhook] CSV: parsed ${jds.length} JDs from ${publicId}`)

    // Get existing roles for dedup
    const existingJobs = await db.selectFrom('jobs').select('role').execute()
    const existingRoles = new Set(existingJobs.map(j => j.role.toLowerCase()))

    let synced = 0
    let skipped = 0

    for (const jd of jds) {
      try {
        // Skip test JDs
        if (jd.job_title.toLowerCase().startsWith('test') && jd.job_description.length < 50) {
          skipped++
          continue
        }

        // Skip duplicates
        if (existingRoles.has(jd.job_title.toLowerCase())) {
          skipped++
          continue
        }

        const jobId = randomUUID()

        // Create job
        await db.insertInto('jobs').values({
          id: jobId,
          role: jd.job_title,
          company: jd.industry || null,
          location: jd.region_preference || null,
          required_skills: jd.required_skills,
          nice_to_have_skills: [],
          avoid_skills: [],
          experience_min: parseExpMin(jd.work_experience),
          experience_max: parseExpMax(jd.work_experience),
          description: jd.job_description,
          raw_text: jd.job_description,
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        }).execute()

        // AI enhancement
        let enhancedSkills = jd.required_skills
        try {
          const aiParsed = await parseJobDescription(jd.job_description)
          const csvSkills = new Set(jd.required_skills.map(s => s.toLowerCase()))
          for (const skill of aiParsed.required_skills) {
            if (!csvSkills.has(skill.toLowerCase())) enhancedSkills.push(skill)
          }
          if (aiParsed.nice_to_have_skills?.length) {
            await db.updateTable('jobs').set({ nice_to_have_skills: aiParsed.nice_to_have_skills }).where('id', '=', jobId).execute()
          }
          if (aiParsed.avoid_skills?.length) {
            await db.updateTable('jobs').set({ avoid_skills: aiParsed.avoid_skills }).where('id', '=', jobId).execute()
          }
        } catch {
          // Use CSV data as-is
        }

        await db.updateTable('jobs').set({ required_skills: enhancedSkills }).where('id', '=', jobId).execute()

        // Embeddings
        const fullText = `${jd.job_title} ${jd.industry || ''} ${jd.region_preference || ''} ${enhancedSkills.join(' ')} ${jd.job_description}`
        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, enhancedSkills.join(' '), jd.job_title])

        for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
          await pool.query(
            `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
             VALUES ($1, 'job', $2, $3, $4, 'text-embedding-3-small', NOW())`,
            [randomUUID(), jobId, purpose, vector]
          )
        }

        await matchJobToAllCandidates(jobId)
        existingRoles.add(jd.job_title.toLowerCase())
        synced++
        console.log(`[Cloudinary Webhook] CSV ingested: ${jd.job_title} (${jobId})`)
      } catch (error) {
        console.error(`[Cloudinary Webhook] CSV JD failed: ${jd.job_title}:`, error)
      }
    }

    console.log(`[Cloudinary Webhook] CSV done: ${synced} synced, ${skipped} skipped`)
  } catch (error) {
    console.error(`[Cloudinary Webhook] CSV processing failed:`, error)
  }
}

function parseExpMin(exp: string | null): number | null {
  if (!exp) return null
  const match = exp.match(/(\d+)/)
  return match ? parseInt(match[1]) : null
}

function parseExpMax(exp: string | null): number | null {
  if (!exp) return null
  if (exp.toLowerCase().includes('fresher')) return 0
  const match = exp.match(/(\d+)\s*[-–]\s*(\d+)/)
  return match ? parseInt(match[2]) : parseExpMin(exp)
}

// ─── Name Extraction Helper ───────────────────────────────────

function extractNameFromFilename(publicId: string): string | undefined {
  const basename = publicId.split('/').pop() || publicId
  const withoutExt = basename.replace(/\.(pdf|docx?|txt)+$/i, '')
  const parts = withoutExt.split('_')
  if (parts.length >= 2) {
    const name = parts.slice(1).join('_').trim()
    if (name && name.length > 1 && !name.match(/^\d+$/)) {
      return name
    }
  }
  return undefined
}
