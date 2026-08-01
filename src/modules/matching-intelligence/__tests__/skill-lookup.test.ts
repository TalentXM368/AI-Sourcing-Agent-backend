import { describe, it, expect } from 'vitest';
import { getAliasesForCanonical, hasAliasForCanonical, findCanonicalFromAlias } from '../constants/skill-lookup.js';

describe('skill-lookup', () => {
  describe('getAliasesForCanonical', () => {
    it('returns aliases for known canonical skill', () => {
      const aliases = getAliasesForCanonical('javascript');
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases).toContain('js');
    });

    it('returns empty array for unknown skill', () => {
      const aliases = getAliasesForCanonical('unknown-skill');
      expect(aliases).toEqual([]);
    });

    it('is case-insensitive', () => {
      const aliases = getAliasesForCanonical('JavaScript');
      expect(aliases).toContain('js');
    });

    it('returns multiple aliases', () => {
      const aliases = getAliasesForCanonical('react');
      expect(aliases.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('hasAliasForCanonical', () => {
    it('returns true when candidate has alias for canonical', () => {
      expect(hasAliasForCanonical('javascript', 'js')).toBe(true);
    });

    it('returns false when candidate lacks alias', () => {
      expect(hasAliasForCanonical('javascript', 'python')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(hasAliasForCanonical('JavaScript', 'JS')).toBe(true);
    });
  });

  describe('findCanonicalFromAlias', () => {
    it('returns canonical for known alias', () => {
      expect(findCanonicalFromAlias('js')).toBe('javascript');
    });

    it('returns null for unknown alias', () => {
      expect(findCanonicalFromAlias('unknown')).toBeNull();
    });

    it('is case-insensitive', () => {
      expect(findCanonicalFromAlias('JS')).toBe('javascript');
    });
  });
});
