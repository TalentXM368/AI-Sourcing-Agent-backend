import { registerWorker } from '../index.js';
import type { QueueJobData } from '../job-types.js';
import { getEmbeddingService } from '../../modules/vector-intelligence/factory.js';
import { pool } from '../../db/index.js';

export function registerIndexingWorker() {
  registerWorker('indexing', async (data: QueueJobData) => {
    const { entityType, entityId } = data as { entityType: 'candidate' | 'job'; entityId: string };

    const embeddingService = getEmbeddingService();
    if (!embeddingService) {
      return { skipped: true, reason: 'EmbeddingService not available' };
    }

    const query = entityType === 'candidate'
      ? `SELECT name, headline, location, summary, skills, raw_text FROM candidates WHERE id = $1`
      : `SELECT role, company, location, required_skills FROM jobs WHERE id = $1`;
    const row = await pool.query(query, [entityId]);
    if (row.rows.length === 0) throw new Error(`${entityType} ${entityId} not found`);

    const record = row.rows[0];
    const provider = (embeddingService as any).provider;
    if (!provider) return { skipped: true, reason: 'No provider' };

    const fullText = [record.name || record.role, record.headline, record.location, record.summary, JSON.stringify(record.skills), record.raw_text]
      .filter(Boolean).join(' ');
    const [vector] = await provider.generateEmbeddings([fullText]);

    const indexer = (embeddingService as any).indexer;
    if (!indexer) return { skipped: true, reason: 'No indexer' };

    if (entityType === 'candidate') {
      await indexer.upsertCandidate(entityId, vector, {
        name: record.name, headline: record.headline,
        location: record.location, skills: record.skills,
        indexedAt: new Date().toISOString(),
      });
    } else {
      await indexer.upsertJob(entityId, vector, {
        role: record.role, company: record.company,
        location: record.location, skills: record.required_skills,
        indexedAt: new Date().toISOString(),
      });
    }

    return { entityType, entityId, indexed: true };
  });
}
