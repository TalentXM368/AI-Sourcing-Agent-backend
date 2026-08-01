import type { SourceTracking, Confidence } from './common.types.js';

export interface JobSkillEntry {
  canonical: string;
  raw: string;
  category: string;
  confidence: number;
}

export interface JobExperienceRequirement {
  minimumYears: SourceTracking | null;
  maximumYears: SourceTracking | null;
  preferredYears: SourceTracking | null;
}

export interface JobEducationRequirement {
  degree: SourceTracking | null;
  specialization: SourceTracking | null;
  educationLevel: SourceTracking | null;
}

export interface JobSalary {
  currency: SourceTracking | null;
  minimum: SourceTracking | null;
  maximum: SourceTracking | null;
  period: SourceTracking | null;
  raw: SourceTracking | null;
}

export interface JobLocation {
  city: SourceTracking | null;
  state: SourceTracking | null;
  country: SourceTracking | null;
  raw: SourceTracking | null;
}

export interface JobMetadata {
  sourceFileName: string | null;
  sourceFileSize: number | null;
  mimeType: string | null;
  pages: number | null;
  hasTables: boolean;
  sectionCount: number;
}

export interface JobProcessingContext {
  pipelineVersion: string;
  processingTimeMs: number;
  processedAt: string;
  warnings: string[];
  errors: string[];
  extractorsRun: string[];
  normalizersRun: string[];
}

export interface JobValidationWarning {
  field: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface JobValidationResult {
  warnings: JobValidationWarning[];
  isValid: boolean;
}

export interface JobQualityScore {
  overall: number;
  completeness: number;
  fieldConfidence: number;
  missingFields: string[];
  suggestions: string[];
}

export interface JobProfile {
  schemaVersion: '1.0';
  jobId: string;

  title: SourceTracking;
  summary: SourceTracking;
  company: SourceTracking;
  industry: SourceTracking;
  domain: SourceTracking | null;
  department: SourceTracking | null;

  employmentType: SourceTracking;
  workMode: SourceTracking;
  seniority: SourceTracking;

  experience: JobExperienceRequirement;
  education: JobEducationRequirement;
  salary: JobSalary;
  location: JobLocation;

  requiredSkills: JobSkillEntry[];
  preferredSkills: JobSkillEntry[];
  certifications: string[];
  languages: string[];

  responsibilities: string[];
  benefits: string[];
  technologies: string[];
  tools: string[];

  workAuthorization: SourceTracking | null;
  visaSponsorship: SourceTracking | null;
  travelRequirements: SourceTracking | null;
  shift: SourceTracking | null;

  metadata: JobMetadata;
  processing: JobProcessingContext;
  validation: JobValidationResult;
  quality: JobQualityScore;
}
