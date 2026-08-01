import type { ResolvedField } from '../../candidate-resolution/interfaces/index.js';
import type { AIValidationResult, AuditEntry, EnrichmentData } from '../types/index.js';
import { MERGE_CONFIG } from '../constants/index.js';
import { getConfidenceLevel } from '../../candidate-resolution/constants/index.js';

export class MergeEngine {
  mergeField<T>(
    deterministic: ResolvedField<T>,
    aiResult: AIValidationResult,
  ): { field: ResolvedField<T>; accepted: boolean; auditEntry: AuditEntry } {
    if (aiResult.action === 'keep') {
      return {
        field: deterministic,
        accepted: false,
        auditEntry: this.createAuditEntry(deterministic, aiResult, false),
      };
    }

    if (aiResult.action === 'flag_for_review') {
      return {
        field: {
          ...deterministic,
          validationWarnings: [...deterministic.validationWarnings, 'NEEDS_REVIEW'],
        },
        accepted: false,
        auditEntry: this.createAuditEntry(deterministic, aiResult, false),
      };
    }

    if (aiResult.action === 'replace') {
      if (deterministic.confidence >= MERGE_CONFIG.highConfidenceThreshold) {
        return {
          field: deterministic,
          accepted: false,
          auditEntry: this.createAuditEntry(deterministic, aiResult, false),
        };
      }

      if (aiResult.confidence < MERGE_CONFIG.minAIConfidence) {
        return {
          field: deterministic,
          accepted: false,
          auditEntry: this.createAuditEntry(deterministic, aiResult, false),
        };
      }

      if (aiResult.confidence <= deterministic.confidence + MERGE_CONFIG.minImprovement) {
        return {
          field: deterministic,
          accepted: false,
          auditEntry: this.createAuditEntry(deterministic, aiResult, false),
        };
      }

      const newConfidence = Math.min(aiResult.confidence, 1.0);
      return {
        field: {
          ...deterministic,
          value: aiResult.suggestedValue as T,
          confidence: newConfidence,
          confidenceLevel: getConfidenceLevel(newConfidence),
          reasons: [...deterministic.reasons, `AI validated: ${aiResult.reason}`],
          sources: [...deterministic.sources, 'ai-validation'],
          validationWarnings: deterministic.validationWarnings.filter((w: string) => w !== 'NEEDS_REVIEW'),
        },
        accepted: true,
        auditEntry: this.createAuditEntry(deterministic, aiResult, true),
      };
    }

    return {
      field: deterministic,
      accepted: false,
      auditEntry: this.createAuditEntry(deterministic, aiResult, false),
    };
  }

  mergeEnrichment(
    existing: EnrichmentData,
    aiResult: Record<string, unknown>,
  ): EnrichmentData {
    const enriched = { ...existing };

    if (aiResult.industry && typeof aiResult.industry === 'string') enriched.industry = aiResult.industry;
    if (aiResult.domain && typeof aiResult.domain === 'string') enriched.domain = aiResult.domain;
    if (aiResult.seniority && typeof aiResult.seniority === 'string') enriched.seniority = aiResult.seniority;
    if (aiResult.primaryRole && typeof aiResult.primaryRole === 'string') enriched.primaryRole = aiResult.primaryRole;
    if (Array.isArray(aiResult.secondaryRoles)) enriched.secondaryRoles = aiResult.secondaryRoles;
    if (Array.isArray(aiResult.technologyStack)) enriched.technologyStack = aiResult.technologyStack;
    if (aiResult.functionalArea && typeof aiResult.functionalArea === 'string') enriched.functionalArea = aiResult.functionalArea;
    if (aiResult.headline && typeof aiResult.headline === 'string') enriched.headline = aiResult.headline;
    if (aiResult.summary && typeof aiResult.summary === 'string') enriched.summary = aiResult.summary;

    return enriched;
  }

  private createAuditEntry(
    deterministic: ResolvedField<unknown>,
    aiResult: AIValidationResult,
    accepted: boolean,
  ): AuditEntry {
    return {
      fieldName: aiResult.fieldName,
      originalValue: String(deterministic.value),
      suggestedValue: aiResult.suggestedValue,
      confidenceBefore: deterministic.confidence,
      confidenceAfter: accepted ? aiResult.confidence : deterministic.confidence,
      reason: aiResult.reason,
      provider: '',
      model: '',
      promptVersion: aiResult.promptVersion,
      timestamp: new Date().toISOString(),
      tokensUsed: 0,
      latencyMs: 0,
    };
  }
}
