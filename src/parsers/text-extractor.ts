import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'
import { extractWithDocumentIntelligence, checkDocumentIntelligenceHealth } from '../services/document-intelligence.js'

// ─── Limits ───────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MIN_TEXT_LENGTH = 50 // minimum useful text length

// ─── Text Extraction ──────────────────────────────────
// Primary: Document Intelligence Service (Docling)
// Fallback: pdf-parse / mammoth / raw text

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`PDF too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB) — max ${MAX_FILE_SIZE / 1024 / 1024}MB`)
  }

  if (buffer.length === 0) {
    throw new Error('PDF file is empty (0 bytes)')
  }

  // Check PDF header magic bytes
  const header = buffer.slice(0, 5).toString('ascii')
  if (!header.startsWith('%PDF')) {
    throw new Error('Not a valid PDF file (missing %PDF header)')
  }

  const result = await pdfParse(buffer)
  let text = result.text || ''

  // Add page markers for multi-page PDFs
  if (result.numpages > 1) {
    const pageChunks = text.split(/\f/)
    if (pageChunks.length > 1) {
      text = pageChunks.map((page, i) => `[Page ${i + 1}]\n${page}`).join('\n\n')
    }
  }

  if (text.trim().length === 0) {
    throw new Error('PDF contains no extractable text (scanned/image-based)')
  }

  return text
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`DOCX too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB) — max ${MAX_FILE_SIZE / 1024 / 1024}MB`)
  }

  if (buffer.length === 0) {
    throw new Error('DOCX file is empty (0 bytes)')
  }

  const result = await mammoth.extractRawText({ buffer })
  const text = result.value || ''

  if (text.trim().length === 0) {
    throw new Error('DOCX contains no extractable text')
  }

  return text
}

// ─── Primary: DI Service ──────────────────────────────

export async function extractTextViaDI(buffer: Buffer, mimetype: string, filename: string): Promise<string | null> {
  try {
    const healthy = await checkDocumentIntelligenceHealth()
    if (!healthy) return null

    const result = await extractWithDocumentIntelligence(buffer, mimetype, filename)
    const text = result.text?.trim()
    if (text && text.length >= MIN_TEXT_LENGTH) {
      console.log(`[TextExtractor] DI service extracted ${text.length} chars`)
      return text
    }
    return null
  } catch {
    return null
  }
}

// ─── Unified Extraction ───────────────────────────────

export async function extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
  // Try DI service first for PDFs
  if (mimetype === 'application/pdf') {
    const diText = await extractTextViaDI(buffer, mimetype, 'document.pdf')
    if (diText) return diText
  }

  // Fallback to native extractors
  let text: string

  switch (mimetype) {
    case 'application/pdf':
      text = await extractTextFromPdf(buffer)
      break
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      text = await extractTextFromDocx(buffer)
      break
    case 'application/msword':
      try { text = await extractTextFromDocx(buffer) } catch { throw new Error('Old .doc format is not supported — please convert to .docx') }
      break
    case 'text/plain':
    case 'text/markdown':
      text = buffer.toString('utf-8')
      break
    case 'application/rtf':
      text = buffer.toString('utf-8')
        .replace(/\{\\[^{}]*\}/g, '')
        .replace(/\\[a-z]+\\d*\\s?/gi, '')
        .replace(/[{}\\]/g, '')
      break
    default:
      try { text = await extractTextFromPdf(buffer) } catch {
        try { text = await extractTextFromDocx(buffer) } catch { text = buffer.toString('utf-8') }
      }
      break
  }

  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error(`Extracted text too short (${text?.trim().length || 0} chars)`)
  }

  return text
}

// ─── Detect MIME type from file extension ─────────────

export function detectMimetype(filename: string): string {
  const cleanFilename = filename.split(/[?#]/, 1)[0]
  const ext = cleanFilename.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'rtf': 'application/rtf',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
