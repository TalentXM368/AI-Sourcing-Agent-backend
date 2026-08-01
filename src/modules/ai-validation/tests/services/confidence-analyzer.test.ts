import { describe, it, expect } from 'vitest';
import { ConfidenceAnalyzer } from '../../services/confidence-analyzer.js';
import type { ResolvedCandidateProfile, ResolvedExperienceEntry } from '../../../candidate-resolution/types/index.js';
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

function makeExp(overrides: Partial<ResolvedExperienceEntry> = {}): ResolvedExperienceEntry {
  return {
    company: makeField('Google'),
    title: makeField('Software Engineer'),
    employmentType: makeField('Full-time'),
    startDate: makeField('2020-01-01'),
    endDate: makeField('2023-01-01'),
    isCurrent: false,
    durationMonths: 36,
    responsibilities: [],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ResolvedCandidateProfile> = {}): ResolvedCandidateProfile {
  return {
    candidateId: 'test-1',
    personal: {
      name: makeField('John Doe'),
      headline: makeField('Software Engineer'),
      summary: 'Test summary',
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
    experience: [makeExp()],
    education: [],
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

describe('ConfidenceAnalyzer', () => {
  const analyzer = new ConfidenceAnalyzer();

  describe('analyze', () => {
    it('returns empty for high-confidence fields', () => {
      const profile = makeProfile();
      const contexts = analyzer.analyze(profile);
      // All fields have 0.9 confidence which is >= 0.90 threshold
      expect(contexts).toHaveLength(0);
    });

    it('includes low-confidence fields', () => {
      const profile = makeProfile({
        personal: {
          name: makeField('Jon Doe', 0.65),
          headline: makeField('Engineer', 0.95),
          summary: '',
        },
      });
      const contexts = analyzer.analyze(profile);
      expect(contexts.length).toBeGreaterThan(0);
      expect(contexts.some(c => c.fieldName === 'personal.name')).toBe(true);
    });

    it('respects skipFields option', () => {
      const profile = makeProfile({
        personal: {
          name: makeField('Jon Doe', 0.65),
          headline: makeField('Engineer', 0.95),
          summary: '',
        },
      });
      const contexts = analyzer.analyze(profile, { skipFields: ['personal.name'] });
      expect(contexts.every(c => c.fieldName !== 'personal.name')).toBe(true);
    });

    it('forceFields overrides skip threshold', () => {
      const profile = makeProfile({
        personal: {
          name: makeField('John Doe', 0.95),
          headline: makeField('Engineer', 0.95),
          summary: '',
        },
      });
      const contexts = analyzer.analyze(profile, { forceFields: ['personal.name'] });
      expect(contexts.some(c => c.fieldName === 'personal.name')).toBe(true);
    });

    it('includes experience fields', () => {
      const profile = makeProfile({
        experience: [makeExp({
          company: makeField('Gogle', 0.70),
          title: makeField('SWE', 0.70),
        })],
      });
      const contexts = analyzer.analyze(profile);
      expect(contexts.some(c => c.fieldName.startsWith('experience'))).toBe(true);
    });

    it('excludes email (immutable field)', () => {
      const profile = makeProfile({
        contact: {
          email: makeField('john@example.com', 0.50),
          phone: null,
          linkedin: null,
          github: null,
          portfolio: null,
          website: null,
          city: null,
          state: null,
          country: null,
        },
      });
      const contexts = analyzer.analyze(profile);
      expect(contexts.every(c => !c.fieldName.includes('email'))).toBe(true);
    });
  });
});
