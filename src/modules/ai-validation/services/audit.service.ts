import type { AuditEntry, ValidationMetadata } from '../types/index.js';

export class AuditService {
  private entries: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  recordBatch(entries: AuditEntry[]): void {
    this.entries.push(...entries);
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  getEntriesForField(fieldName: string): AuditEntry[] {
    return this.entries.filter(e => e.fieldName === fieldName);
  }

  clear(): void {
    this.entries = [];
  }

  buildMetadata(overrides: Partial<ValidationMetadata> = {}): ValidationMetadata {
    return {
      validatedAt: new Date().toISOString(),
      validationTimeMs: 0,
      fieldsSentToAI: 0,
      fieldsAccepted: 0,
      fieldsRejected: 0,
      fieldsFlaggedForReview: 0,
      enrichmentFieldsGenerated: 0,
      providerUsed: '',
      modelUsed: '',
      totalTokensUsed: 0,
      totalCostEstimate: 0,
      cacheHits: 0,
      cacheMisses: 0,
      ...overrides,
    };
  }
}
