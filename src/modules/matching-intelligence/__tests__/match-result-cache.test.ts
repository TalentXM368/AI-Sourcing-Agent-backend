import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MatchResultCache } from '../services/match-result-cache.js';
import type { MatchResult } from '../types/index.js';

function makeResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    candidateId: 'cand-1',
    jobId: 'job-1',
    overallScore: 75,
    semanticScore: 80,
    skillScore: 85,
    experienceScore: 70,
    educationScore: 60,
    industryScore: 50,
    locationScore: 90,
    employmentScore: 80,
    salaryScore: 70,
    matchedSkills: ['javascript'],
    missingSkills: ['rust'],
    additionalSkills: ['python'],
    hardFilterPassed: true,
    confidence: 0.85,
    ...overrides,
  };
}

const defaultMetadata = {
  candidatesRetrieved: 10,
  candidatesFiltered: 2,
  candidatesRanked: 8,
  processingTimeMs: 150,
};

describe('MatchResultCache', () => {
  let cache: MatchResultCache;

  beforeEach(() => {
    cache = new MatchResultCache(5000, 100);
  });

  afterEach(() => {
    cache.destroy();
  });

  it('stores and retrieves results', () => {
    const results = [makeResult()];
    cache.set('job-1', undefined, results, defaultMetadata);
    const cached = cache.get('job-1');
    expect(cached).not.toBeNull();
    expect(cached!.results).toEqual(results);
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns null for expired entries', async () => {
    const shortCache = new MatchResultCache(50, 100);
    shortCache.set('job-1', undefined, [makeResult()], defaultMetadata);
    await new Promise(r => setTimeout(r, 100));
    expect(shortCache.get('job-1')).toBeNull();
    shortCache.destroy();
  });

  it('differentiates by filters', () => {
    const results = [makeResult()];
    cache.set('job-1', undefined, results, defaultMetadata);
    cache.set('job-1', { country: 'US' }, [makeResult({ overallScore: 90 })], defaultMetadata);
    expect(cache.get('job-1')!.results[0].overallScore).toBe(75);
    expect(cache.get('job-1', { country: 'US' })!.results[0].overallScore).toBe(90);
  });

  it('invalidates specific job', () => {
    cache.set('job-1', undefined, [makeResult()], defaultMetadata);
    cache.set('job-2', undefined, [makeResult()], defaultMetadata);
    cache.invalidate('job-1');
    expect(cache.get('job-1')).toBeNull();
    expect(cache.get('job-2')).not.toBeNull();
  });

  it('invalidates all entries', () => {
    cache.set('job-1', undefined, [makeResult()], defaultMetadata);
    cache.set('job-2', undefined, [makeResult()], defaultMetadata);
    cache.invalidate();
    expect(cache.size()).toBe(0);
  });

  it('evicts oldest when max size reached', () => {
    for (let i = 0; i < 100; i++) {
      cache.set(`job-${i}`, undefined, [makeResult()], defaultMetadata);
    }
    cache.set('job-new', undefined, [makeResult({ overallScore: 99 })], defaultMetadata);
    expect(cache.get('job-0')).toBeNull();
    expect(cache.get('job-new')).not.toBeNull();
  });

  it('cleans up on destroy', () => {
    cache.set('job-1', undefined, [makeResult()], defaultMetadata);
    cache.destroy();
    expect(cache.size()).toBe(0);
  });
});
