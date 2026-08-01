import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class EmailResolver extends BaseResolver<string, string> {
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
    return value.toLowerCase().trim();
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(value)) warnings.push('Invalid email format');
    return { isValid: warnings.length === 0, warnings };
  }
}
