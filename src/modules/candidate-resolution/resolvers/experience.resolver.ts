import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';
import type { ExperienceEntry } from '../../candidate-intelligence/types/profile.types.js';

interface ExperienceInput {
  company: string;
  title: string;
  employmentType: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  isCurrent: boolean;
  responsibilities: string[];
  sourceSection: string;
  confidence: number;
}

export class ExperienceResolver extends BaseResolver<ExperienceInput, ExperienceInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<ExperienceInput>[]): ConsensusResult<ExperienceInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as ExperienceInput,
        normalized: null as unknown as ExperienceInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No experience candidates'],
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
      reasons: ['Experience resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: ExperienceInput): ExperienceInput {
    return {
      ...value,
      company: this.knowledge.resolveCompany(value.company) || value.company,
      title: this.knowledge.resolveJobTitle(value.title) || value.title,
    };
  }

  validate(value: ExperienceInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.company || value.company === 'Unknown') warnings.push('Company unknown');
    if (!value.title || value.title === 'Unknown') warnings.push('Title unknown');
    if (value.startDateRaw && value.endDateRaw && !value.isCurrent) {
      const start = new Date(value.startDateRaw);
      const end = new Date(value.endDateRaw);
      if (start > end) warnings.push('Start date after end date');
    }
    return { isValid: warnings.length === 0, warnings };
  }
}
