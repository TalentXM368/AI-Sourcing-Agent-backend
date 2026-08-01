import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

interface CertificationInput {
  name: string;
  issuer: string | null;
  dateRaw: string | null;
  sourceSection: string;
  confidence: number;
}

export class CertificationResolver extends BaseResolver<CertificationInput, CertificationInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<CertificationInput>[]): ConsensusResult<CertificationInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as CertificationInput,
        normalized: null as unknown as CertificationInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No certification candidates'],
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
      reasons: ['Certification resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: CertificationInput): CertificationInput {
    return {
      ...value,
      name: value.name.trim(),
      issuer: value.issuer?.trim() || null,
    };
  }

  validate(value: CertificationInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.name || value.name.length < 3) warnings.push('Certification name too short');
    return { isValid: warnings.length === 0, warnings };
  }
}
