import { describe, it, expect } from 'vitest';
import { validateDuplicates } from '../../validators/duplicate.validator.js';
import { validateTimeline } from '../../validators/timeline.validator.js';
import { computeQualityScore } from '../../validators/quality.validator.js';
import { validateCompleteness } from '../../validators/completeness.validator.js';
import type { ResolvedField } from '../../interfaces/resolved-field.type.js';
import type { ResolvedCandidateProfile, ResolvedExperienceEntry, ResolvedEducationEntry } from '../../types/index.js';

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
      summary: 'Test summary',
    },
    contact: {
      email: makeField('john@example.com'),
      phone: makeField('555-123-4567'),
      linkedin: makeField('https://linkedin.com/in/johndoe'),
      github: null,
      portfolio: null,
      website: null,
      city: makeField('San Francisco'),
      state: makeField('California'),
      country: makeField('United States'),
    },
    skills: [makeField('TypeScript'), makeField('React')],
    experience: [{
      company: makeField('Google'),
      title: makeField('Software Engineer'),
      employmentType: makeField('Full-time'),
      startDate: makeField('2020-01-01'),
      endDate: makeField('2023-01-01'),
      isCurrent: false,
      durationMonths: 36,
      responsibilities: ['Built stuff'],
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

describe('validateDuplicates', () => {
  it('detects duplicate skills', () => {
    const profile = makeProfile({
      skills: [makeField('TypeScript'), makeField('typescript')],
    });
    const warnings = validateDuplicates(profile);
    expect(warnings.some(w => w.includes('Duplicate skills'))).toBe(true);
  });

  it('detects duplicate companies', () => {
    const profile = makeProfile({
      experience: [
        { ...makeProfile().experience[0], company: makeField('Google') },
        { ...makeProfile().experience[0], company: makeField('Google') },
      ],
    });
    const warnings = validateDuplicates(profile);
    expect(warnings.some(w => w.includes('Duplicate companies'))).toBe(true);
  });

  it('returns empty for no duplicates', () => {
    const warnings = validateDuplicates(makeProfile());
    expect(warnings).toHaveLength(0);
  });
});

describe('validateTimeline', () => {
  it('detects start date after end date', () => {
    const profile = makeProfile({
      experience: [{
        ...makeProfile().experience[0],
        startDate: makeField('2023-01-01'),
        endDate: makeField('2020-01-01'),
        isCurrent: false,
      }],
    });
    const warnings = validateTimeline(profile);
    expect(warnings.some(w => w.includes('start date'))).toBe(true);
  });

  it('detects multiple current roles', () => {
    const profile = makeProfile({
      experience: [
        { ...makeProfile().experience[0], isCurrent: true, company: makeField('Google') },
        { ...makeProfile().experience[0], isCurrent: true, company: makeField('Meta') },
      ],
    });
    const warnings = validateTimeline(profile);
    expect(warnings.some(w => w.includes('Multiple current roles'))).toBe(true);
  });

  it('returns empty for valid timeline', () => {
    const warnings = validateTimeline(makeProfile());
    expect(warnings).toHaveLength(0);
  });
});

describe('validateCompleteness', () => {
  it('returns empty for complete profile', () => {
    const missing = validateCompleteness(makeProfile());
    expect(missing).toHaveLength(0);
  });

  it('detects missing email', () => {
    const profile = makeProfile({ contact: { ...makeProfile().contact, email: null } });
    const missing = validateCompleteness(profile);
    expect(missing).toContain('contact.email');
  });

  it('detects missing skills', () => {
    const profile = makeProfile({ skills: [] });
    const missing = validateCompleteness(profile);
    expect(missing).toContain('skills');
  });

  it('detects missing experience', () => {
    const profile = makeProfile({ experience: [] });
    const missing = validateCompleteness(profile);
    expect(missing).toContain('experience');
  });

  it('detects unknown name', () => {
    const profile = makeProfile({
      personal: { ...makeProfile().personal, name: makeField('Unknown') },
    });
    const missing = validateCompleteness(profile);
    expect(missing).toContain('personal.name');
  });
});

describe('computeQualityScore', () => {
  it('computes score for complete profile', () => {
    const score = computeQualityScore(makeProfile());
    expect(score.overall).toBeGreaterThan(0);
    expect(score.fieldConfidence).toBeGreaterThan(0);
    expect(score.missingFields).toHaveLength(0);
  });

  it('penalizes incomplete profile', () => {
    const incomplete = makeProfile({ skills: [], experience: [], education: [] });
    const complete = makeProfile();
    const incompleteScore = computeQualityScore(incomplete);
    const completeScore = computeQualityScore(complete);
    expect(incompleteScore.overall).toBeLessThan(completeScore.overall);
  });

  it('includes missing fields', () => {
    const score = computeQualityScore(makeProfile({ skills: [] }));
    expect(score.missingFields).toContain('skills');
  });
});
