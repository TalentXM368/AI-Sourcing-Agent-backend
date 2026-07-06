import { v2 as cloudinary } from 'cloudinary'
import AdmZip from 'adm-zip'

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

// ─── Fetch File from Cloudinary (via archive download) ────────

export async function fetchFromCloudinary(url: string, publicId?: string): Promise<Buffer> {
  try {
    if (publicId) {
      const archiveUrl = cloudinary.utils.download_archive_url({
        resource_type: 'raw',
        type: 'upload',
        public_ids: [publicId],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })

      const response = await fetch(archiveUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      const zipBuffer = Buffer.from(arrayBuffer)

      const zip = new AdmZip(zipBuffer)
      const entries = zip.getEntries()
      if (entries.length === 0) {
        throw new Error('Empty archive')
      }

      return entries[0].getData()
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (error) {
    console.error('[Cloudinary] Fetch failed:', error)
    throw error
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
