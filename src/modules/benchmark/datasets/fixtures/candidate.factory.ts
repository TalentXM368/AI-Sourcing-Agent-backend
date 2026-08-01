import type { CandidateProfile } from '../../../candidate-intelligence/types/profile.types.js';

function sf(value: string, confidence = 0.9) {
  return {
    raw: value,
    value,
    extractor: 'benchmark',
    sourceSection: 'benchmark',
    confidence: { score: confidence, reasons: [] },
  };
}

export function createCandidateProfile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: overrides.candidateId || 'bench-candidate-001',
    personal: {
      name: sf('John Doe'),
      headline: sf('Senior Software Engineer'),
      summary: 'Experienced software engineer with 6 years in backend development.',
      ...overrides.personal,
    },
    contact: {
      email: sf('john.doe@example.com'),
      phone: sf('+1-555-0100'),
      linkedin: null,
      github: null,
      portfolio: null,
      website: null,
      city: sf('San Francisco'),
      state: sf('California'),
      country: sf('USA'),
      ...overrides.contact,
    },
    skills: overrides.skills || [
      { canonical: 'Python', raw: 'Python', category: 'programming', confidence: { score: 0.95, reasons: [] } },
      { canonical: 'TypeScript', raw: 'TypeScript', category: 'programming', confidence: { score: 0.9, reasons: [] } },
      { canonical: 'React', raw: 'React', category: 'framework', confidence: { score: 0.85, reasons: [] } },
      { canonical: 'Node.js', raw: 'Node.js', category: 'runtime', confidence: { score: 0.9, reasons: [] } },
      { canonical: 'PostgreSQL', raw: 'PostgreSQL', category: 'database', confidence: { score: 0.8, reasons: [] } },
    ],
    experience: overrides.experience || [
      {
        company: sf('TechCorp'),
        title: sf('Senior Software Engineer'),
        employmentType: sf('full-time'),
        startDate: sf('2020-01'),
        endDate: null,
        isCurrent: true,
        durationMonths: 60,
        responsibilities: ['Led backend team', 'Designed microservices architecture'],
      },
      {
        company: sf('StartupInc'),
        title: sf('Software Engineer'),
        employmentType: sf('full-time'),
        startDate: sf('2017-06'),
        endDate: sf('2019-12'),
        isCurrent: false,
        durationMonths: 30,
        responsibilities: ['Built REST APIs', 'Implemented CI/CD pipelines'],
      },
    ],
    education: overrides.education || [
      {
        degree: sf('Bachelor'),
        specialization: sf('Computer Science'),
        university: sf('MIT'),
        graduationYear: sf('2017'),
        educationLevel: sf('bachelors'),
      },
    ],
    projects: [],
    certifications: [],
    languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: '', markdownLength: 500, plainTextLength: 400, sectionsCount: 5 },
    metadata: {
      resumeLanguage: 'en',
      pages: 2,
      hasTables: false,
      hasImages: false,
      sectionCount: 5,
      sourceFileName: 'benchmark-resume.pdf',
      sourceFileSize: 50000,
      mimeType: 'application/pdf',
    },
    processing: {
      parser: 'benchmark',
      parserVersion: '1.0',
      pipelineVersion: '1.0',
      processingTimeMs: 0,
      processedAt: new Date().toISOString(),
      warnings: [],
      errors: [],
      extractorsRun: [],
      normalizersRun: [],
      resolversRun: [],
    },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.85, missingFields: [], presentFields: ['name', 'email', 'skills', 'experience', 'education'] },
  };
}
