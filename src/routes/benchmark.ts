import { Router, Request, Response } from 'express'
import { extractTextFromBuffer, detectMimetype } from '../parsers/text-extractor.js'
import { parseResume } from '../parsers/resume-parser.js'
import { cloudinary } from '../services/cloudinary.js'

export const benchmarkRouter = Router()

// ─── GET /api/benchmark/list-files ────────────────────────────
// List files from Cloudinary with signed download URLs.
benchmarkRouter.get('/list-files', async (req: Request, res: Response) => {
  try {
    const folder = (req.query.folder as string) || 'candidates/Resumes'
    const count = parseInt(req.query.count as string) || 10

    const result = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'raw',
      prefix: folder,
      max_results: count,
    })

    const files = (result.resources || []).map((f: any) => {
      const signedUrl = cloudinary.url(f.public_id, {
        resource_type: 'raw',
        type: 'upload',
        sign_url: true,
        secure: true,
      })
      return {
        public_id: f.public_id,
        filename: f.public_id.split('/').pop(),
        signed_url: signedUrl,
        format: f.format,
        bytes: f.bytes,
      }
    })

    res.json({ folder, count: files.length, files })
  } catch (error: any) {
    console.error('[Benchmark] List files error:', error)
    res.status(500).json({ error: error.message })
  }
})

// ─── POST /api/benchmark/parse-existing ──────────────────────
// Benchmark the existing parser: extract text + parse resume.
// Accepts multipart file, returns structured comparison output.
benchmarkRouter.post('/parse-existing', async (req: Request, res: Response) => {
  try {
    // Get file from multipart form
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const buffer = file.buffer
    const mimetype = file.mimetype || detectMimetype(file.originalname)

    const startTime = Date.now()

    // Step 1: Extract text (existing parser)
    const text = await extractTextFromBuffer(buffer, mimetype)
    const extractionTime = Date.now() - startTime

    // Step 2: Parse resume (existing parser)
    const parseStart = Date.now()
    const parsed = await parseResume(text)
    const parseTime = Date.now() - parseStart

    const totalTime = Date.now() - startTime

    res.json({
      parser: 'existing',
      processingTime: totalTime / 1000,
      extractionTime: extractionTime / 1000,
      parseTime: parseTime / 1000,
      textLength: text.length,
      plainText: text,
      parsed: {
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
        skills: parsed.skills?.map(s => s.name) || [],
        work_history: parsed.work_history?.map(w => ({
          title: w.title,
          company: w.company,
          from: w.from,
          to: w.to,
        })) || [],
        education: parsed.education?.map(e => ({
          school: e.school,
          degree: e.degree,
          field: e.field,
        })) || [],
        projects: parsed.projects?.map(p => p.name) || [],
        certifications: parsed.certifications?.map(c => c.name) || [],
        languages: parsed.languages?.map(l => l.name) || [],
      },
      confidence: parsed.confidence,
      parse_source: parsed.parse_source,
    })
  } catch (error: any) {
    console.error('[Benchmark] Existing parser error:', error)
    res.status(500).json({
      parser: 'existing',
      error: error.message,
      processingTime: 0,
    })
  }
})

// ─── POST /api/benchmark/extract-text ─────────────────────────
// Just extract text without parsing (for comparison)
benchmarkRouter.post('/extract-text', async (req: Request, res: Response) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const buffer = file.buffer
    const mimetype = file.mimetype || detectMimetype(file.originalname)

    const startTime = Date.now()
    const text = await extractTextFromBuffer(buffer, mimetype)
    const extractionTime = Date.now() - startTime

    res.json({
      parser: 'existing',
      extractionTime: extractionTime / 1000,
      textLength: text.length,
      plainText: text,
    })
  } catch (error: any) {
    console.error('[Benchmark] Text extraction error:', error)
    res.status(500).json({ error: error.message })
  }
})
