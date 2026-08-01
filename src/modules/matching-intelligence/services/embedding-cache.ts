interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class EmbeddingCache {
  private cache = new Map<string, CacheEntry<number[]>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private ttlMs: number = parseInt(process.env.EMBEDDING_CACHE_TTL_MS || '3600000', 10),
    private maxSize: number = parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE || '1000', 10),
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(this.ttlMs, 60000));
  }

  get(jobId: string): number[] | null {
    const entry = this.cache.get(jobId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(jobId);
      return null;
    }
    return entry.value;
  }

  set(jobId: string, embedding: number[]): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    this.cache.set(jobId, {
      value: embedding,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(jobId?: string): void {
    if (jobId) {
      this.cache.delete(jobId);
    } else {
      this.cache.clear();
    }
  }

  size(): number {
    return this.cache.size;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
    }
  }
}

let globalCache: EmbeddingCache | null = null;

export function getEmbeddingCache(): EmbeddingCache {
  if (!globalCache) {
    globalCache = new EmbeddingCache();
  }
  return globalCache;
}
