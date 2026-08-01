import type { RerankerProvider, RerankerResult } from '../types/provider.types.js';
import { RETRY_CONFIG } from '../constants/index.js';

export abstract class BaseReranker implements RerankerProvider {
  protected dead = false;
  protected deadUntil = 0;

  constructor(public readonly name: string) {}

  get isDead(): boolean {
    if (this.dead && Date.now() > this.deadUntil) {
      this.dead = false;
    }
    return this.dead;
  }

  markDead(): void {
    this.dead = true;
    this.deadUntil = Date.now() + 60000;
  }

  abstract rerank(query: string, documents: string[], topN: number): Promise<RerankerResult[]>;

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = RETRY_CONFIG.maxRetries,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isQuota = lastError.message.includes('429') ||
          lastError.message.includes('quota') ||
          lastError.message.includes('rate_limit');
        if (isQuota) {
          this.markDead();
          throw lastError;
        }
        if (attempt < retries) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
            RETRY_CONFIG.maxDelayMs,
          );
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError || new Error('Max retries exceeded');
  }

  protected sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
}
