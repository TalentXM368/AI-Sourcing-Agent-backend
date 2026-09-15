import { Router, Request, Response } from 'express'
import { db, pool } from '../db/index.js'
import { v2 as cloudinary } from 'cloudinary'
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync, rmSync } from 'fs'

export const candidatesRouter = Router()

// ─── Converter Availability ──────────────────────────────────

candidatesRouter.get('/converters', async (_req, res) => {
  const findChromeExecutable = (() => {
    try {
      const platform = os.platform()
      const candidates: string[] = []
      if (platform === 'win32') {
        candidates.push(
          path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe')
        )
      } else if (platform === 'darwin') {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium')
      } else {
        candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium')
      }
      for (const p of candidates) if (p && fs.existsSync(p)) return p
      return null
    } catch (e) { return null }
  })()

  const findLibreOfficeExecutable = (() => {
    try {
      const platform = os.platform()
      const candidates: string[] = []
      if (platform === 'win32') {
        candidates.push(
          path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')
        )
      } else if (platform === 'darwin') {
        candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice')
      } else {
        candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', 'soffice')
      }
      for (const p of candidates) if (p && fs.existsSync(p)) return p
      return null
    } catch (e) { return null }
  })()

  res.json({ libreOffice: findLibreOfficeExecutable || null, chrome: findChromeExecutable || null, envPuppeteerPath: process.env.PUPPETEER_EXECUTABLE_PATH || null })
})

// ─── View Resume (proxy download from Cloudinary) ─────────────

candidatesRouter.get('/:id/resume', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select(['resume_url', 'source_file', 'name'])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    const fileUrl = candidate.resume_url || candidate.source_file
    if (!fileUrl) {
      return res.status(404).json({ error: 'Resume file not found' })
    }

    // Extract public_id from the Cloudinary URL
    const urlParts = fileUrl.split('/upload/')
    if (urlParts.length < 2) {
      // Not a Cloudinary URL — check if we have raw_text to serve
      const { getDocument } = await import('../db/documents.js')
      const rawText = await getDocument(req.params.id as string, 'candidate', 'raw_text')
      if (rawText) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('Content-Disposition', `inline; filename="${(candidate.name || 'resume').replace(/[^a-zA-Z0-9]/g, '_')}.txt"`)
        return res.send(rawText)
      }
      return res.status(404).json({ error: 'Resume file not available' })
    }

    let publicId = urlParts[1]
    publicId = publicId.replace(/^v\d+\//, '')
    publicId = publicId.split('?')[0]

    // Use Cloudinary archive download (the only reliable auth method for raw files)
    const archiveUrl = cloudinary.utils.download_archive_url({
      resource_type: 'raw',
      type: 'upload',
      public_ids: [publicId],
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const response = await fetch(archiveUrl, { method: 'POST', signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      console.error(`[Candidates] Cloudinary archive fetch failed: ${response.status}`)
      return res.status(502).json({ error: 'Failed to fetch resume from storage' })
    }

    const arrayBuffer = await response.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)

    // Extract the file from the zip
    const zip = new AdmZip(zipBuffer)
    const entries = zip.getEntries()
    if (entries.length === 0) {
      return res.status(404).json({ error: 'Resume file not found in archive' })
    }

    const fileBuffer = entries[0].getData()
    const entryName = entries[0].entryName || publicId.split('/').pop() || ''
    const ext = entryName.split('.').pop()?.toLowerCase() || publicId.split('.').pop()?.toLowerCase() || 'pdf'

    // If the file is a DOCX, convert to HTML so browsers can render it inline.
    if (ext === 'docx') {
      try {
        const result = await mammoth.convertToHtml(
          { buffer: fileBuffer } as any,
          {
            convertImage: async (element: any) => {
              const imageBase64 = await element.read('base64')
              return { src: `data:${element.contentType};base64,${imageBase64}` }
            }
          } as any
        )

        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${candidate.name || 'resume'}</title><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; padding:16px;}</style></head><body>${result.value}</body></html>`

        // Render HTML to PDF with Puppeteer-core to preserve layout/formatting.
        // We prefer using a local Chrome/Chromium binary to avoid large downloads.
        function findChromeExecutable(): string | null {
          const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
          if (envPath && fs.existsSync(envPath)) return envPath

          const platform = os.platform()
          const candidates: string[] = []
          if (platform === 'win32') {
            candidates.push(
              path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
              path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
              path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe')
            )
          } else if (platform === 'darwin') {
            candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium')
          } else {
            candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium')
          }

          for (const p of candidates) {
            try {
              if (p && fs.existsSync(p)) return p
            } catch (e) { /* ignore */ }
          }
          return null
        }

        const chromePath = findChromeExecutable()
        // Try LibreOffice first for highest-fidelity DOCX -> PDF conversion
        function findLibreOfficeExecutable(): string | null {
          const platform = os.platform()
          const candidates: string[] = []
          if (platform === 'win32') {
            candidates.push(
              path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
              path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')
            )
          } else if (platform === 'darwin') {
            candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice')
          } else {
            candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', 'soffice')
          }

          for (const p of candidates) {
            try {
              if (p && fs.existsSync(p)) return p
            } catch (e) { }
          }
          return null
        }

        const libreOfficePath = findLibreOfficeExecutable()
        console.info(`[Candidates] Converter availability - LibreOffice: ${libreOfficePath || 'none'}, Chrome: ${chromePath || 'none'}`)
        if (libreOfficePath) {
          try {
            const tmpDir = mkdtempSync(path.join(tmpdir(), 'resume-'))
            const docxPath = path.join(tmpDir, 'resume.docx')
            const outPath = path.join(tmpDir, 'resume.pdf')
            writeFileSync(docxPath, fileBuffer)

            // Run LibreOffice headless conversion
            const result = spawnSync(libreOfficePath, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath], { timeout: 60_000 })

            if (result.status === 0 && fs.existsSync(outPath)) {
              console.info('[Candidates] Served PDF via LibreOffice conversion')
              const pdfBuffer = readFileSync(outPath)
              rmSync(tmpDir, { recursive: true, force: true })

              const filename = candidate.name
                ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
                : (entryName || 'resume.pdf')

              res.setHeader('Content-Type', 'application/pdf')
              res.setHeader('Content-Length', pdfBuffer.length)
              res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
              res.setHeader('Cache-Control', 'private, max-age=3600')
              return res.send(pdfBuffer)
            } else {
              console.warn('[Candidates] LibreOffice conversion failed, falling back:', result.error || result.stderr?.toString())
              try { rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
            }
          } catch (loErr) {
            console.error('[Candidates] LibreOffice conversion error:', loErr)
          }
        }
        if (chromePath) {
          try {
            const browser = await puppeteer.launch({ executablePath: chromePath, args: ['--no-sandbox','--disable-setuid-sandbox'] })
            const page = await browser.newPage()
            await page.setContent(html, { waitUntil: 'networkidle0' })
            const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true })
            await browser.close()

            const filename = candidate.name
              ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
              : (entryName || 'resume.pdf')

            console.info('[Candidates] Served PDF via local Chrome (Puppeteer)')

            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Length', pdfBuffer.length)
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
            res.setHeader('Cache-Control', 'private, max-age=3600')
            return res.send(pdfBuffer)
          } catch (pdfErr) {
            console.error('[Candidates] DOCX -> PDF conversion failed using local Chrome:', pdfErr)
            // Fall back to serving HTML
            const filename = candidate.name
              ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.html`
              : (entryName || 'resume.html')

            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Content-Length', Buffer.byteLength(html))
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
            res.setHeader('Cache-Control', 'private, max-age=3600')
            return res.send(html)
          }
        } else {
          console.warn('[Candidates] No Chrome/Chromium executable found; serving HTML instead of PDF. Set PUPPETEER_EXECUTABLE_PATH to override.')
          const filename = candidate.name
            ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.html`
            : (entryName || 'resume.html')

          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Content-Length', Buffer.byteLength(html))
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
          res.setHeader('Cache-Control', 'private, max-age=3600')
          return res.send(html)
        }
      } catch (convErr) {
        console.error('[Candidates] DOCX -> HTML conversion failed:', convErr)
        // Fall through to send original file as binary
      }
    }

    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    const contentType = contentTypes[ext] || 'application/octet-stream'

    const filename = candidate.name
      ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`
      : entryName || publicId.split('/').pop()

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', fileBuffer.length)
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(fileBuffer)
  } catch (error) {
    console.error(`[Candidates] Resume proxy error:`, error)
    res.status(500).json({ error: 'Failed to fetch resume' })
  }
})

// ─── List Candidates ──────────────────────────────────────────

candidatesRouter.get('/', async (req: Request, res: Response) => {
  try {
    let query = db.selectFrom('candidates')
      .select([
        'id', 'name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url',
        'headline', 'location', 'summary', 'experience_years',
        'parse_status', 'data_quality_score', 'missing_fields', 'stage',
        'stage_updated_at', 'industry', 'region', 'source', 'created_at', 'updated_at',
      ])
      .where('parse_status', '=', 'completed')
      .where('created_by_id', '=', req.auth!.id)

    const requestedLimit = Number(req.query.limit || 50)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const requestedOffset = Number(req.query.offset || 0)
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0

    // Apply filters
    if (req.query.source) {
      query = query.where('source', '=', req.query.source as string)
    }
    if (req.query.industry) {
      query = query.where('industry', '=', req.query.industry as string)
    }
    if (req.query.region) {
      query = query.where('region', '=', req.query.region as string)
    }

    const [candidates, countResult] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
      db.selectFrom('candidates')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('parse_status', '=', 'completed')
        .where('created_by_id', '=', req.auth!.id)
        .$if(Boolean(req.query.source), (countQuery) => countQuery.where('source', '=', req.query.source as string))
        .$if(Boolean(req.query.industry), (countQuery) => countQuery.where('industry', '=', req.query.industry as string))
        .$if(Boolean(req.query.region), (countQuery) => countQuery.where('region', '=', req.query.region as string))
        .executeTakeFirst(),
    ])
    const total = Number(countResult?.count ?? 0)

    res.json({ candidates, total, limit, offset, hasMore: offset + candidates.length < total })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get parsing status without transferring the full profile ───

candidatesRouter.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select(['id', 'name', 'parse_status'])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    res.json(candidate)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Candidate by PDL ID ─────────────────────────────────
// MUST be before /:id to avoid "pdl" matching as an id

candidatesRouter.get('/pdl/:pdlId', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select([
        'id', 'name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url',
        'headline', 'location', 'summary', 'experience_years',
        'skills', 'companies', 'work_history', 'education', 'projects',
        'certifications', 'languages', 'resume_url', 'source_file',
        'parse_status', 'data_quality_score', 'missing_fields', 'stage',
        'stage_updated_at', 'industry', 'region',
      ])
      .where('pdl_id', '=', req.params.pdlId)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    res.json(candidate)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Candidate ────────────────────────────────────────────

candidatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select([
        'id', 'name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url',
        'headline', 'location', 'summary', 'experience_years',
        'skills', 'companies', 'work_history', 'education', 'projects',
        'certifications', 'languages', 'resume_url', 'source_file',
        'parse_status', 'data_quality_score', 'missing_fields', 'stage',
        'stage_updated_at', 'industry', 'region', 'source', 'pdl_id',
        'created_at', 'updated_at',
      ])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    res.json(candidate)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Update Candidate Stage ───────────────────────────────────

const VALID_STAGES = ['new', 'contacted', 'screening', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn']

candidatesRouter.patch('/:id/stage', async (req: Request, res: Response) => {
  try {
    const { stage } = req.body

    if (!stage || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` })
    }

    const candidate = await db.selectFrom('candidates')
      .select(['id', 'stage'])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    await db.updateTable('candidates')
      .set({
        stage,
        stage_updated_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', req.params.id)
      .execute()

    res.json({ id: req.params.id, stage, previous_stage: candidate.stage })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Delete a candidate ─────────────────────────────────────

candidatesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const candidateId = req.params.id
    const candidate = await db.selectFrom('candidates')
      .select(['id', 'name'])
      .where('id', '=', candidateId)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    // Delete related data
    await pool.query(`DELETE FROM embeddings WHERE entity_id = $1`, [candidateId])
    await pool.query(`DELETE FROM processing_status WHERE entity_id = $1`, [candidateId])
    await pool.query(`DELETE FROM ranked_candidates WHERE candidate_id = $1`, [candidateId])
    await pool.query(`DELETE FROM ai_evaluations WHERE candidate_id = $1`, [candidateId])
    await db.deleteFrom('candidates')
      .where('id', '=', candidateId)
      .where('created_by_id', '=', req.auth!.id)
      .execute()

    console.log(`[Delete] Removed candidate: ${candidate.name} (${candidateId})`)
    res.json({ success: true, name: candidate.name })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Batch Reprocess all candidates with empty data ──────────
// Finds resume candidates with missing skills/work_history/education
// and re-runs Docling → pipeline for each

candidatesRouter.post('/batch-reprocess', async (req: Request, res: Response) => {
  try {
    const limit = (req.body.limit as number) || 50

    // Find candidates with empty critical fields
    const candidates = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'skills', 'work_history', 'education', 'companies', 'parse_status'])
      .where('source', '=', 'resume')
      .where('parse_status', '=', 'completed')
      .where((eb) =>
        eb.or([
          eb('skills', '=', '[]'),
          eb('skills', 'is', null),
          eb('work_history', '=', '[]'),
          eb('work_history', 'is', null),
          eb('education', '=', '[]'),
          eb('education', 'is', null),
        ])
      )
      .where('source_file', 'is not', null)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute()

    console.log(`[BatchReprocess] Found ${candidates.length} candidates with empty data`)

    if (candidates.length === 0) {
      return res.json({ total: 0, processed: 0, success: 0, failed: 0, message: 'No candidates need reprocessing' })
    }

    // Process asynchronously — don't block response
    const batchId = `batch-${Date.now()}`
    batchReprocess(candidates, batchId).catch(err => {
      console.error(`[BatchReprocess] Batch failed:`, err.message)
    })

    res.json({
      total: candidates.length,
      message: `Batch reprocess started for ${candidates.length} candidates`,
      batchId,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Batch reprocess implementation ──────────────────────────

async function batchReprocess(candidates: any[], batchId: string) {
  let success = 0
  let failed = 0

  for (const candidate of candidates) {
    try {
      const fileUrl = candidate.source_file || candidate.resume_url
      if (!fileUrl) {
        failed++
        continue
      }

      console.log(`[BatchReprocess] (${success + failed + 1}/${candidates.length}) ${candidate.name}`)

      // Reset status
      await db.updateTable('candidates')
        .set({ parse_status: 'processing', parse_error: null, updated_at: new Date() })
        .where('id', '=', candidate.id)
        .execute()

      await reprocessCandidate(candidate.id, fileUrl)
      success++
      console.log(`[BatchReprocess] Done: ${candidate.name}`)

      // Rate limit: 1 second between candidates
      await new Promise(r => setTimeout(r, 1000))
    } catch (err: any) {
      failed++
      console.error(`[BatchReprocess] Failed: ${candidate.name}: ${err.message}`)
      // Mark as completed with error so it doesn't get stuck
      await db.updateTable('candidates')
        .set({ parse_status: 'completed', parse_error: `Reprocess failed: ${err.message}`, updated_at: new Date() })
        .where('id', '=', candidate.id)
        .execute()
    }
  }

  console.log(`[BatchReprocess] ${batchId} complete: ${success} succeeded, ${failed} failed`)
}

// ─── Reprocess a failed/stuck candidate ──────────────────────

candidatesRouter.post('/:id/reprocess', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select(['id', 'name', 'source_file', 'resume_url', 'skills', 'work_history', 'education', 'companies', 'headline', 'location', 'summary', 'experience_years', 'parse_status'])
      .where('id', '=', req.params.id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    const fileUrl = candidate.source_file || candidate.resume_url
    if (!fileUrl) {
      return res.status(400).json({ error: 'No source file to reprocess' })
    }

    console.log(`[Reprocess] Re-processing candidate: ${candidate.name} (${candidate.id})`)

    // Reset status immediately
    await db.updateTable('candidates')
      .set({ parse_status: 'processing', parse_error: null, updated_at: new Date() })
      .where('id', '=', candidate.id)
        .where('created_by_id', '=', req.auth!.id)
      .execute()

    // Run reprocess asynchronously (don't block the response)
    reprocessCandidate(candidate.id, fileUrl).catch(err => {
      console.error(`[Reprocess] Failed for ${candidate.id}:`, err.message)
    })

    res.json({ message: 'Reprocess started', candidateId: candidate.id })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Reset all stuck candidates ──────────────────────────────

candidatesRouter.post('/reset-stuck', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE candidates SET parse_status = 'pending', parse_error = NULL, updated_at = NOW()
       WHERE parse_status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes'`
    )
    const reset = result.rowCount || 0
    console.log(`[Reprocess] Reset ${reset} stuck candidates`)
    res.json({ reset })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Reprocess implementation ────────────────────────────────

async function reprocessCandidate(candidateId: string, fileUrl: string) {
  const { extractTextFromBuffer, detectMimetype } = await import('../parsers/text-extractor.js')
  const { extractWithDocumentIntelligence } = await import('../services/document-intelligence.js')
  const { runFullCandidatePipeline } = await import('../services/candidate-pipeline.js')

  // Extract public_id from Cloudinary URL
  const urlParts = fileUrl.split('/upload/')
  let publicId = urlParts.length >= 2 ? urlParts[1] : fileUrl
  publicId = publicId.replace(/^v\d+\//, '').split('?')[0]

  // Fetch from Cloudinary
  const archiveUrl = cloudinary.utils.download_archive_url({
    resource_type: 'raw',
    type: 'upload',
    public_ids: [publicId],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const response = await fetch(archiveUrl, { method: 'POST', signal: controller.signal })
  clearTimeout(timeout)
  if (!response.ok) throw new Error(`Cloudinary fetch failed: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const zipBuffer = Buffer.from(arrayBuffer)
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries()
  if (entries.length === 0) throw new Error('No file in archive')

  const fileBuffer = entries[0].getData()
  const ext = publicId.split('.').pop()?.toLowerCase() || 'pdf'
  const mimetype = detectMimetype(`file.${ext}`)

  // Try Document Intelligence first, fallback to text extractor
  let doc
  try {
    doc = await extractWithDocumentIntelligence(fileBuffer, mimetype, `resume.${ext}`)
  } catch {
    const text = await extractTextFromBuffer(fileBuffer, mimetype)
    doc = {
      plainText: text,
      markdown: text,
      sections: [],
      tables: [],
      images: [],
      metadata: { fileName: `resume.${ext}`, mimeType: mimetype },
      ast: undefined,
    }
  }

  // Run full pipeline (Intelligence → Resolution → Validation → DB update)
  await runFullCandidatePipeline(candidateId, doc as any)

  console.log(`[Reprocess] Done: ${candidateId}`)
}
