import { describe, it, expect } from 'vitest';
import { MergeEngine } from '../../services/merge-engine.js';
import type { ResolvedField } from '../../../candidate-resolution/interfaces/index.js';
import type { AIValidationResult } from '../../types/index.js';

function makeField<T>(value: T, confidence = 0.9): ResolvedField<T> {
  return {
    value,
    raw: String(value),
    confidence,
    confidenceLevel: confidence >= 0.95 ? 'very_high' : confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
    reasons: ['deterministic'],
    sources: ['extractor'],
    isValid: true,
    validationWarnings: [],
  };
}

function makeAIResult(overrides: Partial<AIValidationResult> = {}): AIValidationResult {
  return {
    fieldName: 'personal.name',
    originalValue: 'Jon Doe',
    suggestedValue: 'John Doe',
    confidence: 0.92,
    reason: 'Minor spelling correction',
    action: 'replace',
    promptVersion: 'candidate-name-v1',
    ...overrides,
  };
}

describe('MergeEngine', () => {
  const engine = new MergeEngine();

  describe('mergeField', () => {
    it('keeps deterministic value when AI says keep', () => {
      const field = makeField('John Doe', 0.85);
      const aiResult = makeAIResult({ action: 'keep' });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(false);
      expect(result.field.value).toBe('John Doe');
    });

    it('flags field for review when AI says flag_for_review', () => {
      const field = makeField('Jon Doe', 0.50);
      const aiResult = makeAIResult({ action: 'flag_for_review' });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(false);
      expect(result.field.validationWarnings).toContain('NEEDS_REVIEW');
    });

    it('rejects AI replace when deterministic confidence is high', () => {
      const field = makeField('John Doe', 0.95);
      const aiResult = makeAIResult({ confidence: 0.88 });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(false);
      expect(result.field.value).toBe('John Doe');
    });

    it('rejects AI replace when AI confidence is below minimum', () => {
      const field = makeField('John Doe', 0.70);
      const aiResult = makeAIResult({ confidence: 0.50 });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(false);
      expect(result.field.value).toBe('John Doe');
    });

    it('rejects AI replace when improvement is insufficient', () => {
      const field = makeField('John Doe', 0.80);
      const aiResult = makeAIResult({ confidence: 0.85 });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(false);
      expect(result.field.value).toBe('John Doe');
    });

    it('accepts AI replace when deterministic is low confidence and AI is significantly better', () => {
      const field = makeField('Jon Doe', 0.55);
      const aiResult = makeAIResult({ confidence: 0.92, suggestedValue: 'John Doe' });

      const result = engine.mergeField(field, aiResult);
      expect(result.accepted).toBe(true);
      expect(result.field.value).toBe('John Doe');
      expect(result.field.confidence).toBe(0.92);
      expect(result.field.sources).toContain('ai-validation');
    });

    it('sets confidence to 1.0 max', () => {
      const field = makeField('Jon Doe', 0.55);
      const aiResult = makeAIResult({ confidence: 1.05 });

      const result = engine.mergeField(field, aiResult);
      expect(result.field.confidence).toBe(1.0);
    });
  });

  describe('mergeEnrichment', () => {
    it('merges enrichment fields', () => {
      const existing = {
        industry: null,
        domain: null,
        seniority: null,
        primaryRole: null,
        secondaryRoles: [],
        technologyStack: [],
        functionalArea: null,
        headline: null,
        summary: null,
      };

      const aiResult = {
        industry: 'Technology',
        domain: 'Cloud Infrastructure',
        seniority: 'senior',
        primaryRole: 'Software Engineer',
        secondaryRoles: ['Tech Lead'],
        technologyStack: ['TypeScript', 'AWS'],
        functionalArea: 'Engineering',
        headline: 'Senior Software Engineer',
        summary: 'Experienced engineer',
      };

      const merged = engine.mergeEnrichment(existing, aiResult);
      expect(merged.industry).toBe('Technology');
      expect(merged.domain).toBe('Cloud Infrastructure');
      expect(merged.seniority).toBe('senior');
      expect(merged.technologyStack).toEqual(['TypeScript', 'AWS']);
    });

    it('AI values overwrite when provided', () => {
      const existing = {
        industry: 'Healthcare',
        domain: null,
        seniority: null,
        primaryRole: null,
        secondaryRoles: [],
        technologyStack: [],
        functionalArea: null,
        headline: null,
        summary: null,
      };

      const aiResult = {
        industry: 'Technology',
        domain: 'Cloud',
      };

      const merged = engine.mergeEnrichment(existing, aiResult);
      expect(merged.industry).toBe('Technology');
      expect(merged.domain).toBe('Cloud');
    });

    it('preserves existing values when AI does not provide them', () => {
      const existing = {
        industry: 'Healthcare',
        domain: 'Medical',
        seniority: 'senior',
        primaryRole: null,
        secondaryRoles: [],
        technologyStack: [],
        functionalArea: null,
        headline: null,
        summary: null,
      };

      const aiResult = {
        industry: 'Technology',
      };

      const merged = engine.mergeEnrichment(existing, aiResult);
      expect(merged.industry).toBe('Technology');
      expect(merged.domain).toBe('Medical');
      expect(merged.seniority).toBe('senior');
    });
  });
});
