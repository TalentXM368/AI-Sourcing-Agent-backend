import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class PhoneResolver extends BaseResolver<string, string> {
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
    const digits = value.replace(/\D/g, '');
    if (value.startsWith('+')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return value;
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    const digits = value.replace(/\D/g, '');
    if (digits.length < 10) warnings.push('Phone number too short');
    if (digits.length > 15) warnings.push('Phone number too long');
    return { isValid: warnings.length === 0, warnings };
  }
}
