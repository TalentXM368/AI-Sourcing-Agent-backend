import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import { normalizeName } from '../utils/string-similarity.js';
import type { KnowledgeService } from '../knowledge/index.js';

export class NameResolver extends BaseResolver<string, string> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<string>[]): ConsensusResult<string> {
    const filtered = candidates.filter(c =>
      c.value && c.value !== 'Unknown' && c.value.length > 1 && !/^\d+$/.test(c.value)
    );
    const { consensus, confidence, level, reasons } = this.runConsensusWithConfidence(
      filtered.length > 0 ? filtered : candidates,
      v => this.normalize(v),
    );
    return { ...consensus, confidence, confidenceLevel: level, reasons };
  }

  normalize(value: string): string {
    let cleaned = value
      .replace(/\.(?:pdf|docx?|txt)$/i, '')
      .replace(/[^a-zA-Z\s\-\.]/g, '')
      .replace(/^[\s\._-]+/, '')
      .trim();

    const tokens = cleaned.split(/\s+/);
    if (tokens.length >= 3 && tokens.every(t => t.length === 1)) {
      cleaned = tokens.join('');
    }

    return normalizeName(cleaned);
  }

  validate(value: string): ValidationResult {
    const warnings: string[] = [];
    if (!value || value === 'Unknown') warnings.push('Name is unknown');
    if (value.length < 2) warnings.push('Name too short');
    if (/^\d+$/.test(value)) warnings.push('Name is numeric only');
    return { isValid: warnings.length === 0, warnings };
  }
}
