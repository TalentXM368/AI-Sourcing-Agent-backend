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
let qdrantManager: QdrantManager | null = null;
let initialized = false;
let initializing: Promise<void> | null = null;

function ensureServices() {
  if (!embeddingService || !reindexService || !qdrantManager) {
    const provider = getDefaultEmbeddingProvider();
    qdrantManager = new QdrantManager();
    const indexer = new QdrantIndexer(qdrantManager);
    const searcher = new QdrantSearcher(qdrantManager);
    const queue = getGlobalQueue();

    embeddingService = new EmbeddingService(provider, queue, indexer, searcher, qdrantManager);
    reindexService = new ReindexService(provider, indexer, qdrantManager);
  }
}

export function getVectorIntelligenceRouter() {
  ensureServices();
  return createVectorIntelligenceRouter(embeddingService!, reindexService!);
}

export async function initializeVectorIntelligence(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      ensureServices();
      await qdrantManager!.initialize();
      initialized = true;
      console.log('[VectorIntelligence] Qdrant initialized successfully');
    } catch (error) {
      console.warn('[VectorIntelligence] Qdrant initialization failed (will retry on first use):', error);
    }
  })();

  return initializing;
}

export function getEmbeddingService(): EmbeddingService | null {
  ensureServices();
  return embeddingService;
}

export function getReindexService(): ReindexService | null {
  ensureServices();
  return reindexService;
}

export function isVectorIntelligenceReady(): boolean {
  return initialized;
}
