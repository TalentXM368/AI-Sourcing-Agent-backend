import type { SourceTracking } from './common.types.js';

export interface ExtractedJobMetadata {
  title: SourceTracking | null;
  company: SourceTracking | null;
  department: SourceTracking | null;
}

export interface ExtractedJobSkills {
  requiredSkills: Array<{
    canonical: string;
    raw: string;
    category: string;
    confidence: number;
  }>;
  preferredSkills: Array<{
    canonical: string;
    raw: string;
    category: string;
    confidence: number;
  }>;
  technologies: string[];
  tools: string[];
}

export interface ExtractedJobExperience {
  minimumYears: SourceTracking | null;
  maximumYears: SourceTracking | null;
  preferredYears: SourceTracking | null;
}

export interface ExtractedJobEducation {
  degree: SourceTracking | null;
  specialization: SourceTracking | null;
  educationLevel: SourceTracking | null;
}

export interface ExtractedJobCompensation {
  salaryCurrency: SourceTracking | null;
  salaryMinimum: SourceTracking | null;
  salaryMaximum: SourceTracking | null;
  salaryPeriod: SourceTracking | null;
  salaryRaw: SourceTracking | null;
  benefits: string[];
}

export interface ExtractedJobLocation {
  city: SourceTracking | null;
  state: SourceTracking | null;
  country: SourceTracking | null;
  raw: SourceTracking | null;
  workMode: SourceTracking | null;
}

export interface ExtractedJobClassification {
  employmentType: SourceTracking | null;
  workMode: SourceTracking | null;
  industry: SourceTracking | null;
  domain: SourceTracking | null;
  seniority: SourceTracking | null;
  workAuthorization: SourceTracking | null;
  visaSponsorship: SourceTracking | null;
  travelRequirements: SourceTracking | null;
  shift: SourceTracking | null;
}

export interface ExtractedJobContent {
  summary: SourceTracking | null;
  responsibilities: string[];
  certifications: string[];
  languages: string[];
}

export interface MergedJobExtractionResult {
  metadata: ExtractedJobMetadata;
  skills: ExtractedJobSkills;
  experience: ExtractedJobExperience;
  education: ExtractedJobEducation;
  compensation: ExtractedJobCompensation;
  location: ExtractedJobLocation;
  classification: ExtractedJobClassification;
  content: ExtractedJobContent;
}
