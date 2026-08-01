import { registerWorker } from '../index.js';
import type { QueueJobData } from '../job-types.js';
import { pool } from '../../db/index.js';
import { getEmbeddingService } from '../../modules/vector-intelligence/factory.js';

export function registerEmbeddingWorker() {
  registerWorker('embedding-generation', async (data: QueueJobData) => {
    const { entityType, entityId } = data as { entityType: 'candidate' | 'job'; entityId: string };

    const table = entityType === 'candidate' ? 'candidates' : 'jobs';
    const row = await pool.query(
      `SELECT id, name, headline, location, summary, skills, raw_text FROM ${table} WHERE id = $1`,
      [entityId],
    );
    if (row.rows.length === 0) throw new Error(`${entityType} ${entityId} not found`);

    const record = row.rows[0];
    const fullText = [record.name, record.headline, record.location, record.summary, JSON.stringify(record.skills), record.raw_text]
      .filter(Boolean).join(' ');
    const skillsText = Array.isArray(record.skills) ? record.skills.join(' ') : '';
    const roleText = record.headline || '';

    const { generateEmbeddings } = await import('../../services/openai.js');
    const vectors = await generateEmbeddings([fullText, skillsText, roleText]);

    const purposes = ['full_text', 'skills', 'role'];
    for (let i = 0; i < vectors.length && i < purposes.length; i++) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'text-embedding-3-small', NOW())
         ON CONFLICT (entity_type, entity_id, purpose)
         DO UPDATE SET vector = $4, model = 'text-embedding-3-small'`,
        [entityType, entityId, purposes[i], vectors[i]],
      );
    }

    const embeddingService = getEmbeddingService();
    if (embeddingService) {
      try {
        const provider = (embeddingService as any).provider;
        if (provider && typeof provider.generateEmbeddings === 'function') {
          const [qdrantVector] = await provider.generateEmbeddings([fullText]);
          const indexer = (embeddingService as any).indexer;
          if (entityType === 'candidate') {
            await indexer.upsertCandidate(entityId, qdrantVector, {
              name: record.name, headline: record.headline,
              location: record.location, skills: record.skills,
              indexedAt: new Date().toISOString(),
            });
          } else {
            await indexer.upsertJob(entityId, qdrantVector, {
              role: record.headline, company: record.name,
              location: record.location, skills: record.skills,
              indexedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error(`[Embedding] Qdrant indexing failed (non-critical):`, err);
      }
    }

    return { entityType, entityId, purposes, vectorCount: vectors.length };
  });
}
