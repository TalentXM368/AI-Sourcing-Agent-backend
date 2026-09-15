import { config } from 'dotenv'
import { resolve } from 'path'
import { checkDatabaseConnection, pool } from './db/index.js'
import app from './app.js'

config({ path: resolve(__dirname, '../.env') })

// ─── Global Error Handlers ───────────────────────────────────

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  process.exit(1)
})

// ─── Graceful Shutdown ───────────────────────────────────────

function shutdown() {
  console.log('Shutting down, closing pool...')
  pool.end().then(() => process.exit(0)).catch(() => process.exit(1))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// ─── Start Server ────────────────────────────────────────────

const PORT = process.env.PORT || 3001

async function start() {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log('Database: checking connection in the background')
  })

  const dbConnected = await checkDatabaseConnection()
  const allowDegradedMode = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEGRADED_DB === 'true'

  if (!dbConnected) {
    if (allowDegradedMode) {
      console.warn('Database unavailable; continuing in degraded mode. Request routes that need Postgres will fail until the database quota is reset or a working database is configured.')
    } else {
      console.error('Failed to connect to database. The API will remain available, but database-backed requests will fail until the connection is restored.')
    }
  } else {
    console.log('Database: connected')
  }

  return server
}

start()
