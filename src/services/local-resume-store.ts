/**
 * Local copy of resume files, used by resume recovery when the Cloudinary account that
 * holds the originals is not accessible. Point RESUME_LOCAL_DIR at a folder (searched
 * recursively) containing the files.
 *
 * Matching, in order:
 *   1. same file name as the stored URL ("654774000017356006_Juan_Felipe.pdf"), URL-decoded
 *   2. same Zoho Recruit record id (the 15-19 digit prefix), any file name
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { basename, extname, join } from 'path'

const RESUME_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.rtf'])

interface LocalIndex {
  byName: Map<string, string>
  byRecordId: Map<string, string>
  files: number
}

let cached: { dir: string; index: LocalIndex } | null = null

function normaliseName(name: string): string {
  let decoded = name
  try { decoded = decodeURIComponent(name) } catch { /* keep raw */ }
  return decoded.normalize('NFC').toLowerCase().trim()
}

export function recordIdFrom(name: string): string | undefined {
  return name.match(/(?:^|[^0-9])(\d{15,19})(?=[^0-9]|$)/)?.[1]
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && RESUME_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full)
  }
}

export function buildLocalIndex(dir: string): LocalIndex {
  if (cached?.dir === dir) return cached.index
  if (!statSync(dir).isDirectory()) throw new Error(`RESUME_LOCAL_DIR is not a folder: ${dir}`)
  const files: string[] = []
  walk(dir, files)
  const byName = new Map<string, string>()
  const byRecordId = new Map<string, string>()
  for (const file of files) {
    const name = normaliseName(basename(file))
    if (!byName.has(name)) byName.set(name, file)
    const id = recordIdFrom(basename(file))
    if (id && !byRecordId.has(id)) byRecordId.set(id, file)
  }
  const index = { byName, byRecordId, files: files.length }
  cached = { dir, index }
  return index
}

/** Path of the local copy of a stored resume URL or file name, if the folder has one. */
export function findLocalResumePath(sourceUrlOrName: string, dir = process.env.RESUME_LOCAL_DIR): string | undefined {
  if (!dir || !sourceUrlOrName) return undefined
  const index = buildLocalIndex(dir)
  const name = normaliseName(basename(sourceUrlOrName.split('?')[0]))
  const exact = index.byName.get(name)
  if (exact) return exact
  const id = recordIdFrom(name)
  return id ? index.byRecordId.get(id) : undefined
}

export function readLocalResume(sourceUrlOrName: string, dir = process.env.RESUME_LOCAL_DIR): { bytes: Buffer; path: string } | undefined {
  const path = findLocalResumePath(sourceUrlOrName, dir)
  return path ? { bytes: readFileSync(path), path } : undefined
}
