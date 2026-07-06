import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

// ─── Text Extraction ──────────────────────────────────────────

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer)
  return result.text
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

export async function extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
  switch (mimetype) {
    case 'application/pdf':
      return extractTextFromPdf(buffer)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractTextFromDocx(buffer)
    case 'application/msword':
      // Old .doc format — mammoth only supports .docx, try anyway and fall back
      try {
        return await extractTextFromDocx(buffer)
      } catch {
        throw new Error('Cannot parse old .doc format — only .docx is supported')
      }
    case 'text/plain':
      return buffer.toString('utf-8')
    default:
      // Try PDF first, fallback to text
      try {
        return await extractTextFromPdf(buffer)
      } catch {
        return buffer.toString('utf-8')
      }
  }
}
