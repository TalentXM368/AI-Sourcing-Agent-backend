import { describe, it, expect } from 'vitest';
import { ResponseValidator } from '../../services/response-validator.js';

describe('ResponseValidator', () => {
  const validator = new ResponseValidator();

  describe('validateResponse', () => {
    it('parses valid name validation response', () => {
      const raw = JSON.stringify({
        fieldName: 'personal.name',
        originalValue: 'Jon Doe',
        suggestedValue: 'John Doe',
        action: 'keep',
        confidence: 0.92,
        reason: 'Name appears correct',
      });

      const result = validator.validateResponse(raw, 'personal.name');
      expect(result).not.toBeNull();
      expect(result!.action).toBe('keep');
      expect(result!.confidence).toBe(0.92);
    });

    it('parses valid company validation response', () => {
      const raw = JSON.stringify({
        fieldName: 'experience.company',
        originalValue: 'Gogle',
        suggestedValue: 'Google LLC',
        action: 'replace',
        confidence: 0.88,
        reason: 'Company name standardization',
      });

      const result = validator.validateResponse(raw, 'experience.company');
      expect(result).not.toBeNull();
      expect(result!.action).toBe('replace');
    });

    it('returns null for invalid JSON', () => {
      const result = validator.validateResponse('not json', 'personal.name');
      expect(result).toBeNull();
    });

    it('returns null for missing required fields', () => {
      const raw = JSON.stringify({ action: 'keep', reason: 'ok' });
      const result = validator.validateResponse(raw, 'personal.name');
      expect(result).toBeNull();
    });

    it('returns null for invalid action', () => {
      const raw = JSON.stringify({
        action: 'invalid',
        confidence: 0.9,
        reason: 'test',
      });
      const result = validator.validateResponse(raw, 'personal.name');
      expect(result).toBeNull();
    });
  });

  describe('validateEnrichmentResponse', () => {
    it('parses valid enrichment response', () => {
      const raw = JSON.stringify({
        industry: 'Technology',
        domain: 'Cloud',
        seniority: 'senior',
        primaryRole: 'Engineer',
        secondaryRoles: [],
        technologyStack: ['TypeScript'],
        functionalArea: 'Engineering',
        headline: 'Senior Engineer',
        summary: 'Experienced',
        reason: 'Inferred from skills',
      });

      const result = validator.validateEnrichmentResponse(raw);
      expect(result).not.toBeNull();
      expect(result!.fieldName).toBe('enrichment');
    });

    it('returns null for invalid enrichment', () => {
      const raw = JSON.stringify({ industry: 123 });
      const result = validator.validateEnrichmentResponse(raw);
      expect(result).toBeNull();
    });
  });

  describe('validateConfidenceRange', () => {
    it('accepts valid confidence', () => {
      expect(validator.validateConfidenceRange(0.5)).toBe(true);
      expect(validator.validateConfidenceRange(0)).toBe(true);
      expect(validator.validateConfidenceRange(1)).toBe(true);
    });

    it('rejects out of range confidence', () => {
      expect(validator.validateConfidenceRange(-0.1)).toBe(false);
      expect(validator.validateConfidenceRange(1.1)).toBe(false);
    });
  });

  describe('validateAction', () => {
    it('accepts valid actions', () => {
      expect(validator.validateAction('keep')).toBe(true);
      expect(validator.validateAction('replace')).toBe(true);
      expect(validator.validateAction('flag_for_review')).toBe(true);
    });

    it('rejects invalid actions', () => {
      expect(validator.validateAction('delete')).toBe(false);
      expect(validator.validateAction('update')).toBe(false);
    });
  });

  describe('isHallucination', () => {
    it('detects empty suggested value', () => {
      expect(validator.isHallucination('', 'original')).toBe(true);
    });

    it('allows same value', () => {
      expect(validator.isHallucination('same', 'same')).toBe(false);
    });

    it('detects overly long suggestion', () => {
      const original = 'short';
      const long = 'a'.repeat(20);
      expect(validator.isHallucination(long, original)).toBe(true);
    });

    it('allows reasonable length change', () => {
      expect(validator.isHallucination('John Doe', 'Jon Doe')).toBe(false);
    });
  });
});
