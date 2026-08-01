import { describe, it, expect } from 'vitest';
import { ValidationService } from '../../services/validation.service.js';
import type { ResolvedCandidateProfile } from '../../../candidate-resolution/types/index.js';
import type { ResolvedField } from '../../../candidate-resolution/interfaces/index.js';

function makeField<T>(value: T, confidence = 0.9): ResolvedField<T> {
  return {
    value,
    raw: String(value),
    confidence,
    confidenceLevel: confidence >= 0.95 ? 'very_high' : confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
    reasons: [],
    sources: ['test'],
    isValid: true,
    validationWarnings: [],
  };
}

function makeProfile(overrides: Partial<ResolvedCandidateProfile> = {}): ResolvedCandidateProfile {
  return {
    candidateId: 'test-1',
    personal: {
      name: makeField('John Doe'),
      headline: makeField('Software Engineer'),
      summary: 'Experienced software engineer',
    },
    contact: {
      email: makeField('john@example.com'),
      phone: makeField('555-123-4567'),
      linkedin: null,
      github: null,
      portfolio: null,
      website: null,
      city: null,
      state: null,
      country: null,
    },
    skills: [makeField('TypeScript'), makeField('React')],
    experience: [{
      company: makeField('Google'),
      title: makeField('Senior Software Engineer'),
      employmentType: makeField('Full-time'),
      startDate: makeField('2020-01-01'),
      endDate: makeField('2023-01-01'),
      isCurrent: false,
      durationMonths: 36,
      responsibilities: [],
    }],
    education: [{
      degree: makeField('Bachelor of Science'),
      specialization: makeField('Computer Science'),
      university: makeField('MIT'),
      graduationYear: makeField('2018'),
      educationLevel: makeField('bachelors'),
    }],
    projects: [],
    certifications: [],
    languages: [],
    lowConfidenceFields: [],
    qualityScore: { overall: 0, fieldConfidence: 0, conflictCount: 0, resolvedCount: 0, missingFields: [], validationWarningCount: 0 },
    resolutionMetadata: {
      resolvedAt: new Date().toISOString(),
      resolutionTimeMs: 0,
      fieldsProcessed: 0,
      fieldsResolved: 0,
      fieldsWithConflict: 0,
    },
    ...overrides,
  };
}

describe('ValidationService', () => {
  const service = new ValidationService();

  describe('validate (dryRun)', () => {
    it('returns validated profile with metadata', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true });

      expect(result.candidateId).toBe('test-1');
      expect(result.validationMetadata).toBeDefined();
      expect(result.validationMetadata.validatedAt).toBeDefined();
      expect(result.validationMetadata.validationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('includes enrichment when enabled', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true, enableEnrichment: true });

      expect(result.enrichment).toBeDefined();
    });

    it('skips enrichment when disabled', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true, enableEnrichment: false });

      expect(result.enrichment.industry).toBeNull();
      expect(result.enrichment.primaryRole).toBeNull();
    });

    it('preserves candidate ID', async () => {
      const profile = makeProfile({ candidateId: 'abc-123' });
      const result = await service.validate(profile, { dryRun: true });

      expect(result.candidateId).toBe('abc-123');
    });

    it('preserves all profile data', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true });

      expect(result.personal.name?.value).toBe('John Doe');
      expect(result.contact.email?.value).toBe('john@example.com');
      expect(result.skills).toHaveLength(2);
      expect(result.experience).toHaveLength(1);
      expect(result.education).toHaveLength(1);
    });

    it('returns empty fieldsNeedingReview in dryRun', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true });

      expect(result.fieldsNeedingReview).toEqual([]);
    });

    it('returns empty auditTrail in dryRun', async () => {
      const profile = makeProfile();
      const result = await service.validate(profile, { dryRun: true });

      expect(result.auditTrail).toEqual([]);
    });
  });

  describe('validate (with low confidence fields)', () => {
    it('includes low confidence fields in analysis', async () => {
      const profile = makeProfile({
        personal: {
          name: makeField('Jon Doe', 0.55),
          headline: makeField('Engineer', 0.95),
          summary: '',
        },
      });
      const result = await service.validate(profile, { dryRun: true });

      expect(result.validationMetadata.fieldsSentToAI).toBeGreaterThan(0);
    });
  });
});
