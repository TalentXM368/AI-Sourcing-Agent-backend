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
