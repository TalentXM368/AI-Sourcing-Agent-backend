import { describe, it, expect } from 'vitest';
import { NormalizationService } from '../../services/normalization.service.js';
import { KnowledgeService } from '../../knowledge/index.js';

describe('NormalizationService', () => {
  const knowledge = new KnowledgeService();
  const service = new NormalizationService(knowledge);

  it('normalizes company names', () => {
    expect(service.normalizeField('company', 'goog')).toBe('Google');
  });

  it('normalizes skills to lowercase', () => {
    expect(service.normalizeField('skill', 'TypeScript')).toBe('typescript');
  });

  it('normalizes job titles', () => {
    expect(service.normalizeField('jobTitle', 'swe')).toBe('Software Engineer');
  });

  it('normalizes degrees', () => {
    expect(service.normalizeField('degree', 'bs')).toBe('Bachelor of Science');
  });

  it('returns raw value for unknown field names', () => {
    expect(service.normalizeField('unknown', 'test')).toBe('test');
  });

  it('returns raw value for location', () => {
    expect(service.normalizeField('location', 'San Francisco')).toBe('San Francisco');
  });
});
