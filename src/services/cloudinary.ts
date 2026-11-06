import { v2 as cloudinary } from 'cloudinary'
import AdmZip from 'adm-zip'

export { cloudinary }

// ─── Configure Cloudinary ─────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// ─── List PDFs/DOCXs in a Folder ──────────────────────────────

export async function listCloudinaryFolder(
  folder: string,
  maxResults: number = 200
): Promise<Array<{ public_id: string; secure_url: string; format: string; created_at: string; bytes: number }>> {
  try {
    const expression = `resource_type:raw AND folder:${folder}`
    const result = await cloudinary.search
      .expression(expression)
      .max_results(maxResults)
      .execute()

    return (result.resources || []).map((r: any) => ({
      public_id: r.public_id,
      secure_url: r.secure_url,
      format: r.format,
      created_at: r.created_at,
      bytes: r.bytes,
    }))
  } catch (error) {
    console.error(`[Cloudinary] Failed to list folder ${folder}:`, error)
    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'raw',
        prefix: folder + '/',
        max_results: maxResults,
      })
      return (result.resources || []).map((r: any) => ({
        public_id: r.public_id,
        secure_url: r.secure_url,
        format: r.format,
        created_at: r.created_at,
        bytes: r.bytes,
      }))
    } catch (fallbackError) {
      console.error(`[Cloudinary] Fallback also failed:`, fallbackError)
      return []
    }
  }
}

// ─── List ALL Files in Folder (auto-paginated) ──────────────

export interface CloudinaryFile {
  public_id: string
  secure_url: string
  format: string
  filename: string
  created_at: string
  bytes: number
}

export async function listAllCloudinaryResumes(
  folder: string = 'candidates/Resumes'
): Promise<CloudinaryFile[]> {
  const allFiles: CloudinaryFile[] = []
  let cursor: string | undefined = undefined
  let page = 0

  do {
    page++
    const opts: any = {
      type: 'upload',
      resource_type: 'raw',
      prefix: folder + '/',
      max_results: 500,
    }
    if (cursor) opts.next_cursor = cursor

    const result = await cloudinary.api.resources(opts)
    const resources = result.resources || []

    for (const r of resources) {
      const publicId: string = r.public_id || ''
      const filename = publicId.split('/').pop() || publicId
      allFiles.push({
        public_id: publicId,
        secure_url: r.secure_url,
        format: filename.split('.').pop()?.toLowerCase() || '',
        filename,
        created_at: r.created_at,
        bytes: r.bytes || 0,
      })
    }

    cursor = result.next_cursor
    console.log(`[Cloudinary] Page ${page}: fetched ${resources.length} files (total: ${allFiles.length})`)
  } while (cursor)

  console.log(`[Cloudinary] Total files in ${folder}: ${allFiles.length}`)
  return allFiles
}

// ─── Generate Signed URL for a Single File ───────────────────

export function getSignedUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'upload',
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  })
}

// ─── Fetch File from Cloudinary ───────────────────────────────

async function downloadBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) {
      throw new Error('Cloudinary returned an empty file')
    }
    return buffer
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Cloudinary fetch timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function downloadFromArchive(publicId: string): Promise<Buffer> {
  const archiveUrl = cloudinary.utils.download_archive_url({
    resource_type: 'raw',
    type: 'upload',
    public_ids: [publicId],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  })
  const zipBuffer = await downloadBuffer(archiveUrl, 60_000)
  const entries = new AdmZip(zipBuffer).getEntries().filter(entry => !entry.isDirectory)
  const expectedName = publicId.split('/').pop()?.toLowerCase()
  const matchingEntry = expectedName
    ? entries.find(entry => {
      const entryName = entry.entryName.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
      return entryName === expectedName || entryName?.startsWith(`${expectedName}.`)
    })
    : undefined
  const selectedEntry = matchingEntry || (entries.length === 1 ? entries[0] : undefined)

  if (!selectedEntry) {
    throw new Error(entries.length === 0 ? 'Cloudinary archive contains no files' : 'Cloudinary archive does not contain the requested file')
  }

  const buffer = selectedEntry.getData()
  if (buffer.length === 0) {
    throw new Error('Cloudinary archive contains an empty file')
  }
  return buffer
}

export async function fetchFromCloudinary(url: string, publicId?: string): Promise<Buffer> {
  try {
    return await downloadBuffer(url, 30_000)
  } catch (directError) {
    if (!publicId) {
      console.error('[Cloudinary] Direct file download failed:', directError)
      throw directError
    }

    console.warn('[Cloudinary] Direct file download failed; retrying with a single-file archive')
    try {
      return await downloadFromArchive(publicId)
    } catch (archiveError) {
      const directMessage = directError instanceof Error ? directError.message : String(directError)
      const archiveMessage = archiveError instanceof Error ? archiveError.message : String(archiveError)
      const error = new Error(`Cloudinary direct download failed (${directMessage}); archive fallback failed (${archiveMessage})`)
      console.error('[Cloudinary] Both download methods failed:', error)
      throw error
    }
  }
}

// ─── Upload to Cloudinary ─────────────────────────────────────

export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  filename: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          reject(error)
        } else {
          resolve(result?.secure_url || '')
        }
      }
    )

    uploadStream.end(buffer)
  })
}

export async function uploadRawResumeToCloudinary(
  buffer: Buffer,
  folder: string,
  publicId: string,
): Promise<{ publicId: string; secureUrl: string }> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'raw',
        type: 'upload',
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          reject(error)
        } else if (!result?.public_id || !result.secure_url) {
          reject(new Error('Cloudinary upload response omitted the public ID or secure URL'))
        } else {
          resolve({ publicId: result.public_id, secureUrl: result.secure_url })
        }
      },
    )
    uploadStream.end(buffer)
  })
}
