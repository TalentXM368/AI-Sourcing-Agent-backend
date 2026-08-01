import { describe, it, expect } from 'vitest';
import { buildReasoning } from '../../services/reasoning-builder.js';
import type { ShortlistedCandidate } from '../../types/input.types.js';
import type { JobProfile } from '../../../job-intelligence/types/profile.types.js';

function createMockCandidate(overrides?: Partial<ShortlistedCandidate>): ShortlistedCandidate {
  return {
    candidateProfile: {
      schemaVersion: '1.0',
      candidateId: 'test-candidate-1',
      personal: {
        name: { raw: 'John Doe', value: 'John Doe', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
        headline: { raw: 'Senior Engineer', value: 'Senior Engineer', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
        summary: 'Experienced engineer with 6 years in backend development.',
      },
      contact: {
        email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null,
        city: { raw: 'Pune', value: 'Pune', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
        state: null,
        country: { raw: 'India', value: 'India', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
      },
      skills: [
        { canonical: 'Python', raw: 'Python', category: 'programming', confidence: { score: 0.9, reasons: [] } },
        { canonical: 'FastAPI', raw: 'FastAPI', category: 'framework', confidence: { score: 0.9, reasons: [] } },
      ],
      experience: [
        {
          company: { raw: 'TechCorp', value: 'TechCorp', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
          title: { raw: 'Senior Engineer', value: 'Senior Engineer', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
          employmentType: null, startDate: null, endDate: null, isCurrent: true,
          durationMonths: 72, responsibilities: ['Led backend team'],
        },
      ],
      education: [
        {
          degree: { raw: 'Bachelor', value: 'Bachelor', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
          specialization: { raw: 'CS', value: 'CS', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
          university: { raw: 'MIT', value: 'MIT', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
          graduationYear: null, educationLevel: null,
        },
      ],
      projects: [], certifications: [], languages: [], socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
      timeline: [], rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
      metadata: { resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false, sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '' },
      processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
      validation: { warnings: [], isValid: true },
      completeness: { score: 0.8, missingFields: [], presentFields: [] },
    },
    matchScore: 85,
    semanticScore: 0.88,
    skillScore: 90,
    experienceScore: 80,
    educationScore: 85,
    locationScore: 100,
    industryScore: 75,
    employmentScore: 100,
    salaryScore: 50,
    matchedSkills: ['Python', 'FastAPI'],
    missingSkills: ['Kubernetes'],
    additionalSkills: ['Django'],
    hardFilterPassed: true,
    confidence: 0.85,
    ...overrides,
  };
}

function createMockJobProfile(): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: 'test-job-1',
    title: { raw: 'Senior Backend Engineer', value: 'Senior Backend Engineer', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    summary: { raw: 'Looking for a senior backend engineer', value: 'Looking for a senior backend engineer', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    company: { raw: 'TechCorp', value: 'TechCorp', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    industry: { raw: 'Technology', value: 'Technology', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    domain: null, department: null,
    employmentType: { raw: 'full-time', value: 'full-time', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    workMode: { raw: 'hybrid', value: 'hybrid', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    seniority: { raw: 'senior', value: 'senior', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
    experience: {
      minimumYears: { raw: '5', value: '5', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } },
      maximumYears: null, preferredYears: null,
    },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: null, state: null, country: { raw: 'India', value: 'India', extractor: 'test', sourceSection: 'test', confidence: { score: 0.9, reasons: [] } }, raw: null },
    requiredSkills: [
      { canonical: 'Python', raw: 'Python', category: 'programming', confidence: 0.9 },
      { canonical: 'FastAPI', raw: 'FastAPI', category: 'framework', confidence: 0.9 },
      { canonical: 'Kubernetes', raw: 'Kubernetes', category: 'devops', confidence: 0.9 },
    ],
    preferredSkills: [
      { canonical: 'AWS', raw: 'AWS', category: 'cloud', confidence: 0.7 },
    ],
    certifications: [], languages: [], responsibilities: [], benefits: [], technologies: [], tools: [],
    workAuthorization: null, visaSponsorship: null, travelRequirements: null, shift: null,
    metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
    processing: { pipelineVersion: '1.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.8, completeness: 0.7, fieldConfidence: 0.8, missingFields: [], suggestions: [] },
  };
}

describe('reasoning-builder', () => {
  it('should build reasoning from candidate data and AI insights', () => {
    const candidate = createMockCandidate();
    const jobProfile = createMockJobProfile();

    const reasoning = buildReasoning(candidate, jobProfile, 90, {
      explanation: 'Strong Python and FastAPI experience with healthcare background.',
      summary: 'Senior engineer with 6 years of relevant experience.',
      whyStandsOut: ['Strong Python skills', 'Healthcare domain experience'],
      risks: ['Missing Kubernetes skill'],
      careerStability: 'Stable career progression',
      careerProgression: 'Clear growth from mid to senior',
      domainExpertise: 'Healthcare technology',
      leadershipIndicators: 'Led backend team',
      interviewFocus: ['Kubernetes knowledge', 'System design'],
      learningCurve: 'Quick learner based on past transitions',
      teamFit: 'Strong collaborative skills',
      availability: '2 week notice period',
      salaryFit: 'Within budget range',
    });

    expect(reasoning.recommendation).toBe('Good Hire');
    expect(reasoning.matchedSkills).toBe(2);
    expect(reasoning.requiredSkills).toBe(3);
    expect(reasoning.experience).toContain('6.0 years');
    expect(reasoning.education).toBe('Bachelor in CS');
    expect(reasoning.industry).toBe('Technology');
    expect(reasoning.location).toBe('Pune, India');
    expect(reasoning.whyCandidateStandsOut).toHaveLength(2);
    expect(reasoning.potentialRisks).toHaveLength(1);
    expect(reasoning.suggestedInterviewFocus).toHaveLength(2);
  });

  it('should handle candidate with no education', () => {
    const candidate = createMockCandidate({
      candidateProfile: {
        ...createMockCandidate().candidateProfile,
        education: [],
      },
    });
    const jobProfile = createMockJobProfile();

    const reasoning = buildReasoning(candidate, jobProfile, 70, {
      explanation: 'Good match but no formal education listed.',
      summary: 'Experienced engineer without formal degree.',
      whyStandsOut: ['Strong practical experience'],
      risks: ['No formal education'],
      careerStability: 'Stable',
      careerProgression: 'Good',
      domainExpertise: 'Technology',
      leadershipIndicators: 'None',
      interviewFocus: ['Technical skills'],
      learningCurve: 'Average',
      teamFit: 'Good',
      availability: 'Immediate',
      salaryFit: 'Within range',
    });

    expect(reasoning.education).toBe('Not specified');
  });
});
