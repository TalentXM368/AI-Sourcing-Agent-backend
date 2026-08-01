import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../providers/openai-provider.js';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    provider = new OpenAIProvider({
      name: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 2000,
      temperature: 0.1,
    });
  });

  it('should have correct name', () => {
    expect(provider.name).toBe('openai');
  });

  it('should not be dead initially', () => {
    expect(provider.isDead).toBe(false);
  });

  it('should evaluate successfully', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"result": "test"}' } }],
      usage: { total_tokens: 100 },
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.evaluate({
      systemPrompt: 'You are a test assistant.',
      userPrompt: 'Test prompt',
    });

    expect(result.content).toBe('{"result": "test"}');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.tokensUsed).toBe(100);
  });

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid request',
    } as Response);

    await expect(provider.evaluate({
      systemPrompt: 'test',
      userPrompt: 'test',
    })).rejects.toThrow('400');
  });

  it('should include schema in request when provided', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"result": "test"}' } }],
      usage: { total_tokens: 50 },
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    await provider.evaluate({
      systemPrompt: 'test',
      userPrompt: 'test',
      schema: { type: 'object', properties: { result: { type: 'string' } } },
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe('json_schema');
  });
});
