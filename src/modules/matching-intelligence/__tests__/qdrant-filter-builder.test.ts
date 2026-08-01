import { describe, it, expect } from 'vitest';
import { buildQdrantFilterFromHardFilters } from '../utils/qdrant-filter-builder.js';
import type { HardFilters } from '../types/index.js';

describe('buildQdrantFilterFromHardFilters', () => {
  it('returns undefined for empty filters', () => {
    expect(buildQdrantFilterFromHardFilters({})).toBeUndefined();
  });

  it('returns undefined for undefined filters', () => {
    expect(buildQdrantFilterFromHardFilters(undefined as unknown as HardFilters)).toBeUndefined();
  });

  it('builds country filter', () => {
    const result = buildQdrantFilterFromHardFilters({ country: 'US' });
    expect(result).toBeDefined();
    expect(result!.must).toHaveLength(1);
    expect(result!.must![0]).toEqual({ key: 'location', match: { value: 'us' } });
  });

  it('builds employment type filter', () => {
    const result = buildQdrantFilterFromHardFilters({ employmentType: 'full-time' });
    expect(result!.must).toHaveLength(1);
    expect(result!.must![0]).toEqual({ key: 'employmentType', match: { value: 'full-time' } });
  });

  it('builds experience filter', () => {
    const result = buildQdrantFilterFromHardFilters({ minimumExperienceYears: 3 });
    expect(result!.must).toHaveLength(1);
    expect(result!.must![0]).toEqual({ key: 'experienceYears', range: { gte: 3 } });
  });

  it('builds skills filter for multiple skills', () => {
    const result = buildQdrantFilterFromHardFilters({ requiredSkills: ['javascript', 'react'] });
    expect(result!.must).toHaveLength(2);
    expect(result!.must![0]).toEqual({ key: 'skills', match: { value: 'javascript' } });
    expect(result!.must![1]).toEqual({ key: 'skills', match: { value: 'react' } });
  });

  it('combines multiple filters', () => {
    const result = buildQdrantFilterFromHardFilters({
      country: 'US',
      employmentType: 'full-time',
      minimumExperienceYears: 2,
    });
    expect(result!.must).toHaveLength(3);
  });

  it('lowercases values', () => {
    const result = buildQdrantFilterFromHardFilters({ country: 'United States' });
    expect(result!.must![0]).toEqual({ key: 'location', match: { value: 'united states' } });
  });
});
