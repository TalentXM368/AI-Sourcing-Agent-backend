import { Router, Request, Response } from 'express'
import { db } from '../db/index.js'
import { v2 as cloudinary } from 'cloudinary'
import AdmZip from 'adm-zip'

export const candidatesRouter = Router()

// ─── View Resume (proxy download from Cloudinary) ─────────────

candidatesRouter.get('/:id/resume', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .select(['resume_url', 'source_file', 'name'])
      .where('id', '=', req.params.id)
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
      return res.redirect(fileUrl)
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

    const response = await fetch(archiveUrl, { method: 'POST' })
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
    const ext = publicId.split('.').pop()?.toLowerCase() || 'pdf'

    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    const contentType = contentTypes[ext] || 'application/octet-stream'

    const filename = candidate.name
      ? `${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`
      : publicId.split('/').pop()

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
      .selectAll()
      .where('parse_status', '=', 'completed')

    // Apply filters
    if (req.query.industry) {
      query = query.where('industry', '=', req.query.industry as string)
    }
    if (req.query.region) {
      query = query.where('region', '=', req.query.region as string)
    }

    const candidates = await query.orderBy('created_at', 'desc').execute()

    res.json(candidates)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ─── Get Candidate ────────────────────────────────────────────

candidatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const candidate = await db.selectFrom('candidates')
      .selectAll()
      .where('id', '=', req.params.id)
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
