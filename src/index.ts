import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { resolve } from 'path'
import { db, checkDatabaseConnection } from './db/index.js'
import { webhooksRouter } from './routes/webhooks.js'
import { jobsRouter } from './routes/jobs.js'
import { candidatesRouter } from './routes/candidates.js'
import { clientsRouter } from './routes/clients.js'
import { healthRouter } from './routes/health.js'
import { uploadRouter } from './routes/upload.js'

config({ path: resolve(__dirname, '../.env') })

const app = express()
const PORT = process.env.PORT || 3001

// ─── Middleware ────────────────────────────────────────────────

app.use(cors({
  origin: true,
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

// ─── Start Server ─────────────────────────────────────────────

async function start() {
  const dbConnected = await checkDatabaseConnection()
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting.')
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Database: connected`)
  })
}

start()
