import express from 'express'
import cors from 'cors'
import { webhooksRouter } from './routes/webhooks.js'
import { jobsRouter } from './routes/jobs.js'
import { candidatesRouter } from './routes/candidates.js'
import { clientsRouter } from './routes/clients.js'
import { healthRouter } from './routes/health.js'
import { uploadRouter } from './routes/upload.js'

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
      callback(null, true) // allow all for now
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
app.use('/api/candidates', candidatesRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/upload', uploadRouter)

// ─── Error Handler ────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

export default app
