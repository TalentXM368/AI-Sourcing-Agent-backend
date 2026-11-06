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
  const configuredName = process.env.EMBEDDING_PROVIDER;
  const fallbackName = process.env.OPENAI_API_KEY ? 'openai' : 'local';
  const name = configuredName || fallbackName;
  const existing = providers.get(name);
  if (existing) return existing;

  const resolvedName = name === 'local' ? 'local' : 'openai';
  const provider = createEmbeddingProvider({
    name: resolvedName as EmbeddingProviderConfig['name'],
    model: process.env.EMBEDDING_MODEL || (resolvedName === 'local' ? 'Xenova/all-MiniLM-L6-v2' : 'text-embedding-3-small'),
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || (resolvedName === 'local' ? '384' : '1536'), 10),
    apiKey: resolvedName === 'local' ? '' : process.env.OPENAI_API_KEY || '',
  });
  registerProvider(name, provider);
  return provider;
}
