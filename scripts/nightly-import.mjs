/**
 * Nightly runner (replaces scheduled-import.cmd, which Windows stopped instantly when it ran
 * without a console window). Runs each step as its own Node process, in order, appending all
 * output to logs/import.log. Safe to start any time: every step resumes where it stopped.
 *
 *   node scripts/nightly-import.mjs            (Task Scheduler runs this)
 *
 * Env: IMPORT_LIMIT (default 4000), IMPORT_MAX_MINUTES (default 180)
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'logs'), { recursive: true })
const logPath = resolve(root, 'logs', 'import.log')
const log = (line) => appendFileSync(logPath, `${line}\n`)

const limit = process.env.IMPORT_LIMIT || '4000'
const maxMinutes = process.env.IMPORT_MAX_MINUTES || '180'
const steps = [
  ['scripts/import-cloudinary.ts', 'inventory'],
  ['scripts/import-cloudinary.ts', 'retry-failed'],
  ['scripts/import-cloudinary.ts', 'refresh'],
  ['scripts/import-cloudinary.ts', 'run', '--limit', limit, '--concurrency', '4', '--max-minutes', maxMinutes],
  ['scripts/run-recovery.ts', 'resume'],
  // Candidate Trust: fingerprint new resumes, then re-check only the candidates users chose.
  ['scripts/run-trust-check.ts', 'nightly'],
]

// Console Ctrl+C / Ctrl+Break events from other programs in the same session were killing
// unattended runs (exit 0xC000013A). Ignore them here; each step also gets its own console.
process.on('SIGINT', () => log(`(ignored SIGINT ${new Date().toISOString()})`))
process.on('SIGBREAK', () => log(`(ignored SIGBREAK ${new Date().toISOString()})`))

log(`==== nightly run ${new Date().toISOString()} ====`)
for (const step of steps) {
  log(`---- ${step.join(' ')} (${new Date().toISOString()})`)
  const fd = openSync(logPath, 'a')
  const result = spawnSync(process.execPath, ['--max-old-space-size=2048', '--import', 'tsx', ...step], {
    cwd: root,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    detached: true, // own process group/console: not reached by Ctrl+C sent to the parent's console
  })
  closeSync(fd)
  log(`---- exit ${result.status ?? result.signal ?? result.error?.message}`)
}
log(`==== nightly run finished ${new Date().toISOString()} ====`)
