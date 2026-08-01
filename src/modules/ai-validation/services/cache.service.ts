import { CACHE_CONFIG } from '../constants/index.js';
import { createHash } from 'crypto';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class CacheService {
  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | null {
    this.evictExpired();
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    this.evictExpired();
    if (this.cache.size >= CACHE_CONFIG.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_CONFIG.ttlMs,
    });
  }

  buildKey(fieldName: string, currentValue: string, nearbyText: string): string {
    const data = `${fieldName}:${currentValue}:${nearbyText.substring(0, 200)}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  get stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  reset(): void {
    this.hits = 0;
    this.misses = 0;
  }

  clear(): void {
    this.cache.clear();
    this.reset();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }
}
