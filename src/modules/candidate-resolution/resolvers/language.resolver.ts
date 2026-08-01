import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

interface LanguageInput {
  name: string;
  proficiency: string | null;
  sourceSection: string;
  confidence: number;
}

export class LanguageResolver extends BaseResolver<LanguageInput, LanguageInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<LanguageInput>[]): ConsensusResult<LanguageInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as LanguageInput,
        normalized: null as unknown as LanguageInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No language candidates'],
        sources: [],
        conflictDetected: false,
      };
    }

    const selected = candidates.reduce((best, curr) =>
      curr.confidence > best.confidence ? curr : best
    );

    return {
      selected: selected.value,
      normalized: this.normalize(selected.value),
      alternatives: candidates.filter(c => c !== selected).map(c => c.value),
      confidence: selected.confidence,
      confidenceLevel: '',
      reasons: ['Language resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: LanguageInput): LanguageInput {
    return {
      ...value,
      name: value.name.trim().replace(/\b\w/g, c => c.toUpperCase()),
      proficiency: value.proficiency?.trim().toLowerCase() || null,
    };
  }

  validate(value: LanguageInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.name || value.name.length < 2) warnings.push('Language name too short');
    if (!this.knowledge.isKnownLanguage(value.name)) {
      warnings.push('Language not in known languages list');
    }
    return { isValid: warnings.length === 0, warnings };
  }
}
