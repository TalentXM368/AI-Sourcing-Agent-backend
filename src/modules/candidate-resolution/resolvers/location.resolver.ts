import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

interface LocationInput {
  city: string | null;
  state: string | null;
  country: string | null;
}

export class LocationResolver extends BaseResolver<LocationInput, LocationInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<LocationInput>[]): ConsensusResult<LocationInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as LocationInput,
        normalized: null as unknown as LocationInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No location candidates'],
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
      reasons: ['Location resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: LocationInput): LocationInput {
    const resolved = this.knowledge.resolveLocation(
      [value.city, value.state, value.country].filter(Boolean).join(', ')
    );
    return {
      city: resolved.city || value.city,
      state: resolved.state || value.state,
      country: resolved.country || value.country,
    };
  }

  validate(value: LocationInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.city && !value.state && !value.country) {
      warnings.push('No location information');
    }
    return { isValid: warnings.length === 0, warnings };
  }
}
