import { getDefaultEmbeddingProvider } from './providers/index.js';
import { QdrantManager } from './qdrant/qdrant-manager.js';
import { QdrantIndexer } from './qdrant/qdrant-indexer.js';
import { QdrantSearcher } from './qdrant/qdrant-searcher.js';
import { getGlobalQueue } from './queue/index.js';
import { EmbeddingService } from './services/embedding-service.js';
import { ReindexService } from './services/reindex-service.js';
import { createVectorIntelligenceRouter } from './routes/vector-intelligence.routes.js';

let embeddingService: EmbeddingService | null = null;
let reindexService: ReindexService | null = null;
let initialized = false;

export function createVectorIntelligenceServices() {
  const provider = getDefaultEmbeddingProvider();
  const qdrantManager = new QdrantManager();
  const indexer = new QdrantIndexer(qdrantManager);
  const searcher = new QdrantSearcher(qdrantManager);
  const queue = getGlobalQueue();

  embeddingService = new EmbeddingService(provider, queue, indexer, searcher, qdrantManager);
  reindexService = new ReindexService(provider, indexer, qdrantManager);

  return { embeddingService, reindexService, qdrantManager };
}

export function getVectorIntelligenceRouter() {
  const { embeddingService: es, reindexService: rs } = createVectorIntelligenceServices();
  return createVectorIntelligenceRouter(es, rs);
}

export async function initializeVectorIntelligence(): Promise<void> {
  if (initialized) return;

  try {
    const { qdrantManager } = createVectorIntelligenceServices();
    await qdrantManager.initialize();
    initialized = true;
    console.log('[VectorIntelligence] Qdrant initialized successfully');
  } catch (error) {
    console.warn('[VectorIntelligence] Qdrant initialization failed (will retry on first use):', error);
  }
}

export function getEmbeddingService(): EmbeddingService | null {
  return embeddingService;
}

export function getReindexService(): ReindexService | null {
  return reindexService;
}

export function isVectorIntelligenceReady(): boolean {
  return initialized;
}
