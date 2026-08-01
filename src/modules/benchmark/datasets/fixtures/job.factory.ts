import type { JobProfile } from '../../../job-intelligence/types/profile.types.js';

function sf(value: string, confidence = 0.9) {
  return {
    raw: value,
    value,
    extractor: 'benchmark',
    sourceSection: 'benchmark',
    confidence: { score: confidence, reasons: [] },
  };
}

export function createJobProfile(overrides: Partial<JobProfile> = {}): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: overrides.jobId || 'bench-job-001',
    title: sf('Senior Backend Engineer'),
    summary: sf('Looking for a senior backend engineer with Python and cloud experience.'),
    company: sf('TechCorp'),
    industry: sf('Technology'),
    domain: null,
    department: null,
    employmentType: sf('full-time'),
    workMode: sf('hybrid'),
    seniority: sf('senior'),
    experience: {
      minimumYears: sf('5'),
      maximumYears: sf('10'),
      preferredYears: sf('7'),
    },
    education: {
      degree: sf('Bachelor'),
      specialization: sf('Computer Science'),
      educationLevel: sf('bachelors'),
    },
    salary: {
      currency: sf('USD'),
      minimum: sf('120000'),
      maximum: sf('180000'),
      period: sf('yearly'),
      raw: sf('$120,000 - $180,000 per year'),
    },
    location: {
      city: sf('San Francisco'),
      state: sf('California'),
      country: sf('USA'),
      raw: sf('San Francisco, CA (Hybrid)'),
    },
    requiredSkills: overrides.requiredSkills || [
      { canonical: 'Python', raw: 'Python', category: 'programming', confidence: 0.95 },
      { canonical: 'FastAPI', raw: 'FastAPI', category: 'framework', confidence: 0.9 },
      { canonical: 'PostgreSQL', raw: 'PostgreSQL', category: 'database', confidence: 0.85 },
      { canonical: 'AWS', raw: 'AWS', category: 'cloud', confidence: 0.8 },
      { canonical: 'Docker', raw: 'Docker', category: 'devops', confidence: 0.75 },
    ],
    preferredSkills: overrides.preferredSkills || [
      { canonical: 'Kubernetes', raw: 'Kubernetes', category: 'devops', confidence: 0.7 },
      { canonical: 'Redis', raw: 'Redis', category: 'database', confidence: 0.65 },
      { canonical: 'GraphQL', raw: 'GraphQL', category: 'api', confidence: 0.6 },
    ],
    certifications: [],
    languages: [],
    responsibilities: ['Design and build backend services', 'Mentor junior engineers'],
    benefits: ['Health insurance', '401k', 'Stock options'],
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'AWS'],
    tools: ['Git', 'Docker', 'Jenkins'],
    workAuthorization: null,
    visaSponsorship: null,
    travelRequirements: null,
    shift: null,
    metadata: {
      sourceFileName: 'benchmark-job.pdf',
      sourceFileSize: 20000,
      mimeType: 'application/pdf',
      pages: 1,
      hasTables: false,
      sectionCount: 4,
    },
    processing: {
      pipelineVersion: '1.0',
      processingTimeMs: 0,
      processedAt: new Date().toISOString(),
      warnings: [],
      errors: [],
      extractorsRun: [],
      normalizersRun: [],
    },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.85, completeness: 0.8, fieldConfidence: 0.85, missingFields: [], suggestions: [] },
  };
}
