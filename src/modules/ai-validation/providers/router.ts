import { createProvider, type BaseAIProvider, type AIProviderResponse } from './index.js';
import { PROVIDER_PRIORITY } from '../constants/index.js';

export class AIRouter {
  private providers: BaseAIProvider[] = [];
  private lastUsedProvider = '';

  constructor() {
    for (const name of PROVIDER_PRIORITY) {
      const provider = createProvider(name);
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

  async route(
    systemPrompt: string,
    userPrompt: string,
    schema?: object,
  ): Promise<AIProviderResponse> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      if (provider.isDead) continue;

      try {
        const result = await provider.sendChat(systemPrompt, userPrompt, schema);
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
