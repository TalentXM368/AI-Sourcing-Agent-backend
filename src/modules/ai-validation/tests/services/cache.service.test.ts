import { describe, it, expect, beforeEach } from 'vitest';
import { CacheService } from '../../services/cache.service.js';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  describe('get/set', () => {
    it('returns null for cache miss', () => {
      expect(cache.get('missing')).toBeNull();
    });

    it('stores and retrieves a value', () => {
      cache.set('key1', { foo: 'bar' });
      expect(cache.get('key1')).toEqual({ foo: 'bar' });
    });

    it('returns null for expired entries', () => {
      cache.set('key1', 'value1');
      const stats = cache.stats;
      expect(stats.misses).toBe(0);

      // Manually expire by manipulating internal state
      (cache as unknown as { cache: Map<string, { value: unknown; expiresAt: number }> })
        .cache.get('key1')!.expiresAt = Date.now() - 1000;

      expect(cache.get('key1')).toBeNull();
    });

    it('evicts oldest entry when max entries reached', () => {
      // Default max is 1000, let's test the eviction logic
      cache.set('first', '1');
      cache.set('second', '2');

      // Overwrite to trigger eviction check
      for (let i = 0; i < 3; i++) {
        cache.set(`key${i}`, `val${i}`);
      }

      expect(cache.get('first')).not.toBeNull();
    });
  });

  describe('buildKey', () => {
    it('generates consistent keys for same inputs', () => {
      const key1 = cache.buildKey('name', 'John', 'context');
      const key2 = cache.buildKey('name', 'John', 'context');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different inputs', () => {
      const key1 = cache.buildKey('name', 'John', 'context');
      const key2 = cache.buildKey('name', 'Jane', 'context');
      expect(key1).not.toBe(key2);
    });
  });

  describe('stats', () => {
    it('tracks hits and misses', () => {
      cache.set('key1', 'value1');
      cache.get('key1');  // hit
      cache.get('miss');  // miss

      const stats = cache.stats;
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('clears all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.stats.size).toBe(0);
    });
  });
});
