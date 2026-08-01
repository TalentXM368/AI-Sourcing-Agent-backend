import { describe, it, expect } from 'vitest';
import { ResolutionService } from '../../services/resolution.service.js';
import type { CandidateProfile } from '../../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../../candidate-intelligence/types/common.types.js';

function makeSourceTracking(raw: string, extractor = 'test', sourceSection = 'header', score = 0.9): SourceTracking {
  return {
    raw,
    value: raw,
    extractor,
    sourceSection,
    confidence: { score, reasons: ['test'] },
  };
}

function makeCandidateProfile(): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: 'test-candidate-1',
    personal: {
      name: makeSourceTracking('John Doe'),
      headline: makeSourceTracking('Senior Software Engineer'),
      summary: 'Experienced software engineer with 10+ years.',
    },
    contact: {
      email: makeSourceTracking('john.doe@gmail.com', 'contact-extractor', 'contact'),
      phone: makeSourceTracking('555-123-4567', 'contact-extractor', 'contact'),
      linkedin: makeSourceTracking('https://linkedin.com/in/johndoe', 'contact-extractor', 'contact'),
      github: makeSourceTracking('https://github.com/johndoe', 'contact-extractor', 'contact'),
      portfolio: null,
      website: null,
      city: makeSourceTracking('San Francisco', 'contact-extractor', 'contact'),
      state: makeSourceTracking('California', 'contact-extractor', 'contact'),
      country: makeSourceTracking('United States', 'contact-extractor', 'contact'),
    },
    skills: [
      { canonical: 'TypeScript', raw: 'TypeScript', category: 'programming', confidence: { score: 0.95, reasons: ['direct'] } },
      { canonical: 'React', raw: 'React', category: 'framework', confidence: { score: 0.9, reasons: ['direct'] } },
      { canonical: 'Python', raw: 'Python', category: 'programming', confidence: { score: 0.85, reasons: ['direct'] } },
    ],
    experience: [
      {
        company: makeSourceTracking('Google', 'experience-extractor', 'experience'),
        title: makeSourceTracking('Senior Software Engineer', 'experience-extractor', 'experience'),
        employmentType: makeSourceTracking('Full-time', 'experience-extractor', 'experience'),
        startDate: makeSourceTracking('2020-01-01', 'experience-extractor', 'experience'),
        endDate: makeSourceTracking('2023-06-01', 'experience-extractor', 'experience'),
        isCurrent: false,
        durationMonths: 42,
        responsibilities: ['Led a team of 5 engineers', 'Built microservices'],
      },
      {
        company: makeSourceTracking('StartupCo', 'experience-extractor', 'experience'),
        title: makeSourceTracking('Software Engineer', 'experience-extractor', 'experience'),
        employmentType: makeSourceTracking('Full-time', 'experience-extractor', 'experience'),
        startDate: makeSourceTracking('2017-06-01', 'experience-extractor', 'experience'),
        endDate: makeSourceTracking('2019-12-31', 'experience-extractor', 'experience'),
        isCurrent: false,
        durationMonths: 30,
        responsibilities: ['Built full-stack features'],
      },
    ],
    education: [
      {
        degree: makeSourceTracking('Bachelor of Science', 'education-extractor', 'education'),
        specialization: makeSourceTracking('Computer Science', 'education-extractor', 'education'),
        university: makeSourceTracking('MIT', 'education-extractor', 'education'),
        graduationYear: makeSourceTracking('2017', 'education-extractor', 'education'),
        educationLevel: makeSourceTracking('bachelors', 'education-extractor', 'education'),
      },
    ],
    projects: [],
    certifications: [],
    languages: [
      { name: makeSourceTracking('English', 'language-extractor', 'languages'), proficiency: makeSourceTracking('Native', 'language-extractor', 'languages') },
    ],
    socialLinks: {
      linkedin: makeSourceTracking('https://linkedin.com/in/johndoe'),
      github: makeSourceTracking('https://github.com/johndoe'),
      portfolio: null,
      website: null,
    },
    timeline: [],
    rawDocument: {
      referenceId: 'doc-1',
      markdownLength: 2000,
      plainTextLength: 1500,
      sectionsCount: 5,
    },
    metadata: {
      resumeLanguage: 'en',
      pages: 2,
      hasTables: false,
      hasImages: false,
      sectionCount: 5,
      sourceFileName: 'john_doe_resume.pdf',
      sourceFileSize: 102400,
      mimeType: 'application/pdf',
    },
    processing: {
      parser: 'docling',
      parserVersion: '2.0.0',
      pipelineVersion: '1.0.0',
      processingTimeMs: 500,
      processedAt: new Date().toISOString(),
      warnings: [],
      errors: [],
      extractorsRun: ['contact', 'experience', 'education', 'skills', 'languages'],
      normalizersRun: ['skill', 'date', 'degree', 'phone', 'location'],
      resolversRun: ['entity', 'conflict', 'dedup'],
    },
    validation: {
      warnings: [],
      isValid: true,
    },
    completeness: {
      score: 0.85,
      missingFields: [],
      presentFields: ['name', 'email', 'phone', 'skills', 'experience', 'education'],
    },
  };
}

describe('ResolutionService', () => {
  const service = new ResolutionService();

  it('resolves a complete candidate profile', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.candidateId).toBe('test-candidate-1');
    expect(resolved.personal.name.value).toBe('John Doe');
    expect(resolved.contact.email?.value).toBe('john.doe@gmail.com');
    expect(resolved.contact.phone?.value).toBe('+15551234567');
    expect(resolved.contact.linkedin?.value).toBe('https://linkedin.com/in/johndoe');
  });

  it('resolves company names via knowledge dictionary', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.experience[0].company.value).toBe('Google');
  });

  it('resolves job titles via knowledge dictionary', async () => {
    const profile = makeCandidateProfile();
    // Use an alias
    profile.experience[0].title = makeSourceTracking('sr software engineer', 'experience-extractor', 'experience');
    const resolved = await service.resolve(profile);

    expect(resolved.experience[0].title.value).toBe('Senior Software Engineer');
  });

  it('resolves skills', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.skills.length).toBe(3);
    expect(resolved.skills.map(s => s.value)).toContain('typescript');
  });

  it('computes quality score', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.qualityScore.overall).toBeGreaterThan(0);
    expect(resolved.qualityScore.fieldConfidence).toBeGreaterThan(0);
  });

  it('populates resolution metadata', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.resolutionMetadata.resolvedAt).toBeDefined();
    expect(resolved.resolutionMetadata.fieldsProcessed).toBeGreaterThan(0);
  });

  it('handles profile with missing fields gracefully', async () => {
    const profile = makeCandidateProfile();
    profile.contact.email = null;
    profile.contact.phone = null;
    profile.contact.linkedin = null;
    profile.skills = [];
    profile.education = [];

    const resolved = await service.resolve(profile);
    expect(resolved.contact.email).toBeNull();
    expect(resolved.contact.phone).toBeNull();
    expect(resolved.skills).toHaveLength(0);
  });

  it('resolves education', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.education.length).toBe(1);
    expect(resolved.education[0].degree.value).toBe('Bachelor of Science');
    expect(resolved.education[0].university.value).toBe('MIT');
  });

  it('resolves languages', async () => {
    const profile = makeCandidateProfile();
    const resolved = await service.resolve(profile);

    expect(resolved.languages.length).toBe(1);
    expect(resolved.languages[0].name.value).toBe('English');
  });

  it('deduplicates skills', async () => {
    const profile = makeCandidateProfile();
    profile.skills.push({ canonical: 'typescript', raw: 'TS', category: 'programming', confidence: { score: 0.8, reasons: ['test'] } });
    const resolved = await service.resolve(profile);

    expect(resolved.skills.length).toBeLessThanOrEqual(profile.skills.length);
    const uniqueValues = new Set(resolved.skills.map(s => s.value));
    expect(uniqueValues.size).toBe(resolved.skills.length);
  });
});
