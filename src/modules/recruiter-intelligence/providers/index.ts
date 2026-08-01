import type { LLMProvider, EvaluationPrompt, LLMProviderResponse } from '../types/provider.types.js';
import { OpenAIProvider } from './openai-provider.js';
import { ClaudeProvider } from './claude-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { GroqProvider } from './groq-provider.js';
import { PROVIDER_CONFIG } from '../constants/index.js';

export { BaseLLMProvider } from './base-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { ClaudeProvider } from './claude-provider.js';
export { GeminiProvider } from './gemini-provider.js';
export { GroqProvider } from './groq-provider.js';

export function createLLMProvider(name: string): LLMProvider | null {
  const config = PROVIDER_CONFIG[name];
  if (!config || !config.apiKey) return null;

  switch (name) {
    case 'openai':
      return new OpenAIProvider({ name, ...config });
    case 'claude':
      return new ClaudeProvider({ name, ...config });
    case 'gemini':
      return new GeminiProvider({ name, ...config });
    case 'groq':
      return new GroqProvider({ name, ...config });
    default:
      return null;
  }
}

export class RecruiterAIRouter {
  private providers: LLMProvider[] = [];
  private lastUsedProvider = '';

  constructor(providerPriority?: string[]) {
    const priority = providerPriority || ['openai', 'claude', 'gemini', 'groq'];
    for (const name of priority) {
      const provider = createLLMProvider(name);
      if (provider) {
        this.providers.push(provider);
      }
    }
  }

  get availableProviders(): string[] {
    return this.providers
      .filter(p => !p.isDead)
      .map(p => p.name);
  }

  get lastProvider(): string {
    return this.lastUsedProvider;
  }

  async route(prompt: EvaluationPrompt): Promise<LLMProviderResponse> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      if (provider.isDead) continue;

      try {
        const result = await provider.evaluate(prompt);
        this.lastUsedProvider = provider.name;
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);

        if (error.message.includes('429') || error.message.includes('quota')) {
          provider.markDead();
        }
      }
    }

    throw new Error(
      `All AI providers failed. Errors: ${errors.map(e => e.message).join('; ')}`,
    );
  }
}
