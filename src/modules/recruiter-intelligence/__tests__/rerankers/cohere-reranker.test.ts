import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CohereReranker } from '../../rerankers/cohere-reranker.js';

describe('CohereReranker', () => {
  let reranker: CohereReranker;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.COHERE_API_KEY = 'test-api-key';
    reranker = new CohereReranker();
  });

  it('should have correct name', () => {
    expect(reranker.name).toBe('cohere');
  });

  it('should be available when API key is set', () => {
    expect(reranker.available).toBe(true);
  });

  it('should not be available when API key is missing', () => {
    process.env.COHERE_API_KEY = '';
    const noKeyReranker = new CohereReranker();
    expect(noKeyReranker.available).toBe(false);
  });

  it('should rerank documents successfully', async () => {
    const mockResponse = {
      results: [
        { index: 1, relevanceScore: 0.95, document: { text: 'doc1' } },
        { index: 0, relevanceScore: 0.7, document: { text: 'doc0' } },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await reranker.rerank('query', ['doc0', 'doc1'], 2);

    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(1);
    expect(results[0].score).toBe(0.95);
    expect(results[1].index).toBe(0);
    expect(results[1].score).toBe(0.7);
  });

  it('should throw error when API key is missing', async () => {
    process.env.COHERE_API_KEY = '';
    const noKeyReranker = new CohereReranker();

    await expect(noKeyReranker.rerank('query', ['doc'], 1)).rejects.toThrow('Cohere API key not configured');
  });

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response);

    await expect(reranker.rerank('query', ['doc'], 1)).rejects.toThrow('429');
  });
});
