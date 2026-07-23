import express from 'express'
import cors from 'cors'
import { webhooksRouter } from './routes/webhooks.js'
import { jobsRouter } from './routes/jobs.js'
import { candidatesRouter } from './routes/candidates.js'
import { clientsRouter } from './routes/clients.js'
import { healthRouter } from './routes/health.js'
import { uploadRouter } from './routes/upload.js'
import { settingsRouter } from './routes/settings.js'
import { pdlSearchRouter } from './routes/pdl-search.js'

const app = express()

// ─── Middleware ────────────────────────────────────────────────

const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:5173',
  'https://ai-sourcing-agent-one.vercel.app',
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
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ─── Routes ───────────────────────────────────────────────────

app.use('/api/health', healthRouter)
app.use('/api/webhooks', webhooksRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/candidates', pdlSearchRouter)
app.use('/api/candidates', candidatesRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/settings', settingsRouter)

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
