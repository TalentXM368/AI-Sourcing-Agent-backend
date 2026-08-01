// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@qdrant/js-client-rest', () => {
  const MockQdrantClient = vi.fn(function MockQdrantClientImpl() {
    this.search = vi.fn().mockResolvedValue([
      {
        id: 'result-1',
        score: 0.95,
        payload: { entityType: 'candidate', name: 'John Doe', skills: ['TypeScript'] },
      },
      {
        id: 'result-2',
        score: 0.85,
        payload: { entityType: 'candidate', name: 'Jane Smith', skills: ['Python'] },
      },
    ]);
  });
  return { QdrantClient: MockQdrantClient };
});

describe('QdrantSearcher', () => {
  let QdrantManager: typeof import('../qdrant/qdrant-manager.js').QdrantManager;
  let QdrantSearcher: typeof import('../qdrant/qdrant-searcher.js').QdrantSearcher;

  beforeEach(async () => {
    vi.clearAllMocks();
    const managerMod = await import('../qdrant/qdrant-manager.js');
    QdrantManager = managerMod.QdrantManager;
    const searcherMod = await import('../qdrant/qdrant-searcher.js');
    QdrantSearcher = searcherMod.QdrantSearcher;
  });

  it('searches candidates', async () => {
    const manager = new QdrantManager();
    const searcher = new QdrantSearcher(manager);

    const queryVector = new Array(1536).fill(0.1);
    const results = await searcher.searchCandidates(queryVector, 10);

    expect(results).toHaveLength(2);
    expect(results[0].entityId).toBe('result-1');
    expect(results[0].score).toBe(0.95);
    expect(results[0].entityType).toBe('candidate');
    expect(results[0].payload.name).toBe('John Doe');
  });

  it('searches jobs', async () => {
    const manager = new QdrantManager();
    const searcher = new QdrantSearcher(manager);

    const queryVector = new Array(1536).fill(0.1);
    const results = await searcher.searchJobs(queryVector, 5);

    expect(results).toHaveLength(2);
  });

  it('searches with filters', async () => {
    const manager = new QdrantManager();
    const searcher = new QdrantSearcher(manager);

    const queryVector = new Array(1536).fill(0.1);
    const filters = {
      must: [{ key: 'skills', match: { keyword: ['TypeScript'] } }],
    };

    const results = await searcher.search(queryVector, 10, filters);

    expect(results).toHaveLength(2);
  });

  it('passes limit to Qdrant client', async () => {
    const manager = new QdrantManager();
    const searcher = new QdrantSearcher(manager);

    const queryVector = new Array(1536).fill(0.1);
    await searcher.searchCandidates(queryVector, 1);

    const client = manager.getClient();
    // Verify search was called (the mock always returns 2, but limit was passed)
    expect(client.search).toHaveBeenCalledWith(
      'candidates',
      expect.objectContaining({ limit: 1 }),
    );
  });
});
