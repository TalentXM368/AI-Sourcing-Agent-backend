import { describe, it, expect } from 'vitest';
import { normalizeEmploymentType, normalizeWorkMode } from '../../normalizers/employment-normalizer.js';

describe('Employment Normalizer', () => {
  describe('normalizeEmploymentType', () => {
    it('detects full-time', () => {
      expect(normalizeEmploymentType('Full-time position')).toBe('full-time');
      expect(normalizeEmploymentType('Permanent role')).toBe('full-time');
    });

    it('detects part-time', () => {
      expect(normalizeEmploymentType('Part-time hours')).toBe('part-time');
    });

    it('detects contract', () => {
      expect(normalizeEmploymentType('Contract role for 6 months')).toBe('contract');
      expect(normalizeEmploymentType('1099 contractor')).toBe('contract');
    });

    it('detects internship', () => {
      expect(normalizeEmploymentType('Summer internship')).toBe('internship');
    });

    it('detects freelance', () => {
      expect(normalizeEmploymentType('Freelance designer needed')).toBe('freelance');
    });

    it('defaults to full-time', () => {
      expect(normalizeEmploymentType('Some random text')).toBe('full-time');
    });
  });

  describe('normalizeWorkMode', () => {
    it('detects remote', () => {
      expect(normalizeWorkMode('Fully remote position')).toBe('remote');
      expect(normalizeWorkMode('Work from home')).toBe('remote');
    });

    it('detects hybrid', () => {
      expect(normalizeWorkMode('Hybrid - 3 days in office')).toBe('hybrid');
    });

    it('detects onsite', () => {
      expect(normalizeWorkMode('On-site in San Francisco')).toBe('onsite');
    });

    it('defaults to onsite', () => {
      expect(normalizeWorkMode('No location specified')).toBe('onsite');
    });
  });
});
