import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingCache } from '../services/embedding-cache.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache(5000, 10);
  });

  afterEach(() => {
    cache.destroy();
  });

  it('stores and retrieves embeddings', () => {
    const embedding = [0.1, 0.2, 0.3];
    cache.set('job-1', embedding);
    expect(cache.get('job-1')).toEqual(embedding);
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns null for expired entries', async () => {
    const shortCache = new EmbeddingCache(50, 10);
    shortCache.set('job-1', [0.1]);
    await new Promise(r => setTimeout(r, 100));
    expect(shortCache.get('job-1')).toBeNull();
    shortCache.destroy();
  });

  it('evicts oldest when max size reached', () => {
    for (let i = 0; i < 10; i++) {
      cache.set(`job-${i}`, [i]);
    }
    cache.set('job-new', [999]);
    expect(cache.get('job-0')).toBeNull();
    expect(cache.get('job-new')).toEqual([999]);
  });

  it('invalidates specific entry', () => {
    cache.set('job-1', [0.1]);
    cache.set('job-2', [0.2]);
    cache.invalidate('job-1');
    expect(cache.get('job-1')).toBeNull();
    expect(cache.get('job-2')).toEqual([0.2]);
  });

  it('invalidates all entries', () => {
    cache.set('job-1', [0.1]);
    cache.set('job-2', [0.2]);
    cache.invalidate();
    expect(cache.size()).toBe(0);
  });

  it('tracks size correctly', () => {
    expect(cache.size()).toBe(0);
    cache.set('job-1', [0.1]);
    expect(cache.size()).toBe(1);
    cache.set('job-2', [0.2]);
    expect(cache.size()).toBe(2);
  });

  it('cleans up on destroy', () => {
    cache.set('job-1', [0.1]);
    cache.destroy();
    expect(cache.size()).toBe(0);
  });
});
