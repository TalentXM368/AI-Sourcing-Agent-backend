import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'
import Tesseract from 'tesseract.js'

// ─── Limits ───────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MIN_TEXT_LENGTH = 50 // minimum useful text length

// ─── Text Extraction ──────────────────────────────────────────

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

  // Add page markers for multi-page PDFs (helps AI parser understand boundaries)
  if (result.numpages > 1) {
    const pageChunks = text.split(/\f/) // form-feed character
    if (pageChunks.length > 1) {
      text = pageChunks.map((page, i) => `[Page ${i + 1}]\n${page}`).join('\n\n')
    }
  }

  // Detect scanned/image-only PDF (very little text extracted)
  const strippedText = text.replace(/\s/g, '')
  if (result.numpages > 0 && strippedText.length < 50) {
    console.warn(`[TextExtractor] PDF has ${result.numpages} pages but only ${strippedText.length} chars — attempting OCR fallback`)
    try {
      const ocrResult = await Tesseract.recognize(buffer, 'eng')
      const ocrText = ocrResult.data.text || ''
      if (ocrText.trim().length >= MIN_TEXT_LENGTH) {
        console.log(`[TextExtractor] OCR successful: extracted ${ocrText.length} chars`)
        text = ocrText
        // Add page markers for multi-page OCR output
        if (result.numpages > 1) {
          text = `[Page 1]\n${text}`
        }
      } else {
        console.warn(`[TextExtractor] OCR returned only ${ocrText.trim().length} chars — insufficient`)
      }
    } catch (ocrError: any) {
      console.warn(`[TextExtractor] OCR failed: ${ocrError.message?.slice(0, 80)}`)
    }
  }

  if (text.trim().length === 0) {
    throw new Error('PDF contains no extractable text (scanned/image-based, OCR failed)')
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

export async function extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
  let text: string

  switch (mimetype) {
    case 'application/pdf':
      text = await extractTextFromPdf(buffer)
      break

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      text = await extractTextFromDocx(buffer)
      break

    case 'application/msword':
      // Old .doc format — mammoth only supports .docx
      // Try anyway in case it's actually a docx mislabeled as .doc
      try {
        text = await extractTextFromDocx(buffer)
      } catch {
        throw new Error('Old .doc format is not supported — please convert to .docx and re-upload')
      }
      break

    case 'text/plain':
    case 'text/markdown':
      text = buffer.toString('utf-8')
      break

    case 'application/rtf':
      // Basic RTF: strip control words and extract text content
      text = buffer.toString('utf-8')
        .replace(/\{\\[^{}]*\}/g, '') // Remove RTF groups
        .replace(/\\[a-z]+\d*\s?/gi, '') // Remove control words
        .replace(/[{}\\]/g, '') // Remove braces and backslashes
      break

    default:
      // Unknown type — try PDF, then DOCX, then raw text
      if (buffer.length === 0) {
        throw new Error('File is empty (0 bytes)')
      }
      try {
        text = await extractTextFromPdf(buffer)
      } catch {
        try {
          text = await extractTextFromDocx(buffer)
        } catch {
          text = buffer.toString('utf-8')
        }
      }
      break
  }

  // Final validation
  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error(`Extracted text too short (${text?.trim().length || 0} chars) — file may be empty, scanned, or corrupt`)
  }

  return text
}

// ─── Detect MIME type from file extension ─────────────────────

export function detectMimetype(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
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
