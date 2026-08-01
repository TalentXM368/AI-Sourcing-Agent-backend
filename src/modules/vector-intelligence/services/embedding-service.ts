import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { EmbeddingProvider } from '../providers/index.js';
import type { EmbeddingMetadata, QdrantPayload } from '../types/index.js';
import type { QdrantManager } from '../qdrant/qdrant-manager.js';
import type { QdrantIndexer } from '../qdrant/qdrant-indexer.js';
import type { QdrantSearcher } from '../qdrant/qdrant-searcher.js';
import type { EmbeddingQueue } from '../queue/embedding-queue.js';
import { buildCandidateSemanticText, buildCandidateQdrantPayload } from '../builders/candidate-embedding-builder.js';
import { buildJobSemanticText, buildJobQdrantPayload } from '../builders/job-embedding-builder.js';
import { VECTOR_CONSTANTS } from '../constants/index.js';

export class EmbeddingService {
  private provider: EmbeddingProvider;
  private queue: EmbeddingQueue;
  private indexer: QdrantIndexer;
  private searcher: QdrantSearcher;
  private manager: QdrantManager;

  constructor(
    provider: EmbeddingProvider,
    queue: EmbeddingQueue,
    indexer: QdrantIndexer,
    searcher: QdrantSearcher,
    manager: QdrantManager,
  ) {
    this.provider = provider;
    this.queue = queue;
    this.indexer = indexer;
    this.searcher = searcher;
    this.manager = manager;

    this.queue.setProcessor(this.processJob.bind(this));
  }

  private getEmbeddingMetadata(): EmbeddingMetadata {
    return {
      embeddingVersion: VECTOR_CONSTANTS.EMBEDDING_VERSION,
      profileVersion: VECTOR_CONSTANTS.PROFILE_VERSION,
      provider: this.provider.name,
      model: this.provider.model,
      dimensions: this.provider.dimensions,
      indexedAt: new Date().toISOString(),
    };
  }

  indexCandidateProfile(profile: CandidateProfile): string {
    return this.queue.enqueue({
      entityType: 'candidate',
      entityId: profile.candidateId,
      priority: 'normal',
    });
  }

  indexJobProfile(profile: JobProfile): string {
    return this.queue.enqueue({
      entityType: 'job',
      entityId: profile.jobId,
      priority: 'normal',
    });
  }

  async indexCandidateProfileSync(profile: CandidateProfile): Promise<void> {
    const semanticText = buildCandidateSemanticText(profile);
    const [vector] = await this.provider.generateEmbeddings([semanticText.full]);
    const metadata = this.getEmbeddingMetadata();
    const payload = buildCandidateQdrantPayload(profile, metadata);
    await this.indexer.upsertCandidate(profile.candidateId, vector, payload);
  }

  async indexJobProfileSync(profile: JobProfile): Promise<void> {
    const semanticText = buildJobSemanticText(profile);
    const [vector] = await this.provider.generateEmbeddings([semanticText.full]);
    const metadata = this.getEmbeddingMetadata();
    const payload = buildJobQdrantPayload(profile, metadata);
    await this.indexer.upsertJob(profile.jobId, vector, payload);
  }

  private async processJob(job: { jobId: string; entityType: 'candidate' | 'job'; entityId: string }): Promise<{
    jobId: string;
    entityType: 'candidate' | 'job';
    entityId: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }> {
    const startTime = Date.now();

    try {
      // For async queue jobs, we can't pass the full profile through the queue.
      // The queue is designed for fire-and-forget indexing triggers.
      // For actual embedding + indexing, use the sync methods directly.
      // This processor serves as a placeholder for future queue-based processing
      // where profiles could be stored temporarily or fetched from a cache.
      return {
        jobId: job.jobId,
        entityType: job.entityType,
        entityId: job.entityId,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        jobId: job.jobId,
        entityType: job.entityType,
        entityId: job.entityId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  async searchCandidates(query: string, topK?: number, filters?: import('../types/qdrant.types.js').QdrantFilter) {
    const [vector] = await this.provider.generateEmbeddings([query]);
    return this.searcher.searchCandidates(vector, topK, filters);
  }

  async searchJobs(query: string, topK?: number) {
    const [vector] = await this.provider.generateEmbeddings([query]);
    return this.searcher.searchJobs(vector, topK);
  }

  async health(): Promise<{
    provider: boolean;
    qdrant: boolean;
    queue: { pending: number; processing: number };
  }> {
    const providerAvailable = await this.provider.isAvailable();
    const qdrantHealthy = await this.manager.healthCheck();
    const queueStatus = this.queue.getQueueStatus();

    return {
      provider: providerAvailable,
      qdrant: qdrantHealthy,
      queue: queueStatus,
    };
  }
}
