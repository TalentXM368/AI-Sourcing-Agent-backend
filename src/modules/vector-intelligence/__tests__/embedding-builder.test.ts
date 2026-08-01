import { describe, it, expect } from 'vitest';
import { buildCandidateSemanticText, buildCandidateQdrantPayload } from '../builders/candidate-embedding-builder.js';
import { buildJobSemanticText, buildJobQdrantPayload } from '../builders/job-embedding-builder.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

function createMockCandidateProfile(overrides?: Partial<CandidateProfile>): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: 'test-candidate-123',
    personal: {
      name: { raw: 'John Smith', value: 'John Smith', extractor: 'test', sourceSection: 'header', confidence: { score: 0.95, reasons: [] } },
      headline: { raw: 'Senior Software Engineer', value: 'Senior Software Engineer', extractor: 'test', sourceSection: 'header', confidence: { score: 0.9, reasons: [] } },
      summary: 'Experienced full-stack engineer with 8 years of experience.',
    },
    contact: {
      email: { raw: 'john@example.com', value: 'john@example.com', extractor: 'test', sourceSection: 'contact', confidence: { score: 0.95, reasons: [] } },
      phone: null,
      linkedin: null,
      github: null,
      portfolio: null,
      website: null,
      city: { raw: 'San Francisco', value: 'San Francisco', extractor: 'test', sourceSection: 'contact', confidence: { score: 0.8, reasons: [] } },
      state: { raw: 'CA', value: 'CA', extractor: 'test', sourceSection: 'contact', confidence: { score: 0.8, reasons: [] } },
      country: { raw: 'USA', value: 'USA', extractor: 'test', sourceSection: 'contact', confidence: { score: 0.8, reasons: [] } },
    },
    skills: [
      { canonical: 'TypeScript', raw: 'TypeScript', category: 'language', confidence: { score: 0.95, reasons: [] } },
      { canonical: 'React', raw: 'React', category: 'framework', confidence: { score: 0.9, reasons: [] } },
      { canonical: 'Node.js', raw: 'Node.js', category: 'platform', confidence: { score: 0.85, reasons: [] } },
    ],
    experience: [
      {
        company: { raw: 'TechCorp', value: 'TechCorp', extractor: 'test', sourceSection: 'experience', confidence: { score: 0.9, reasons: [] } },
        title: { raw: 'Senior Engineer', value: 'Senior Engineer', extractor: 'test', sourceSection: 'experience', confidence: { score: 0.9, reasons: [] } },
        employmentType: null,
        startDate: null,
        endDate: null,
        isCurrent: true,
        durationMonths: 36,
        responsibilities: ['Led team of 5', 'Built microservices'],
      },
    ],
    education: [
      {
        degree: { raw: 'BS Computer Science', value: 'BS Computer Science', extractor: 'test', sourceSection: 'education', confidence: { score: 0.9, reasons: [] } },
        specialization: null,
        university: { raw: 'Stanford University', value: 'Stanford University', extractor: 'test', sourceSection: 'education', confidence: { score: 0.9, reasons: [] } },
        graduationYear: null,
        educationLevel: null,
      },
    ],
    projects: [],
    certifications: [],
    languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: 'ref-1', markdownLength: 1000, plainTextLength: 800, sectionsCount: 5 },
    metadata: { resumeLanguage: 'en', pages: 2, hasTables: false, hasImages: false, sectionCount: 5, sourceFileName: 'resume.pdf', sourceFileSize: 100000, mimeType: 'application/pdf' },
    processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 100, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.85, missingFields: [], presentFields: [] },
    ...overrides,
  };
}

function createMockJobProfile(overrides?: Partial<JobProfile>): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: 'test-job-456',
    title: { raw: 'Backend Developer', value: 'Backend Developer', extractor: 'test', sourceSection: 'title', confidence: { score: 0.95, reasons: [] } },
    summary: { raw: 'We need a backend developer', value: 'We need a backend developer', extractor: 'test', sourceSection: 'summary', confidence: { score: 0.8, reasons: [] } },
    company: { raw: 'StartupInc', value: 'StartupInc', extractor: 'test', sourceSection: 'company', confidence: { score: 0.9, reasons: [] } },
    industry: { raw: 'Technology', value: 'Technology', extractor: 'test', sourceSection: 'industry', confidence: { score: 0.7, reasons: [] } },
    domain: null,
    department: null,
    employmentType: { raw: 'full-time', value: 'full-time', extractor: 'test', sourceSection: 'type', confidence: { score: 0.9, reasons: [] } },
    workMode: { raw: 'remote', value: 'remote', extractor: 'test', sourceSection: 'mode', confidence: { score: 0.8, reasons: [] } },
    seniority: { raw: 'senior', value: 'senior', extractor: 'test', sourceSection: 'seniority', confidence: { score: 0.85, reasons: [] } },
    experience: {
      minimumYears: { raw: '5', value: '5', extractor: 'test', sourceSection: 'experience', confidence: { score: 0.8, reasons: [] } },
      maximumYears: { raw: '8', value: '8', extractor: 'test', sourceSection: 'experience', confidence: { score: 0.8, reasons: [] } },
      preferredYears: null,
    },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: {
      city: { raw: 'Remote', value: 'Remote', extractor: 'test', sourceSection: 'location', confidence: { score: 0.9, reasons: [] } },
      state: null,
      country: null,
      raw: { raw: 'Remote', value: 'Remote', extractor: 'test', sourceSection: 'location', confidence: { score: 0.9, reasons: [] } },
    },
    requiredSkills: [
      { canonical: 'Python', raw: 'Python', category: 'language', confidence: 0.95 },
      { canonical: 'PostgreSQL', raw: 'PostgreSQL', category: 'tool', confidence: 0.9 },
    ],
    preferredSkills: [
      { canonical: 'Docker', raw: 'Docker', category: 'tool', confidence: 0.7 },
    ],
    certifications: [],
    languages: [],
    responsibilities: ['Design APIs', 'Write tests', 'Deploy to production'],
    benefits: [],
    technologies: [],
    tools: [],
    workAuthorization: null,
    visaSponsorship: null,
    travelRequirements: null,
    shift: null,
    metadata: { sourceFileName: 'jd.pdf', sourceFileSize: 50000, mimeType: 'application/pdf', pages: 1, hasTables: false, sectionCount: 3 },
    processing: { pipelineVersion: '3.0.0', processingTimeMs: 50, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.8, completeness: 0.7, fieldConfidence: 0.85, missingFields: [], suggestions: [] },
    ...overrides,
  };
}

describe('buildCandidateSemanticText', () => {
  it('builds semantic text from profile', () => {
    const profile = createMockCandidateProfile();
    const result = buildCandidateSemanticText(profile);

    expect(result.role).toBe('Senior Software Engineer');
    expect(result.skills).toBe('TypeScript, React, Node.js');
    expect(result.summary).toBe('Experienced full-stack engineer with 8 years of experience.');
    expect(result.experience).toContain('Senior Engineer at TechCorp');
    expect(result.experience).toContain('36 months');
    expect(result.education).toContain('BS Computer Science from Stanford University');
    expect(result.location).toBe('San Francisco, CA, USA');
  });

  it('combines all parts into full text', () => {
    const profile = createMockCandidateProfile();
    const result = buildCandidateSemanticText(profile);

    expect(result.full).toContain('Role: Senior Software Engineer');
    expect(result.full).toContain('Skills: TypeScript, React, Node.js');
    expect(result.full).toContain('Summary:');
    expect(result.full).toContain('Experience:');
    expect(result.full).toContain('Education:');
    expect(result.full).toContain('Location: San Francisco, CA, USA');
  });

  it('handles missing headline by using first experience title', () => {
    const profile = createMockCandidateProfile();
    profile.personal.headline = null;

    const result = buildCandidateSemanticText(profile);
    expect(result.role).toBe('Senior Engineer');
  });

  it('handles empty skills', () => {
    const profile = createMockCandidateProfile();
    profile.skills = [];

    const result = buildCandidateSemanticText(profile);
    expect(result.skills).toBe('');
    expect(result.full).not.toContain('Skills:');
  });

  it('handles missing location', () => {
    const profile = createMockCandidateProfile();
    profile.contact.city = null;
    profile.contact.state = null;
    profile.contact.country = null;

    const result = buildCandidateSemanticText(profile);
    expect(result.location).toBe('');
  });
});

describe('buildCandidateQdrantPayload', () => {
  it('builds payload with metadata', () => {
    const profile = createMockCandidateProfile();
    const metadata = {
      embeddingVersion: '1.0.0',
      profileVersion: '1.0',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      indexedAt: new Date().toISOString(),
    };

    const payload = buildCandidateQdrantPayload(profile, metadata);

    expect(payload.entityId).toBe('test-candidate-123');
    expect(payload.entityType).toBe('candidate');
    expect(payload.name).toBe('John Smith');
    expect(payload.headline).toBe('Senior Software Engineer');
    expect(payload.skills).toEqual(['TypeScript', 'React', 'Node.js']);
    expect(payload.location).toBe('San Francisco, CA, USA');
    expect(payload.experienceYears).toBe(3);
    expect(payload.embeddingVersion).toBe('1.0.0');
    expect(payload.provider).toBe('openai');
  });
});

describe('buildJobSemanticText', () => {
  it('builds semantic text from job profile', () => {
    const profile = createMockJobProfile();
    const result = buildJobSemanticText(profile);

    expect(result.title).toBe('Backend Developer');
    expect(result.skills).toBe('Python, PostgreSQL, Docker');
    expect(result.summary).toBe('We need a backend developer');
    expect(result.responsibilities).toBe('Design APIs; Write tests; Deploy to production');
    expect(result.experience).toBe('Minimum 5 years, Maximum 8 years');
    expect(result.location).toBe('Remote');
  });

  it('combines all parts into full text', () => {
    const profile = createMockJobProfile();
    const result = buildJobSemanticText(profile);

    expect(result.full).toContain('Title: Backend Developer');
    expect(result.full).toContain('Required Skills: Python, PostgreSQL, Docker');
    expect(result.full).toContain('Description:');
    expect(result.full).toContain('Responsibilities:');
    expect(result.full).toContain('Experience: Minimum 5 years, Maximum 8 years');
    expect(result.full).toContain('Location: Remote');
  });

  it('handles empty preferred skills', () => {
    const profile = createMockJobProfile();
    profile.preferredSkills = [];

    const result = buildJobSemanticText(profile);
    expect(result.skills).toBe('Python, PostgreSQL');
  });

  it('handles missing experience', () => {
    const profile = createMockJobProfile();
    profile.experience.minimumYears = null;
    profile.experience.maximumYears = null;

    const result = buildJobSemanticText(profile);
    expect(result.experience).toBe('');
  });
});

describe('buildJobQdrantPayload', () => {
  it('builds payload with metadata', () => {
    const profile = createMockJobProfile();
    const metadata = {
      embeddingVersion: '1.0.0',
      profileVersion: '1.0',
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      indexedAt: new Date().toISOString(),
    };

    const payload = buildJobQdrantPayload(profile, metadata);

    expect(payload.entityId).toBe('test-job-456');
    expect(payload.entityType).toBe('job');
    expect(payload.name).toBe('Backend Developer');
    expect(payload.headline).toBe('StartupInc');
    expect(payload.skills).toEqual(['Python', 'PostgreSQL', 'Docker']);
    expect(payload.location).toBe('Remote');
    expect(payload.experienceYears).toBe(8);
    expect(payload.industry).toBe('Technology');
    expect(payload.employmentType).toBe('full-time');
    expect(payload.seniority).toBe('senior');
  });
});
