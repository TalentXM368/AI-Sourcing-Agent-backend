import type { QdrantManager } from './qdrant-manager.js';
import type { QdrantPayload } from '../types/index.js';
import { VECTOR_CONSTANTS } from '../constants/index.js';

export class QdrantIndexer {
  constructor(private manager: QdrantManager) {}

  async upsertCandidate(entityId: string, vector: number[], payload: QdrantPayload): Promise<void> {
    const client = this.manager.getClient();
    await client.upsert(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, {
      wait: true,
      points: [{
        id: entityId,
        vector,
        payload: payload as unknown as Record<string, unknown>,
      }],
    });
  }

  async upsertJob(entityId: string, vector: number[], payload: QdrantPayload): Promise<void> {
    const client = this.manager.getClient();
    await client.upsert(VECTOR_CONSTANTS.COLLECTIONS.JOBS, {
      wait: true,
      points: [{
        id: entityId,
        vector,
        payload: payload as unknown as Record<string, unknown>,
      }],
    });
  }

  async upsertBatch(
    collectionName: string,
    points: Array<{ entityId: string; vector: number[]; payload: QdrantPayload }>,
  ): Promise<void> {
    if (points.length === 0) return;

    const client = this.manager.getClient();
    const batchSize = VECTOR_CONSTANTS.QUEUE.BATCH_SIZE;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await client.upsert(collectionName, {
        wait: true,
        points: batch.map(p => ({
          id: p.entityId,
          vector: p.vector,
          payload: p.payload as unknown as Record<string, unknown>,
        })),
      });
    }
  }

  async deleteCandidate(entityId: string): Promise<void> {
    const client = this.manager.getClient();
    await client.delete(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, {
      wait: true,
      filter: {
        must: [{
          key: 'entityId',
          match: { value: entityId },
        }],
      },
    });
  }

  async deleteJob(entityId: string): Promise<void> {
    const client = this.manager.getClient();
    await client.delete(VECTOR_CONSTANTS.COLLECTIONS.JOBS, {
      wait: true,
      filter: {
        must: [{
          key: 'entityId',
          match: { value: entityId },
        }],
      },
    });
  }

  async deleteBatch(collectionName: string, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return;

    const client = this.manager.getClient();
    await client.delete(collectionName, {
      wait: true,
      filter: {
        must: [{
          key: 'entityId',
          match: { keyword: entityIds },
        }],
      },
    });
  }

  async reindexCollection(
    collectionName: string,
    fetchFn: () => AsyncGenerator<{ entityId: string; vector: number[]; payload: QdrantPayload }>,
  ): Promise<{ indexed: number; errors: number }> {
    let indexed = 0;
    let errors = 0;

    try {
      for await (const item of fetchFn()) {
        try {
          const client = this.manager.getClient();
          await client.upsert(collectionName, {
            wait: true,
            points: [{
              id: item.entityId,
              vector: item.vector,
              payload: item.payload as unknown as Record<string, unknown>,
            }],
          });
          indexed++;
        } catch (error) {
          console.error(`[QdrantIndexer] Failed to index ${item.entityId}:`, error);
          errors++;
        }
      }
    } catch (error) {
      console.error(`[QdrantIndexer] Reindex iteration failed:`, error);
    }

    return { indexed, errors };
  }
}
