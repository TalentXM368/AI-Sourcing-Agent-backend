// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMethods = {
  getCollections: vi.fn().mockResolvedValue({ collections: [] }),
  createCollection: vi.fn().mockResolvedValue(true),
  createPayloadIndex: vi.fn().mockResolvedValue(true),
  getCollection: vi.fn().mockResolvedValue({
    status: 'green',
    optimizer_status: 'ok',
    vectors_count: 100,
    indexed_vectors_count: 100,
    points_count: 100,
    segments_count: 1,
    config: {},
    payload_schema: {},
  }),
  deleteCollection: vi.fn().mockResolvedValue(true),
  upsert: vi.fn().mockResolvedValue(true),
  search: vi.fn().mockResolvedValue([]),
};

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn(function MockQdrantClientImpl() {
    Object.assign(this, mockMethods);
  }),
}));

describe('QdrantManager', () => {
  let QdrantManager: typeof import('../qdrant/qdrant-manager.js').QdrantManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMethods.getCollections.mockResolvedValue({ collections: [] });
    const mod = await import('../qdrant/qdrant-manager.js');
    QdrantManager = mod.QdrantManager;
  });

  it('creates manager', () => {
    const manager = new QdrantManager();
    expect(manager).toBeDefined();
  });

  it('health check returns true when Qdrant is reachable', async () => {
    const manager = new QdrantManager();
    const healthy = await manager.healthCheck();
    expect(healthy).toBe(true);
  });

  it('health check returns false when Qdrant is unreachable', async () => {
    mockMethods.getCollections.mockRejectedValueOnce(new Error('Connection refused'));
    const manager = new QdrantManager();
    const healthy = await manager.healthCheck();
    expect(healthy).toBe(false);
  });

  it('initializes and creates collections', async () => {
    const manager = new QdrantManager();
    await manager.initialize();
    expect(mockMethods.createCollection).toHaveBeenCalled();
    expect(mockMethods.createPayloadIndex).toHaveBeenCalled();
  });

  it('gets collection info', async () => {
    const manager = new QdrantManager();
    const info = await manager.getCollectionInfo('candidates');
    expect(info.status).toBe('green');
    expect(info.vectors_count).toBe(100);
    expect(info.points_count).toBe(100);
  });

  it('deletes collection', async () => {
    const manager = new QdrantManager();
    await manager.deleteCollection('test-collection');
    expect(mockMethods.deleteCollection).toHaveBeenCalledWith('test-collection');
  });
});
