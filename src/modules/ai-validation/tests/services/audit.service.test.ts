import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../../services/audit.service.js';
import type { AuditEntry } from '../../types/index.js';

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    fieldName: 'personal.name',
    originalValue: 'Jon Doe',
    suggestedValue: 'John Doe',
    confidenceBefore: 0.7,
    confidenceAfter: 0.9,
    reason: 'Minor spelling correction',
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptVersion: 'candidate-name-v1',
    timestamp: new Date().toISOString(),
    tokensUsed: 150,
    latencyMs: 300,
    ...overrides,
  };
}

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
  });

  describe('record', () => {
    it('records a single entry', () => {
      const entry = makeAuditEntry();
      service.record(entry);
      expect(service.getEntries()).toHaveLength(1);
      expect(service.getEntries()[0]).toEqual(entry);
    });

    it('records multiple entries', () => {
      service.record(makeAuditEntry({ fieldName: 'name' }));
      service.record(makeAuditEntry({ fieldName: 'company' }));
      expect(service.getEntries()).toHaveLength(2);
    });
  });

  describe('recordBatch', () => {
    it('records multiple entries at once', () => {
      const entries = [
        makeAuditEntry({ fieldName: 'name' }),
        makeAuditEntry({ fieldName: 'company' }),
        makeAuditEntry({ fieldName: 'title' }),
      ];
      service.recordBatch(entries);
      expect(service.getEntries()).toHaveLength(3);
    });
  });

  describe('getEntriesForField', () => {
    it('filters entries by field name', () => {
      service.record(makeAuditEntry({ fieldName: 'name' }));
      service.record(makeAuditEntry({ fieldName: 'company' }));
      service.record(makeAuditEntry({ fieldName: 'name' }));

      const nameEntries = service.getEntriesForField('name');
      expect(nameEntries).toHaveLength(2);
    });

    it('returns empty array for non-existent field', () => {
      service.record(makeAuditEntry({ fieldName: 'name' }));
      expect(service.getEntriesForField('nonexistent')).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('clears all entries', () => {
      service.record(makeAuditEntry());
      service.record(makeAuditEntry());
      service.clear();
      expect(service.getEntries()).toHaveLength(0);
    });
  });

  describe('buildMetadata', () => {
    it('returns default metadata', () => {
      const metadata = service.buildMetadata();
      expect(metadata.validatedAt).toBeDefined();
      expect(metadata.validationTimeMs).toBe(0);
      expect(metadata.fieldsSentToAI).toBe(0);
      expect(metadata.fieldsAccepted).toBe(0);
      expect(metadata.fieldsRejected).toBe(0);
    });

    it('applies overrides', () => {
      const metadata = service.buildMetadata({
        fieldsSentToAI: 5,
        fieldsAccepted: 3,
        providerUsed: 'openai',
      });
      expect(metadata.fieldsSentToAI).toBe(5);
      expect(metadata.fieldsAccepted).toBe(3);
      expect(metadata.providerUsed).toBe('openai');
      // Default values preserved
      expect(metadata.fieldsRejected).toBe(0);
    });
  });
});
