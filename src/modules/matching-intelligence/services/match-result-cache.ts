import type { MatchResult } from '../types/index.js';

interface MatchCacheEntry {
  results: MatchResult[];
  metadata: {
    candidatesRetrieved: number;
    candidatesFiltered: number;
    candidatesRanked: number;
    processingTimeMs: number;
  };
  expiresAt: number;
  createdAt: number;
}

function computeFilterHash(filters?: Record<string, unknown>): string {
  if (!filters) return 'none';
  return JSON.stringify(filters, Object.keys(filters).sort());
}

export class MatchResultCache {
  private cache = new Map<string, MatchCacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private ttlMs: number = parseInt(process.env.MATCH_CACHE_TTL_MS || '300000', 10),
    private maxSize: number = parseInt(process.env.MATCH_CACHE_MAX_SIZE || '500', 10),
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(this.ttlMs, 30000));
  }

  get(entityId: string, filters?: Record<string, unknown>): MatchCacheEntry | null {
    const key = this.buildKey(entityId, filters);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  set(
    entityId: string,
    filters: Record<string, unknown> | undefined,
    results: MatchResult[],
    metadata: MatchCacheEntry['metadata'],
  ): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    const key = this.buildKey(entityId, filters);
    this.cache.set(key, {
      results,
      metadata: { ...metadata, processingTimeMs: 0 },
      expiresAt: Date.now() + this.ttlMs,
      createdAt: Date.now(),
    });
  }

  invalidate(entityId?: string): void {
    if (entityId) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(entityId + ':')) {
          this.cache.delete(key);
        }
      }
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

  private buildKey(entityId: string, filters?: Record<string, unknown>): string {
    return `${entityId}:${computeFilterHash(filters)}`;
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
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

let globalResultCache: MatchResultCache | null = null;

export function getMatchResultCache(): MatchResultCache {
  if (!globalResultCache) {
    globalResultCache = new MatchResultCache();
  }
  return globalResultCache;
}
