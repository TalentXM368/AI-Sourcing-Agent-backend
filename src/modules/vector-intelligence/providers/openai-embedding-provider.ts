import OpenAI from 'openai';
import type { EmbeddingProvider } from './index.js';
import type { EmbeddingProviderConfig } from '../types/index.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimensions: number;
  private client: OpenAI | null = null;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model || 'text-embedding-3-small';
    this.dimensions = config.dimensions || 1536;

    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.embeddings.create({
        model: this.model,
        input: ['test'],
      });
      return true;
    } catch {
      return false;
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      console.warn('[EmbeddingProvider] OpenAI client not configured, using hash fallback')
      return texts.map(text => this.hashEmbed(text))
    }

    if (texts.length === 0) return [];

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    } catch (error: any) {
      const isQuota = error?.status === 429 || error?.message?.includes('quota')
      if (isQuota) {
        console.warn('[EmbeddingProvider] OpenAI quota exceeded, using hash fallback')
      } else {
        console.error('[EmbeddingProvider] OpenAI embedding failed:', error?.message || error)
      }
      return texts.map(text => this.hashEmbed(text))
    }
  }

  private hashEmbed(text: string): number[] {
    const dims = this.dimensions
    const vector: number[] = new Array(dims).fill(0)
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      vector[i % dims] += charCode / 1000
      vector[(i * 7 + 13) % dims] += Math.sin(charCode * 0.1) * 0.5
      vector[(i * 13 + 7) % dims] += Math.cos(charCode * 0.05) * 0.3
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    return vector.map(v => v / (norm || 1))
  }
}
