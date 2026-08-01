import type { EmbeddingProviderConfig } from '../types/index.js';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
import { LocalEmbeddingProvider } from './local-embedding-provider.js';

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

const providers = new Map<string, EmbeddingProvider>();

export function registerProvider(name: string, provider: EmbeddingProvider): void {
  providers.set(name, provider);
}

export function getProvider(name: string): EmbeddingProvider | undefined {
  return providers.get(name);
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.name) {
    case 'openai':
      return new OpenAIEmbeddingProvider(config);
    case 'local':
      return new LocalEmbeddingProvider(config);
    default:
      throw new Error(`Unknown embedding provider: ${config.name}`);
  }
}

export function getDefaultEmbeddingProvider(): EmbeddingProvider {
  const name = process.env.EMBEDDING_PROVIDER || 'openai';
  const existing = providers.get(name);
  if (existing) return existing;

  const provider = createEmbeddingProvider({
    name: name as EmbeddingProviderConfig['name'],
    model: process.env.EMBEDDING_MODEL || (name === 'local' ? 'Xenova/all-MiniLM-L6-v2' : 'text-embedding-3-small'),
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || (name === 'local' ? '384' : '1536'), 10),
    apiKey: process.env.OPENAI_API_KEY,
  });
  registerProvider(name, provider);
  return provider;
}
