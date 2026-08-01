import { describe, it, expect } from 'vitest';
import { applyHardFilters } from '../filters/hard-filters.js';
import type { HardFilters, FilterContext } from '../types/index.js';

function makeContext(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    candidateExperienceYears: 5,
    candidateSkills: ['javascript', 'react', 'node.js'],
    candidateCountry: 'United States',
    candidateState: 'California',
    candidateCity: 'San Francisco',
    candidateEmploymentType: 'full-time',
    candidateWorkMode: 'onsite',
    candidateWorkAuthorization: 'us-citizen',
    candidateNoticePeriodDays: 14,
    candidateExpectedSalary: 120000,
    ...overrides,
  };
}

describe('applyHardFilters', () => {
  it('returns true when no filters provided', () => {
    expect(applyHardFilters({}, makeContext())).toBe(true);
  });

  it('returns true when filters is empty object', () => {
    expect(applyHardFilters({} as HardFilters, makeContext())).toBe(true);
  });

  describe('requiredSkills', () => {
    it('passes when candidate has required skill', () => {
      const filters: HardFilters = { requiredSkills: ['javascript'] };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when candidate lacks required skill', () => {
      const filters: HardFilters = { requiredSkills: ['rust'] };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });

    it('passes with multiple required skills when candidate has all', () => {
      const filters: HardFilters = { requiredSkills: ['javascript', 'react'] };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when candidate lacks one of multiple required skills', () => {
      const filters: HardFilters = { requiredSkills: ['javascript', 'rust'] };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });

    it('handles alias resolution', () => {
      const context = makeContext({ candidateSkills: ['ts', 'react', 'node.js'] });
      const filters: HardFilters = { requiredSkills: ['typescript'] };
      expect(applyHardFilters(filters, context)).toBe(true);
    });

    it('is case-insensitive', () => {
      const filters: HardFilters = { requiredSkills: ['JavaScript'] };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });
  });

  describe('minimumExperienceYears', () => {
    it('passes when candidate meets minimum', () => {
      const filters: HardFilters = { minimumExperienceYears: 3 };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when candidate below minimum', () => {
      const filters: HardFilters = { minimumExperienceYears: 10 };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });

    it('passes when candidate exactly meets minimum', () => {
      const filters: HardFilters = { minimumExperienceYears: 5 };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });
  });

  describe('country', () => {
    it('passes when country matches', () => {
      const filters: HardFilters = { country: 'United States' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when country does not match', () => {
      const filters: HardFilters = { country: 'Canada' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });

    it('is case-insensitive', () => {
      const filters: HardFilters = { country: 'united states' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });
  });

  describe('state', () => {
    it('passes when state matches', () => {
      const filters: HardFilters = { state: 'California' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when state does not match', () => {
      const filters: HardFilters = { state: 'New York' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('city', () => {
    it('passes when city matches', () => {
      const filters: HardFilters = { city: 'San Francisco' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when city does not match', () => {
      const filters: HardFilters = { city: 'New York' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('employmentType', () => {
    it('passes when type matches', () => {
      const filters: HardFilters = { employmentType: 'full-time' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when type does not match', () => {
      const filters: HardFilters = { employmentType: 'part-time' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('workMode', () => {
    it('passes when mode matches', () => {
      const filters: HardFilters = { workMode: 'onsite' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when mode does not match', () => {
      const filters: HardFilters = { workMode: 'remote' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('workAuthorization', () => {
    it('passes when authorization matches', () => {
      const filters: HardFilters = { workAuthorization: 'us-citizen' };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when authorization does not match', () => {
      const filters: HardFilters = { workAuthorization: 'needs-sponsorship' };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('noticePeriodDays', () => {
    it('passes when candidate notice is within limit', () => {
      const filters: HardFilters = { noticePeriodDays: 30 };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when candidate notice exceeds limit', () => {
      const filters: HardFilters = { noticePeriodDays: 7 };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('salaryRange', () => {
    it('passes when expected salary is within range', () => {
      const filters: HardFilters = { salaryRange: { min: 100000, max: 150000 } };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when expected salary is below range', () => {
      const filters: HardFilters = { salaryRange: { min: 150000, max: 200000 } };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });

    it('fails when expected salary is above range', () => {
      const filters: HardFilters = { salaryRange: { min: 50000, max: 100000 } };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('combined filters', () => {
    it('passes when all filters pass', () => {
      const filters: HardFilters = {
        requiredSkills: ['javascript'],
        minimumExperienceYears: 3,
        country: 'United States',
        employmentType: 'full-time',
      };
      expect(applyHardFilters(filters, makeContext())).toBe(true);
    });

    it('fails when any one filter fails', () => {
      const filters: HardFilters = {
        requiredSkills: ['javascript'],
        minimumExperienceYears: 10,
        country: 'United States',
        employmentType: 'full-time',
      };
      expect(applyHardFilters(filters, makeContext())).toBe(false);
    });
  });

  describe('missing candidate context', () => {
    it('fails country filter when candidate has no country', () => {
      const context = makeContext({ candidateCountry: undefined });
      const filters: HardFilters = { country: 'United States' };
      expect(applyHardFilters(filters, context)).toBe(false);
    });

    it('fails employmentType filter when candidate has no type', () => {
      const context = makeContext({ candidateEmploymentType: undefined });
      const filters: HardFilters = { employmentType: 'full-time' };
      expect(applyHardFilters(filters, context)).toBe(false);
    });
  });
});
