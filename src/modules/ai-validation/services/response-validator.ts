import { z } from 'zod';
import { SCHEMA_REGISTRY, BaseValidationResultSchema, EnrichmentResultSchema } from '../schemas/index.js';
import type { AIValidationResult, AIEnrichmentResult } from '../types/index.js';

export class ResponseValidator {
  validateResponse(raw: string, fieldName: string): AIValidationResult | null {
    try {
      const parsed = JSON.parse(raw);
      const schema = SCHEMA_REGISTRY[fieldName] || BaseValidationResultSchema;
      const result = schema.safeParse(parsed);
      if (!result.success) return null;
      return result.data as AIValidationResult;
    } catch {
      return null;
    }
  }

  validateEnrichmentResponse(raw: string): AIEnrichmentResult | null {
    try {
      const parsed = JSON.parse(raw);
      const result = EnrichmentResultSchema.safeParse(parsed);
      if (!result.success) return null;
      return {
        fieldName: 'enrichment',
        value: JSON.stringify(result.data),
        confidence: 0.8,
        reason: result.data.reason,
        promptVersion: 'context-enrichment-v1',
      };
    } catch {
      return null;
    }
  }

  validateConfidenceRange(confidence: number): boolean {
    return confidence >= 0 && confidence <= 1;
  }

  validateAction(action: string): action is 'keep' | 'replace' | 'flag_for_review' {
    return ['keep', 'replace', 'flag_for_review'].includes(action);
  }

  isHallucination(suggested: string, original: string): boolean {
    if (!suggested || suggested.length === 0) return true;
    if (suggested === original) return false;
    if (suggested.length > original.length * 3) return true;
    return false;
  }
}
