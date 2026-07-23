import { config } from 'dotenv'
import { resolve } from 'path'
import { checkDatabaseConnection, pool, db } from './db/index.js'
import { matchJobToAllCandidates } from './scoring/index.js'
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

// ─── Auto-Rescore Incomplete Jobs on Startup ─────────────────

async function rescoreIncompleteJobs() {
  try {
    const completedCount = await db.selectFrom('candidates')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parse_status', '=', 'completed')
      .executeTakeFirst()

    const total = Number(completedCount?.count ?? 0)
    if (total === 0) {
      console.log('[Startup] No completed candidates, skipping auto-rescore')
      return
    }

    const jobs = await db.selectFrom('jobs')
      .selectAll()
      .where('status', '=', 'open')
      .execute()

    const incomplete: string[] = []
    for (const job of jobs) {
      const ranked = await db.selectFrom('ranked_candidates')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('job_id', '=', job.id)
        .executeTakeFirst()

      if (Number(ranked?.count ?? 0) < total) {
        incomplete.push(job.id)
      }
    }

    if (incomplete.length === 0) {
      console.log(`[Startup] All ${jobs.length} jobs fully scored (${total} candidates each)`)
      return
    }

    console.log(`[Startup] Found ${incomplete.length}/${jobs.length} incomplete jobs, re-scoring...`)

    for (const jobId of incomplete) {
      try {
        await matchJobToAllCandidates(jobId)
      } catch (err: any) {
        console.error(`[Startup] Failed to rescore job ${jobId}:`, err.message)
      }
    }

    console.log(`[Startup] Auto-rescore complete`)
  } catch (err: any) {
    console.error('[Startup] Auto-rescore check failed:', err.message)
  }
}

// ─── Start Server ────────────────────────────────────────────

const PORT = process.env.PORT || 3001

async function start() {
  const dbConnected = await checkDatabaseConnection()
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting.')
    process.exit(1)
  }

  app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Database: connected`)

    // Run auto-rescore in background (non-blocking)
    rescoreIncompleteJobs().catch(() => {})
  })
}

start()
