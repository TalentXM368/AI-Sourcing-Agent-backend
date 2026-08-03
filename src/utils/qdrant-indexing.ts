// ─── Qdrant Indexing Helper ──────────────────────────────────
// Shared utility for indexing candidates into Qdrant from all upload paths.
// This ensures semantic search works regardless of which parsing path was used.

import { VECTOR_CONSTANTS } from '../modules/vector-intelligence/constants/index.js';

export interface QdrantIndexCandidateOpts {
  candidateId: string;
  name: string;
  fullVector: number[];
  skills?: string[];
  headline?: string;
  location?: string;
  experienceYears?: number;
  industry?: string;
}

/**
 * Index a candidate into Qdrant for semantic search.
 * Called after PostgreSQL embeddings are stored, from all upload paths.
 * Uses the already-generated full_text vector (no re-embedding).
 */
export async function indexCandidateToQdrant(opts: QdrantIndexCandidateOpts): Promise<void> {
  try {
    const { QdrantManager } = await import('../modules/vector-intelligence/qdrant/qdrant-manager.js');
    const manager = new QdrantManager();
    const client = manager.getClient();

    const payload = {
      entityId: opts.candidateId,
      entityType: 'candidate' as const,
      embeddingVersion: VECTOR_CONSTANTS.EMBEDDING_VERSION,
      profileVersion: VECTOR_CONSTANTS.PROFILE_VERSION,
      provider: process.env.EMBEDDING_PROVIDER || 'openai',
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      dimensions: opts.fullVector.length,
      indexedAt: new Date().toISOString(),
      name: opts.name,
      headline: opts.headline || undefined,
      skills: opts.skills || [],
      location: opts.location || undefined,
      experienceYears: opts.experienceYears ?? undefined,
      industry: opts.industry || undefined,
    };

    await client.upsert(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, {
      wait: true,
      points: [{
        id: opts.candidateId,
        vector: opts.fullVector,
        payload: payload as unknown as Record<string, unknown>,
      }],
    });

    console.log(`[QdrantIndex] Indexed candidate: ${opts.name} (${opts.candidateId})`);
  } catch (error) {
    // Non-critical — don't fail the whole pipeline
    console.error(`[QdrantIndex] Failed to index candidate ${opts.candidateId}:`, error);
  }
}
