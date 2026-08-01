import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import { normalizeCompanyName } from '../utils/string-similarity.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class CompanyResolver extends BaseResolver<string, string> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<string>[]): ConsensusResult<string> {
    const filtered = candidates.filter(c =>
      c.value && c.value !== 'Unknown' && c.value.length > 1
    );
    const { consensus, confidence, level, reasons } = this.runConsensusWithConfidence(
      filtered.length > 0 ? filtered : candidates,
      v => this.normalize(v),
    );
    return { ...consensus, confidence, confidenceLevel: level, reasons };
  }

  normalize(value: string): string {
    const resolved = this.knowledge.resolveCompany(value);
    return resolved || normalizeCompanyName(value);
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    if (!value || value === 'Unknown') warnings.push('Company name is unknown');
    if (value.length < 2) warnings.push('Company name too short');
    return { isValid: warnings.length === 0, warnings };
  }
}
