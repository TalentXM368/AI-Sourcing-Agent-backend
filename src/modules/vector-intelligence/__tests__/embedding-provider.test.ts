// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn(function MockOpenAIObj() {
    this.embeddings = {
      create: vi.fn().mockResolvedValue({
        data: [
          { embedding: new Array(1536).fill(0).map(() => Math.random()) },
        ],
      }),
    };
  });
  return { default: MockOpenAI };
});

describe('OpenAIEmbeddingProvider', () => {
  let OpenAIEmbeddingProvider: typeof import('../providers/openai-embedding-provider.js').OpenAIEmbeddingProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../providers/openai-embedding-provider.js');
    OpenAIEmbeddingProvider = mod.OpenAIEmbeddingProvider;
  });

  it('has correct name and model', () => {
    const provider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      apiKey: 'test-api-key',
    });
    expect(provider.name).toBe('openai');
    expect(provider.model).toBe('text-embedding-3-small');
    expect(provider.dimensions).toBe(1536);
  });

  it('generates embeddings for text', async () => {
    const provider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      apiKey: 'test-api-key',
    });

    const result = await provider.generateEmbeddings(['hello world']);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
    expect(result[0].every(v => typeof v === 'number')).toBe(true);
  });

  it('generates batch embeddings', async () => {
    const OpenAI = (await import('openai')).default;
    (OpenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(function MockBatch() {
      this.embeddings = {
        create: vi.fn().mockResolvedValue({
          data: [
            { embedding: new Array(1536).fill(0.1) },
            { embedding: new Array(1536).fill(0.2) },
          ],
        }),
      };
    });

    const batchProvider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      apiKey: 'test-api-key',
    });

    const result = await batchProvider.generateEmbeddings(['text 1', 'text 2']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
    expect(result[1]).toHaveLength(1536);
  });

  it('returns empty array for empty input', async () => {
    const provider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      apiKey: 'test-api-key',
    });

    const result = await provider.generateEmbeddings([]);
    expect(result).toHaveLength(0);
  });

  it('reports availability when configured', async () => {
    const provider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      apiKey: 'test-api-key',
    });

    const available = await provider.isAvailable();
    expect(available).toBe(true);
  });

  it('creates provider without API key', () => {
    const provider = new OpenAIEmbeddingProvider({
      name: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    // Provider is created but client is null
    expect(provider.name).toBe('openai');
  });
});
