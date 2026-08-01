import { randomUUID } from 'crypto';
import type {
  JobProfile,
  JobMetadata,
  JobProcessingContext,
  JobValidationResult,
  JobQualityScore,
} from '../types/index.js';
import type { SourceTracking, MergedJobExtractionResult } from '../types/index.js';
import type { StructuredDocument, ProcessedSection } from '../types/index.js';
import { st } from '../utils/index.js';
import { detectSeniorityFromTitle } from '../normalizers/index.js';
import { validateJobWarnings } from '../validators/index.js';
import { computeJobQualityScore } from '../validators/index.js';

export function buildJobProfile(
  jobId: string,
  doc: StructuredDocument,
  sections: ProcessedSection[],
  extraction: MergedJobExtractionResult,
  processingTimeMs: number,
): JobProfile {
  const startTime = Date.now();

  const metadata = buildMetadata(doc);
  const processing = buildProcessingContext(processingTimeMs, extraction);
  const title = extraction.metadata.title || st('Unknown Role', 'builder', 'fallback', 0.0);
  const company = extraction.metadata.company || st('Unknown Company', 'builder', 'fallback', 0.0);

  const seniorityRaw = detectSeniorityFromTitle(title.value);
  const seniority = seniorityRaw
    ? st(seniorityRaw, 'normalizer', 'title', 0.8)
    : st('mid', 'builder', 'fallback', 0.3);

  const workMode = extraction.location.workMode || st('onsite', 'builder', 'fallback', 0.3);

  const profile: JobProfile = {
    schemaVersion: '1.0',
    jobId,

    title,
    summary: extraction.content.summary || st('', 'builder', 'fallback', 0.0),
    company,
    industry: extraction.classification.industry || st('Other', 'builder', 'fallback', 0.1),
    domain: extraction.classification.domain,
    department: extraction.metadata.department,

    employmentType: extraction.classification.employmentType || st('full-time', 'builder', 'fallback', 0.3),
    workMode,
    seniority,

    experience: extraction.experience,
    education: extraction.education,
    salary: {
      currency: extraction.compensation.salaryCurrency,
      minimum: extraction.compensation.salaryMinimum,
      maximum: extraction.compensation.salaryMaximum,
      period: extraction.compensation.salaryPeriod,
      raw: extraction.compensation.salaryRaw,
    },
    location: {
      city: extraction.location.city,
      state: extraction.location.state,
      country: extraction.location.country,
      raw: extraction.location.raw,
    },

    requiredSkills: extraction.skills.requiredSkills,
    preferredSkills: extraction.skills.preferredSkills,
    certifications: extraction.content.certifications,
    languages: extraction.content.languages,

    responsibilities: extraction.content.responsibilities,
    benefits: extraction.compensation.benefits,
    technologies: extraction.skills.technologies,
    tools: extraction.skills.tools,

    workAuthorization: extraction.classification.workAuthorization,
    visaSponsorship: extraction.classification.visaSponsorship,
    travelRequirements: extraction.classification.travelRequirements,
    shift: extraction.classification.shift,

    metadata,
    processing,
    validation: { warnings: [], isValid: true },
    quality: { overall: 0, completeness: 0, fieldConfidence: 0, missingFields: [], suggestions: [] },
  };

  profile.validation = runValidation(profile);
  profile.quality = computeJobQualityScore(profile);

  return profile;
}

function buildMetadata(doc: StructuredDocument): JobMetadata {
  return {
    sourceFileName: doc.metadata?.fileName || null,
    sourceFileSize: doc.metadata?.fileSize || null,
    mimeType: doc.metadata?.mimeType || null,
    pages: doc.metadata?.pages || null,
    hasTables: (doc.tables?.length || 0) > 0,
    sectionCount: doc.sections?.length || 0,
  };
}

function buildProcessingContext(
  processingTimeMs: number,
  extraction: MergedJobExtractionResult,
): JobProcessingContext {
  return {
    pipelineVersion: '3.0.0',
    processingTimeMs,
    processedAt: new Date().toISOString(),
    warnings: [],
    errors: [],
    extractorsRun: [
      'metadata', 'skills', 'experience', 'education',
      'compensation', 'location', 'classification', 'content',
    ],
    normalizersRun: ['seniority', 'salary', 'employment', 'industry'],
  };
}

function runValidation(profile: JobProfile): JobValidationResult {
  const warnings = validateJobWarnings(profile);
  return {
    warnings,
    isValid: warnings.filter(w => w.severity === 'error').length === 0,
  };
}
