/**
 * Manual import runner started from VS Code (not Task Scheduler). Same safeguards as
 * nightly-import.mjs: ignores Ctrl+C / Ctrl+Break and runs each step in its own process
 * group. Skips the slow inventory step; resumes the queue where it stopped.
 *   node scripts/vscode-import.mjs     (env: IMPORT_CONCURRENCY, default 3)
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'logs'), { recursive: true })
const logPath = resolve(root, 'logs', 'import.log')
const log = (line) => appendFileSync(logPath, `${line}\n`)
const concurrency = process.env.IMPORT_CONCURRENCY || '3'
const steps = [
  ['scripts/import-cloudinary.ts', 'run', '--limit', '20000', '--concurrency', concurrency, '--max-minutes', '900'],
  ['scripts/run-recovery.ts', 'resume'],
]
process.on('SIGINT', () => log(`(ignored SIGINT ${new Date().toISOString()})`))
process.on('SIGBREAK', () => log(`(ignored SIGBREAK ${new Date().toISOString()})`))

log(`\n==== VS Code run ${new Date().toISOString()} (concurrency ${concurrency}) ====`)
for (const step of steps) {
  log(`---- ${step.join(' ')} (${new Date().toISOString()})`)
  const fd = openSync(logPath, 'a')
  const result = spawnSync(process.execPath, ['--max-old-space-size=2048', '--import', 'tsx', ...step], {
    cwd: root, stdio: ['ignore', fd, fd], windowsHide: true, detached: true,
  })
  closeSync(fd)
  log(`---- exit ${result.status ?? result.signal ?? result.error?.message}`)
}
log(`==== VS Code run finished ${new Date().toISOString()} ====`)
