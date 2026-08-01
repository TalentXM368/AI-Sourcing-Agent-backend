import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import { normalizeForComparison } from '../utils/string-similarity.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class SkillResolver extends BaseResolver<string, string> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<string>[]): ConsensusResult<string> {
    const { consensus, confidence, level, reasons } = this.runConsensusWithConfidence(
      candidates,
      v => this.normalize(v),
    );
    return { ...consensus, confidence, confidenceLevel: level, reasons };
  }

  normalize(value: string): string {
    return normalizeForComparison(value);
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    if (!value || value.length < 2) warnings.push('Skill name too short');
    if (value.length > 50) warnings.push('Skill name too long');
    return { isValid: warnings.length === 0, warnings };
  }
}
