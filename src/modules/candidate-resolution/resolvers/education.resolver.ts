import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

interface EducationInput {
  degree: string;
  specialization: string | null;
  university: string;
  graduationYearRaw: string | null;
  sourceSection: string;
  confidence: number;
}

export class EducationResolver extends BaseResolver<EducationInput, EducationInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<EducationInput>[]): ConsensusResult<EducationInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as EducationInput,
        normalized: null as unknown as EducationInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No education candidates'],
        sources: [],
        conflictDetected: false,
      };
    }

    const selected = candidates.reduce((best, curr) =>
      curr.confidence > best.confidence ? curr : best
    );

    const normalized = this.normalize(selected.value);

    return {
      selected: selected.value,
      normalized,
      alternatives: candidates.filter(c => c !== selected).map(c => c.value),
      confidence: selected.confidence,
      confidenceLevel: '',
      reasons: ['Education resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: EducationInput): EducationInput {
    return {
      ...value,
      degree: this.knowledge.resolveDegree(value.degree) || value.degree,
    };
  }

  validate(value: EducationInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.university || value.university === 'Unknown') warnings.push('University unknown');
    if (!value.degree || value.degree === 'Unknown') warnings.push('Degree unknown');
    return { isValid: warnings.length === 0, warnings };
  }
}
