import type { QdrantManager } from './qdrant-manager.js';
import type { VectorSearchResult, QdrantFilter } from '../types/index.js';
import { VECTOR_CONSTANTS } from '../constants/index.js';

export class QdrantSearcher {
  constructor(private manager: QdrantManager) {}

  async searchCandidates(
    query: number[],
    topK: number = VECTOR_CONSTANTS.DEFAULT_TOP_K,
    filters?: QdrantFilter,
  ): Promise<VectorSearchResult[]> {
    return this.search(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, query, topK, filters);
  }

  async searchJobs(
    query: number[],
    topK: number = VECTOR_CONSTANTS.DEFAULT_TOP_K,
    filters?: QdrantFilter,
  ): Promise<VectorSearchResult[]> {
    return this.search(VECTOR_CONSTANTS.COLLECTIONS.JOBS, query, topK, filters);
  }

  async search(
    collectionName: string,
    query: number[],
    topK: number = VECTOR_CONSTANTS.DEFAULT_TOP_K,
    filters?: QdrantFilter,
  ): Promise<VectorSearchResult[]> {
    const client = this.manager.getClient();

    const searchParams = {
      vector: query,
      limit: Math.min(topK, VECTOR_CONSTANTS.MAX_TOP_K),
      with_payload: true,
      score_threshold: 0.0,
      ...(filters && {
        filter: {
          must: filters.must || [],
          should: filters.should || [],
          must_not: filters.must_not || [],
        },
      }),
    };

    const results = await client.search(collectionName, searchParams);

    return results.map(hit => ({
      entityId: hit.id as string,
      entityType: (hit.payload?.entityType as 'candidate' | 'job') || 'candidate',
      score: hit.score,
      payload: (hit.payload as Record<string, unknown>) || {},
    }));
  }
}
