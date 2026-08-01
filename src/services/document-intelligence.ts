// ─── Document Intelligence Service Client ──────────────────────
// HTTP client for the Python Document Intelligence microservice.
// Replaces extractTextFromBuffer() from text-extractor.ts.

const DI_URL = process.env.DOCUMENT_INTELLIGENCE_URL || 'http://localhost:8000'
const DI_TIMEOUT_MS = 60_000
const DI_HEALTH_CHECK_MS = 3_000

// ─── Health Cache ──────────────────────────────────────────────
// Avoid hitting Docling on every upload. Cache health status for 15s.
let _lastHealthCheck = 0
let _isHealthy = false
const HEALTH_CACHE_MS = 15_000

export interface BoundingBox {
  x0: number
  y0: number
  x1: number
  y1: number
  page: number
}

export interface ASTBlock {
  id: string
  type: 'page' | 'heading' | 'paragraph' | 'table' | 'list' | 'list_item' | 'image' | 'caption' | 'code' | 'page_header' | 'page_footer' | 'unknown'
  content: string
  readingOrder: number
  bbox: BoundingBox | null
  level: number | null
  confidence: number
}

export interface ASTPage {
  pageNumber: number
  width: number | null
  height: number | null
  blocks: ASTBlock[]
}

export interface DocumentAST {
  totalPages: number
  totalBlocks: number
  pages: ASTPage[]
}

export interface ConfidenceScores {
  parser: number
  layout: number
  section: number
  ocr: number
  overall: number
}

export interface QualityFlags {
  isScanned: boolean
  needsOcr: boolean
  isMultiColumn: boolean
  hasRotation: boolean
  isCorrupted: boolean
  hasTables: boolean
  hasImages: boolean
  textDensity: number
  columnCountEstimate: number
}

interface DocumentIntelligenceResponse {
  documentId: string
  parser: string
  parserVersion: string
  processingTime: number
  confidence: ConfidenceScores
  metadata: {
    pageCount: number
    fileSize: number
    fileType: string
    language: string | null
    parserVersion: string
    processingTime: number
  }
  quality: QualityFlags
  markdown: string
  plainText: string
  ast: DocumentAST
  sections: Array<{
    name: string
    content: string
    startPosition: number
    endPosition: number
    confidence: number
    level: number | null
    blockIds: string[]
  }>
  tables: Array<{
    markdown: string
    rowCount: number
    columnCount: number
    bbox: BoundingBox | null
    blockId: string | null
  }>
  images: Array<{
    caption: string | null
    width: number | null
    height: number | null
    bbox: BoundingBox | null
    blockId: string | null
  }>
  documentStructure: {
    hasSections: boolean
    hasTables: boolean
    hasImages: boolean
    headingCount: number
    listCount: number
    paragraphCount: number
  }
}

export interface DocumentIntelligenceResult {
  text: string
  markdown: string
  ast: DocumentAST
  confidence: ConfidenceScores
  quality: QualityFlags
  sections: DocumentIntelligenceResponse['sections']
  tables: DocumentIntelligenceResponse['tables']
  metadata: DocumentIntelligenceResponse['metadata']
}

/**
 * Parse a document via the Document Intelligence Service.
 *
 * Drop-in replacement for extractTextFromBuffer():
 *   const result = await extractWithDocumentIntelligence(buffer, mimetype)
 *   const text = result.text
 */
export async function extractWithDocumentIntelligence(
  buffer: Buffer,
  mimetype: string,
  filename: string = 'document',
): Promise<DocumentIntelligenceResult> {
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mimetype }), filename)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DI_TIMEOUT_MS)

  try {
    const response = await fetch(`${DI_URL}/parse-document`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Document Intelligence error ${response.status}: ${body}`,
      )
    }

    const data = await response.json() as DocumentIntelligenceResponse

    return {
      text: data.plainText,
      markdown: data.markdown,
      ast: data.ast,
      confidence: data.confidence,
      quality: data.quality,
      sections: data.sections,
      tables: data.tables,
      metadata: data.metadata,
    }
  } catch (error: any) {
    clearTimeout(timeout)

    if (error.name === 'AbortError') {
      throw new Error('Document Intelligence request timed out')
    }

    throw error
  }
}

/**
 * Check if the Document Intelligence Service is healthy.
 * Caches result for 15s to avoid flooding with health checks.
 */
export async function checkDocumentIntelligenceHealth(): Promise<boolean> {
  const now = Date.now()
  if (now - _lastHealthCheck < HEALTH_CACHE_MS) {
    return _isHealthy
  }

  try {
    const response = await fetch(`${DI_URL}/health`, {
      signal: AbortSignal.timeout(DI_HEALTH_CHECK_MS),
    })
    const data = await response.json() as { status: string }
    _isHealthy = data.status === 'healthy'
  } catch {
    _isHealthy = false
  }

  _lastHealthCheck = now
  return _isHealthy
}

/**
 * Force a health check (bypasses cache). Used before parse attempts.
 */
export async function forceHealthCheck(): Promise<boolean> {
  _lastHealthCheck = 0
  return checkDocumentIntelligenceHealth()
}

/**
 * Auto-restart the Docling service if it's not running.
 * This is a best-effort attempt — if it fails, the LLM fallback is used.
 */
let _restartAttempted = false
export async function ensureDocumentIntelligenceRunning(): Promise<boolean> {
  // Already healthy
  if (await checkDocumentIntelligenceHealth()) {
    _restartAttempted = false
    return true
  }

  // Don't spam — try once per backend lifecycle
  if (_restartAttempted) {
    return false
  }
  _restartAttempted = true

  console.log(`[Document Intelligence] Service is down at ${DI_URL}. Cannot auto-restart (deployed remotely).`)

  // Wait up to 10s in case it's starting up
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000))
    _lastHealthCheck = 0
    if (await checkDocumentIntelligenceHealth()) {
      console.log('[Document Intelligence] Service is now healthy')
      return true
    }
  }

  console.warn('[Document Intelligence] Service did not become healthy. LLM fallback will be used.')
  return false
}
