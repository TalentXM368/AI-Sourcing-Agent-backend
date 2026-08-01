import { describe, it, expect } from 'vitest';
import { validateJobCompleteness, validateJobWarnings } from '../../validators/index.js';
import type { JobProfile } from '../../types/index.js';
import { st } from '../../utils/index.js';

function makeProfile(overrides: Partial<JobProfile> = {}): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: 'test-1',
    title: st('Software Engineer', 'test', 'test', 0.9),
    summary: st('Build things', 'test', 'test', 0.8),
    company: st('TestCorp', 'test', 'test', 0.9),
    industry: st('Technology', 'test', 'test', 0.8),
    domain: null,
    department: null,
    employmentType: st('full-time', 'test', 'test', 0.9),
    workMode: st('remote', 'test', 'test', 0.8),
    seniority: st('senior', 'test', 'test', 0.8),
    experience: { minimumYears: st('3', 'test', 'test', 0.8), maximumYears: st('5', 'test', 'test', 0.8), preferredYears: null },
    education: { degree: st('Bachelor', 'test', 'test', 0.7), specialization: null, educationLevel: st('bachelor', 'test', 'test', 0.7) },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: st('SF', 'test', 'test', 0.7), state: null, country: null, raw: null },
    requiredSkills: [{ canonical: 'javascript', raw: 'JavaScript', category: 'language', confidence: 0.9 }],
    preferredSkills: [],
    certifications: [],
    languages: [],
    responsibilities: ['Build web apps'],
    benefits: [],
    technologies: ['React'],
    tools: [],
    workAuthorization: null,
    visaSponsorship: null,
    travelRequirements: null,
    shift: null,
    metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
    processing: { pipelineVersion: '3.0.0', processingTimeMs: 100, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0, completeness: 0, fieldConfidence: 0, missingFields: [], suggestions: [] },
    ...overrides,
  };
}

describe('Job Validators', () => {
  describe('validateJobCompleteness', () => {
    it('scores complete profile high', () => {
      const result = validateJobCompleteness(makeProfile());
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    it('detects missing fields', () => {
      const profile = makeProfile({
        title: st('', 'test', 'test', 0),
        company: st('', 'test', 'test', 0),
        requiredSkills: [],
      });
      const result = validateJobCompleteness(profile);
      expect(result.missingFields).toContain('title');
      expect(result.missingFields).toContain('company');
    });
  });

  describe('validateJobWarnings', () => {
    it('warns on missing title', () => {
      const profile = makeProfile({ title: st('Unknown Role', 'test', 'test', 0) });
      const warnings = validateJobWarnings(profile);
      expect(warnings.some(w => w.field === 'title')).toBe(true);
    });

    it('warns on empty skills', () => {
      const profile = makeProfile({ requiredSkills: [] });
      const warnings = validateJobWarnings(profile);
      expect(warnings.some(w => w.field === 'requiredSkills')).toBe(true);
    });

    it('warns on impossible experience', () => {
      const profile = makeProfile({
        experience: { minimumYears: st('10', 'test', 'test', 0.8), maximumYears: st('3', 'test', 'test', 0.8), preferredYears: null },
      });
      const warnings = validateJobWarnings(profile);
      expect(warnings.some(w => w.severity === 'error')).toBe(true);
    });

    it('returns no errors for valid profile', () => {
      const warnings = validateJobWarnings(makeProfile());
      expect(warnings.filter(w => w.severity === 'error')).toHaveLength(0);
    });
  });
});
