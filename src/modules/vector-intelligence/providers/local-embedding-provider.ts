import type { EmbeddingProvider } from './index.js';
import type { EmbeddingProviderConfig } from '../types/index.js';

let pipeline: any = null;
let env: any = null;

async function loadTransformers() {
  if (pipeline) return;
  const mod = await import('@xenova/transformers');
  env = mod.env;
  pipeline = mod.pipeline;
  // Cache models in node_modules to avoid re-downloading
  env.cacheDir = process.env.TRANSFORMERS_CACHE || './node_modules/.cache/transformers';
  console.log('[LocalEmbedding] Transformers loaded, cache:', env.cacheDir);
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly model: string;
  readonly dimensions: number;
  private extractor: any = null;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model || 'Xenova/all-MiniLM-L6-v2';
    this.dimensions = config.dimensions || 384;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await loadTransformers();
      return true;
    } catch {
      return false;
    }
  }

  private async getExtractor() {
    if (this.extractor) return this.extractor;
    await loadTransformers();
    console.log(`[LocalEmbedding] Loading model: ${this.model} (first run downloads ~23MB)`);
    this.extractor = await pipeline('feature-extraction', this.model);
    console.log('[LocalEmbedding] Model loaded successfully');
    return this.extractor;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();
    const results: number[][] = [];

    for (const text of texts) {
      try {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        const vec = Array.from(output.data) as number[];
        // Pad to target dimensions if needed
        if (vec.length < this.dimensions) {
          const padded = new Array(this.dimensions).fill(0);
          for (let i = 0; i < vec.length; i++) padded[i] = vec[i];
          results.push(padded);
        } else {
          results.push(vec.slice(0, this.dimensions));
        }
      } catch (error) {
        console.error('[LocalEmbedding] Failed to embed text, using hash fallback:', error);
        results.push(this.hashEmbed(text));
      }
    }

    return results;
  }

  private hashEmbed(text: string): number[] {
    const dims = this.dimensions;
    const vector: number[] = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      vector[i % dims] += charCode / 1000;
      vector[(i * 7 + 13) % dims] += Math.sin(charCode * 0.1) * 0.5;
      vector[(i * 13 + 7) % dims] += Math.cos(charCode * 0.05) * 0.3;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / (norm || 1));
  }
}
