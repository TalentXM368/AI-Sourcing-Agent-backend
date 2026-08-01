import { QdrantClient } from '@qdrant/js-client-rest';
import type { CollectionConfig, CollectionInfo, PayloadIndexField } from '../types/index.js';
import { CANDIDATE_COLLECTION_CONFIG, JOB_COLLECTION_CONFIG, VECTOR_CONSTANTS } from '../constants/index.js';

export class QdrantManager {
  private client: QdrantClient;
  private initialized = false;

  constructor(url?: string, apiKey?: string) {
    const qdrantUrl = url || process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = apiKey || process.env.QDRANT_API_KEY || undefined;

    this.client = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey || undefined,
    });
  }

  getClient(): QdrantClient {
    return this.client;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const healthy = await this.healthCheck();
    if (!healthy) {
      console.warn('[QdrantManager] Qdrant is not reachable. Vector intelligence will be unavailable.');
      return;
    }

    await this.ensureAllCollections();
    this.initialized = true;
    console.log('[QdrantManager] Initialized successfully');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      console.error('[QdrantManager] Health check failed:', error);
      return false;
    }
  }

  async ensureAllCollections(): Promise<void> {
    await this.ensureCollection(CANDIDATE_COLLECTION_CONFIG);
    await this.ensureCollection(JOB_COLLECTION_CONFIG);
  }

  async ensureCollection(config: CollectionConfig): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === config.name);

      if (!exists) {
        await this.client.createCollection(config.name, {
          vectors: {
            size: config.vectors.size,
            distance: config.vectors.distance,
          },
          on_disk_payload: config.on_disk_payload || false,
          optimizers_config: config.optimizers_config ? {
            indexing_threshold: config.optimizers_config.indexing_threshold,
          } : undefined,
        });
        console.log(`[QdrantManager] Created collection: ${config.name}`);
      }

      await this.ensurePayloadIndexes(config.name);
    } catch (error) {
      console.error(`[QdrantManager] Failed to ensure collection ${config.name}:`, error);
      throw error;
    }
  }

  private async ensurePayloadIndexes(collectionName: string): Promise<void> {
    const indexes = VECTOR_CONSTANTS.PAYLOAD_INDEXES;

    for (const index of indexes) {
      try {
        await this.client.createPayloadIndex(collectionName, {
          field_name: index.field_name,
          field_schema: index.field_schema,
        });
      } catch (error: unknown) {
        const err = error as { status?: number; message?: string };
        if (err.status === 409 || err.message?.includes('already exists')) {
          continue;
        }
        console.warn(`[QdrantManager] Failed to create payload index ${index.field_name} on ${collectionName}:`, error);
      }
    }
  }

  async getCollectionInfo(collectionName: string): Promise<CollectionInfo> {
    const info = await this.client.getCollection(collectionName);
    return {
      status: String(info.status),
      optimizer_status: String(info.optimizer_status),
      vectors_count: (info as Record<string, unknown>).vectors_count as number || 0,
      indexed_vectors_count: info.indexed_vectors_count || 0,
      points_count: info.points_count || 0,
      segments_count: (info as Record<string, unknown>).segments_count as number || 0,
      config: info.config as unknown as Record<string, unknown>,
      payload_schema: (info as Record<string, unknown>).payload_schema as Record<string, unknown> || {},
    };
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
    console.log(`[QdrantManager] Deleted collection: ${name}`);
  }
}
