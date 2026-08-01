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
import { searchAllRouter } from './routes/search-all.js'
import { searchHistoryRouter } from './routes/search-history.js'
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
app.use('/api/webhooks', webhooksRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/candidates', pdlSearchRouter)
app.use('/api/candidates', githubSearchRouter)
app.use('/api/candidates', stackoverflowSearchRouter)
app.use('/api/candidates', kaggleSearchRouter)
app.use('/api/candidates', searchAllRouter)
app.use('/api', searchHistoryRouter)
app.use('/api/candidates', candidatesRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/settings', settingsRouter)

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
