import { pool } from './index.js'

export async function createDocumentsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR PRIMARY KEY,
      entity_type VARCHAR NOT NULL,
      entity_id VARCHAR NOT NULL,
      purpose VARCHAR NOT NULL,
      content TEXT,
      content_hash VARCHAR,
      mime_type VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(entity_type, entity_id, purpose)
    )
  `).catch(() => {})
}

export async function insertDocument(entityId: string, entityType: string, purpose: string, content: string, mimeType?: string): Promise<void> {
  await pool.query(
    `INSERT INTO documents (id, entity_type, entity_id, purpose, content, mime_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET content = $5, mime_type = $6, updated_at = NOW()`,
    [entityId, entityType, purpose, content, mimeType || null]
  )
}

export async function getDocument(entityId: string, entityType: string, purpose: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT content FROM documents WHERE entity_type = $1 AND entity_id = $2 AND purpose = $3`,
    [entityType, entityId, purpose]
  )
  return result.rows[0]?.content || null
}

export async function deleteDocumentsByEntity(entityId: string): Promise<void> {
  await pool.query(`DELETE FROM documents WHERE entity_id = $1`, [entityId])
}
