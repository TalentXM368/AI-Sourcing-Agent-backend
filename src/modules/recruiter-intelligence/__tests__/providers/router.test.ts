import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecruiterAIRouter } from '../../providers/index.js';

describe('RecruiterAIRouter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.GROQ_API_KEY = '';
  });

  it('should initialize with available providers', () => {
    const router = new RecruiterAIRouter(['openai']);
    expect(router.availableProviders).toContain('openai');
  });

  it('should route to first available provider', async () => {
    const router = new RecruiterAIRouter(['openai']);

    const mockResponse = {
      choices: [{ message: { content: '{"result": "test"}' } }],
      usage: { total_tokens: 100 },
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await router.route({
      systemPrompt: 'test',
      userPrompt: 'test',
    });

    expect(result.content).toBe('{"result": "test"}');
    expect(result.provider).toBe('openai');
  });

  it('should try multiple providers when first fails', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    const router = new RecruiterAIRouter(['openai', 'groq']);

    // Both providers fail with non-quota error (500)
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    } as Response);

    await expect(router.route({
      systemPrompt: 'test',
      userPrompt: 'test',
    })).rejects.toThrow('All AI providers failed');
  });

  it('should mark provider as dead after quota error', async () => {
    const router = new RecruiterAIRouter(['openai']);

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response);

    await expect(router.route({
      systemPrompt: 'test',
      userPrompt: 'test',
    })).rejects.toThrow();

    expect(router.availableProviders).not.toContain('openai');
  });

  it('should track last used provider', async () => {
    const router = new RecruiterAIRouter(['openai']);

    const mockResponse = {
      choices: [{ message: { content: '{}' } }],
      usage: { total_tokens: 10 },
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    await router.route({ systemPrompt: 'test', userPrompt: 'test' });
    expect(router.lastProvider).toBe('openai');
  });
});
