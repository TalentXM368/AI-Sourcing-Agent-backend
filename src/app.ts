import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { webhooksRouter } from './routes/webhooks.js'
import { jobsRouter } from './routes/jobs.js'
import { candidatesRouter } from './routes/candidates.js'
import { clientsRouter } from './routes/clients.js'
import { healthRouter } from './routes/health.js'
import { uploadRouter } from './routes/upload.js'
import { settingsRouter } from './routes/settings.js'
import { pdlSearchRouter } from './routes/pdl-search.js'
import { githubSearchRouter } from './routes/github-search.js'
import { stackoverflowSearchRouter } from './routes/stackoverflow-search.js'
import { kaggleSearchRouter } from './routes/kaggle-search.js'
import { coresignalSearchRouter } from './routes/coresignal-search.js'
import { searchAllRouter } from './routes/search-all.js'
import { advancedSearchRouter } from './routes/advanced-search.js'
import { resumeSearchRouter } from './routes/resume-search.js'
import { pipelineRouter } from './routes/pipeline.js'
import { searchHistoryRouter } from './routes/search-history.js'
import { projectsRouter } from './routes/projects.js'
import { autocompleteRouter } from './routes/autocomplete.js'
import { benchmarkRouter } from './routes/benchmark.js'
import intelligenceRouter from './modules/candidate-intelligence/routes/intelligence.routes.js'
import resolutionRouter from './modules/candidate-resolution/routes/resolution.routes.js'
import aiValidationRouter from './modules/ai-validation/routes/validation.routes.js'
import jobIntelligenceRouter from './modules/job-intelligence/routes/job-intelligence.routes.js'
import { getVectorIntelligenceRouter, initializeVectorIntelligence, getEmbeddingService } from './modules/vector-intelligence/factory.js'
import { getMatchingRouter } from './modules/matching-intelligence/factory.js'
import { getRecruiterRouter } from './modules/recruiter-intelligence/factory.js'
import { getBenchmarkRouter } from './modules/benchmark/factory.js'
import { createProcessingRouter } from './routes/processing.js'
import { createAIEvaluationRouter } from './routes/ai-evaluation.js'
import { loadMatchingModeFromDB } from './services/pipeline-toggle.js'
import { authRouter } from './routes/auth.js'
import { accountRouter } from './routes/account.js'
import { attachAuth, requireAuth } from './middleware/auth.js'

const app = express()

// ─── Middleware ────────────────────────────────────────────────

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(s => s.trim())
  : [
      'http://localhost:8080',
      'http://localhost:8081',
      'http://localhost:5173',
    ]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`Origin ${origin} not allowed`))
    }
  },
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ─── Routes ───────────────────────────────────────────────────

app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use(attachAuth)
app.use('/api', requireAuth)
app.use('/api', accountRouter)
app.use('/api/webhooks', webhooksRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/candidates', pdlSearchRouter)
app.use('/api/candidates', githubSearchRouter)
app.use('/api/candidates', stackoverflowSearchRouter)
app.use('/api/candidates', kaggleSearchRouter)
app.use('/api/candidates', coresignalSearchRouter)
app.use('/api/candidates', searchAllRouter)
app.use('/api', searchHistoryRouter)
app.use('/api', projectsRouter)
app.use('/api/autocomplete', autocompleteRouter)
app.use('/api/candidates', candidatesRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/settings', settingsRouter)
app.use('/api', advancedSearchRouter)
app.use('/api/candidates', resumeSearchRouter)
app.use('/api/pipeline', pipelineRouter)

// ─── Candidate Intelligence Layer ────────────────────────────
app.use('/api/intelligence', intelligenceRouter)

// ─── Candidate Resolution & Consensus Engine ────────────────
app.use('/api/candidate-resolution', resolutionRouter)

// ─── AI Validation & Enrichment Engine ─────────────────────
app.use('/api/ai-validation', aiValidationRouter)

// ─── Job Intelligence Layer ────────────────────────────────
app.use('/api/job-intelligence', jobIntelligenceRouter)

// ─── Benchmark (in-memory uploads for testing) ────────────────
const benchmarkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
app.use('/api/benchmark', benchmarkUpload.single('file'), benchmarkRouter)

// ─── Platform Benchmark Suite (Phase 6.5) ─────────────────────
const platformBenchmarkRouter = getBenchmarkRouter()
app.use('/api/platform-benchmark', platformBenchmarkRouter)

// ─── Vector Intelligence Layer (Qdrant) ─────────────────────
// Router mounted synchronously, Qdrant initializes in background
const vectorIntelligenceRouter = getVectorIntelligenceRouter()
app.use('/api/vector-intelligence', vectorIntelligenceRouter)

// Initialize Qdrant connection in background (non-blocking)
initializeVectorIntelligence().catch(err => {
  console.warn('[App] Vector Intelligence background init failed:', err)
})

// ─── Matching Intelligence Layer (depends on Vector Intelligence) ────
const embeddingService = getEmbeddingService()
if (embeddingService) {
  const matchingRouter = getMatchingRouter(embeddingService)
  app.use('/api/matching', matchingRouter)
} else {
  console.warn('[App] EmbeddingService not available, Matching Intelligence router not mounted')
}

// ─── Recruiter Intelligence Layer (AI-powered insights) ────
const recruiterAIRouter = getRecruiterRouter()
app.use('/api/recruiter-ai', recruiterAIRouter)

// ─── Processing Status API ────────────────────────────────
app.use('/api/processing', createProcessingRouter())

// ─── AI Evaluations API (unified ranked candidates + AI) ──
app.use('/api/jobs', createAIEvaluationRouter())

// ─── Background Workers (BullMQ) ──────────────────────────
loadMatchingModeFromDB().catch(() => {})

// Start workers if Redis is available
import('./queue/workers/index.js').then(({ startAllWorkers }) => {
  startAllWorkers()
}).catch(err => {
  console.warn('[App] Worker startup failed (Redis may not be available):', err.message)
})

// ─── Startup Cleanup: Reset stuck processing candidates ──────
import { pool } from './db/index.js'
pool.query(
  `UPDATE candidates SET parse_status = 'pending', parse_error = NULL, updated_at = NOW()
   WHERE parse_status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes'`
).then(result => {
  const reset = result.rowCount || 0
  if (reset > 0) console.log(`[App] Reset ${reset} stuck candidates on startup`)
}).catch(() => {})

// ─── Auto-Sync: Background Cloudinary Poller ─────────────────
// Polls Cloudinary every 5 minutes for new resumes and auto-processes them
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let autoSyncRunning = false

async function autoSyncCloudinary() {
  if (autoSyncRunning) return
  autoSyncRunning = true
  try {
    const { listCloudinaryFolder } = await import('./services/cloudinary.js')
    const { fetchFromCloudinary } = await import('./services/cloudinary.js')
    const { extractTextFromBuffer, detectMimetype } = await import('./parsers/text-extractor.js')
    const { parseResumeRegex } = await import('./parsers/resume-parser.js')
    const { generateEmbeddings } = await import('./services/openai.js')
    const { indexCandidateToQdrant } = await import('./utils/qdrant-indexing.js')
    const { computeDataQuality } = await import('./scoring/data-quality.js')
    const { classifyIndustry } = await import('./services/industry-classifier.js')
    const { classifyRegion } = await import('./services/region-classifier.js')
    const { isAutoSyncEnabled } = await import('./routes/settings.js')
    const { extractWithDocumentIntelligence, checkDocumentIntelligenceHealth } = await import('./services/document-intelligence.js')
    const { randomUUID } = await import('crypto')

    if (!isAutoSyncEnabled('resumes')) {
      console.log(`[AutoSync] Auto-sync disabled for resumes, skipping`)
      return
    }

    const files = await listCloudinaryFolder('candidates/Resumes', 200)
    if (files.length === 0) return

    const existing = await pool.query(`SELECT source_file FROM candidates WHERE source = 'resume'`)
    const existingUrls = new Set(existing.rows.map((r: any) => r.source_file))
    const newFiles = files.filter(f => !existingUrls.has(f.secure_url))
    if (newFiles.length === 0) {
      console.log(`[AutoSync] Checked ${files.length} files, no new resumes`)
      return
    }

    console.log(`[AutoSync] Found ${newFiles.length} new resumes to process`)
    let diAvailable = await checkDocumentIntelligenceHealth()

    const SECTION_HEADERS = new Set(['work experience', 'work history', 'professional summary', 'education', 'skills', 'projects', 'certifications', 'languages', 'contact', 'summary', 'objective', 'experience'])
    function isValidPersonName(name: string): boolean {
      if (!name || name.length < 2) return false
      if (SECTION_HEADERS.has(name.toLowerCase().trim())) return false
      if (/^\d+$/.test(name)) return false
      return true
    }
    function extractNameFromFilename(publicId: string): string | undefined {
      const basename = publicId.split('/').pop() || publicId
      const withoutExt = basename.replace(/\.(pdf|docx?|txt)+$/i, '')
      const parts = withoutExt.split('_')
      if (parts.length >= 2) {
        const name = parts.slice(1).join('_').trim()
        if (name && name.length > 1 && !/^\d+$/.test(name)) return name
      }
      return undefined
    }

    for (const file of newFiles) {
      const url = file.secure_url
      const candidateId = randomUUID()
      try {
        await pool.query(
          `INSERT INTO candidates (id, name, source_file, resume_url, parse_status, source, created_at, updated_at)
           VALUES ($1, 'Processing...', $2, $2, 'processing', 'resume', NOW(), NOW())`,
          [candidateId, url]
        )

        const pdfBuffer = await fetchFromCloudinary(url, file.public_id)
        const mimetype = detectMimetype(file.public_id)

        let text = ''
        if (diAvailable) {
          try {
            const diResult = await extractWithDocumentIntelligence(pdfBuffer, mimetype, file.public_id)
            if (diResult.text.length > 50) text = diResult.text
          } catch {}
        }
        if (!text) {
          try { text = await extractTextFromBuffer(pdfBuffer, mimetype) } catch { text = '' }
        }

        if (!text || text.length < 30) {
          const nameFromFile = extractNameFromFilename(file.public_id)
          if (nameFromFile) {
            await pool.query(
              `UPDATE candidates SET name = $1, parse_status = 'completed', parse_error = 'No extractable text', updated_at = NOW() WHERE id = $2`,
              [nameFromFile, candidateId]
            )
          } else {
            await pool.query(
              `UPDATE candidates SET parse_status = 'failed', parse_error = 'No extractable text', updated_at = NOW() WHERE id = $2`,
              [candidateId]
            )
          }
          continue
        }

        const parsed = parseResumeRegex(text)
        let candidateName = parsed.name
        if (!isValidPersonName(candidateName)) {
          const fromFile = extractNameFromFilename(file.public_id)
          if (fromFile) candidateName = fromFile
        }
        if (!isValidPersonName(candidateName)) candidateName = file.public_id.split('/').pop()?.replace(/\.(pdf|docx?|txt)+$/i, '') || 'Unknown'

        const quality = computeDataQuality(parsed as any)
        const skillNames = parsed.skills.map((s: any) => s.name || s)
        const fullText = `${candidateName} ${parsed.headline || ''} ${parsed.location || ''} ${skillNames.join(' ')} ${parsed.summary || ''} ${text}`
        const industryResult = await classifyIndustry(fullText, skillNames, parsed.headline || undefined)
        const regionResult = classifyRegion(parsed.location || '')

        await pool.query(
          `UPDATE candidates SET name=$1, email=$2, phone=$3, linkedin_url=$4, github_url=$5, portfolio_url=$6,
           headline=$7, location=$8, summary=$9, experience_years=$10, skills=$11, companies=$12, work_history=$13,
           education=$14, projects=$15, certifications=$16, languages=$17, raw_text=$18, data_quality_score=$19,
           missing_fields=$20, industry=$21, region=$22, parse_status='completed', parse_error=NULL, updated_at=NOW()
           WHERE id=$23`,
          [candidateName, parsed.email, parsed.phone, parsed.linkedin_url, parsed.github_url, parsed.portfolio_url,
           parsed.headline, parsed.location, parsed.summary, parsed.experience_years,
           JSON.stringify(parsed.skills), JSON.stringify(parsed.companies), JSON.stringify(parsed.work_history),
           JSON.stringify(parsed.education), JSON.stringify(parsed.projects), JSON.stringify(parsed.certifications),
           JSON.stringify(parsed.languages), text, quality.quality_score, JSON.stringify(quality.missing_fields),
           industryResult.industry, regionResult, candidateId]
        )

        try {
          const skillsText = skillNames.join(' ')
          const roleText = parsed.headline || parsed.companies[0]?.title || ''
          const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])
          for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
            await pool.query(
              `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
               VALUES ($1, 'candidate', $2, $3, $4, 'text-embedding-3-small', NOW())
               ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $4`,
              [randomUUID(), candidateId, purpose, vector]
            )
          }
          await indexCandidateToQdrant({
            candidateId, name: candidateName, fullVector: fullVec,
            skills: skillNames, headline: parsed.headline || undefined,
            location: parsed.location || undefined, industry: industryResult.industry || undefined,
          })
        } catch {}

        console.log(`[AutoSync] Ingested: ${candidateName}`)
      } catch (error) {
        await pool.query(
          `UPDATE candidates SET parse_status='failed', parse_error=$1, updated_at=NOW() WHERE id=$2`,
          [String(error).slice(0, 500), candidateId]
        ).catch(() => {})
      }
    }
    console.log(`[AutoSync] Processed ${newFiles.length} new resumes`)
  } catch (err: any) {
    console.error(`[AutoSync] Error:`, err.message)
  } finally {
    autoSyncRunning = false
  }
}

// Start auto-sync polling
setInterval(autoSyncCloudinary, AUTO_SYNC_INTERVAL_MS)
// Run first check after 30 seconds
setTimeout(autoSyncCloudinary, 30_000)

// ─── 404 Handler ─────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ─── Error Handler ────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

export default app
