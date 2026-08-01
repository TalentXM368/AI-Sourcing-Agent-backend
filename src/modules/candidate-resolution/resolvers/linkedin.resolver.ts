import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class LinkedinResolver extends BaseResolver<string, string> {
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
    let url = value.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    url = url.replace(/\/+$/, '');
    return url;
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    if (!/linkedin\.com\/in\//i.test(value)) warnings.push('Not a LinkedIn profile URL');
    return { isValid: warnings.length === 0, warnings };
  }
}
