import { BaseReranker } from './base-reranker.js';
import type { RerankerResult } from '../types/provider.types.js';
import { RERANKER_CONFIG, RETRY_CONFIG } from '../constants/index.js';

export class CohereReranker extends BaseReranker {
  private apiKey: string;
  private model: string;

  constructor() {
    super('cohere');
    this.apiKey = process.env.COHERE_API_KEY || '';
    this.model = RERANKER_CONFIG.cohereModel;
  }

  get available(): boolean {
    return !!this.apiKey;
  }

  async rerank(query: string, documents: string[], topN: number): Promise<RerankerResult[]> {
    if (!this.apiKey) {
      throw new Error('Cohere API key not configured');
    }

    return this.withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RETRY_CONFIG.timeoutMs);

      try {
        const response = await fetch('https://api.cohere.com/v2/rerank', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            query,
            documents,
            topN,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`${response.status}: ${errorText}`);
        }

        const data = await response.json() as {
          results: Array<{
            index: number;
            relevanceScore: number;
            document?: { text: string };
          }>;
        };

        return data.results.map(r => ({
          index: r.index,
          score: r.relevanceScore,
          document: r.document?.text,
        }));
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    });
  }
}
