import { describe, it, expect } from 'vitest';
import { EnrichmentService } from '../../services/enrichment.service.js';
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

describe('EnrichmentService', () => {
  const service = new EnrichmentService();

  describe('generateEnrichment (dryRun)', () => {
    it('returns empty enrichment in dry run mode', async () => {
      const profile = makeProfile();
      const result = await service.generateEnrichment(profile, true);

      expect(result.metadata.skipped).toBe(false);
      expect(result.metadata.providerUsed).toBe('dry-run');
      expect(result.enrichment.industry).toBeNull();
      expect(result.enrichment.seniority).toBeNull();
    });

    it('skips enrichment when no qualifying skills or titles', async () => {
      const profile = makeProfile({
        skills: [makeField('typing', 0.30)],
        experience: [{
          company: makeField('Acme'),
          title: makeField('Worker', 0.30),
          employmentType: null,
          startDate: null,
          endDate: null,
          isCurrent: false,
          durationMonths: 0,
          responsibilities: [],
        }],
      });

      const result = await service.generateEnrichment(profile, true);
      expect(result.metadata.skipped).toBe(true);
    });

    it('does not skip when high-confidence skills exist', async () => {
      const profile = makeProfile();
      const result = await service.generateEnrichment(profile, true);
      expect(result.metadata.skipped).toBe(false);
    });
  });
});
