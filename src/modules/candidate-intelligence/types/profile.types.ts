import type { SourceTracking, Confidence } from './common.types.js';

export interface PersonalInfo {
  name: SourceTracking;
  headline: SourceTracking | null;
  summary: string;
}

export interface ContactInfo {
  email: SourceTracking | null;
  phone: SourceTracking | null;
  linkedin: SourceTracking | null;
  github: SourceTracking | null;
  portfolio: SourceTracking | null;
  website: SourceTracking | null;
  city: SourceTracking | null;
  state: SourceTracking | null;
  country: SourceTracking | null;
}

export interface SkillEntry {
  canonical: string;
  raw: string;
  category: string;
  confidence: Confidence;
}

export interface ExperienceEntry {
  company: SourceTracking;
  title: SourceTracking;
  employmentType: SourceTracking | null;
  startDate: SourceTracking | null;
  endDate: SourceTracking | null;
  isCurrent: boolean;
  durationMonths: number;
  responsibilities: string[];
}

export interface EducationEntry {
  degree: SourceTracking;
  specialization: SourceTracking | null;
  university: SourceTracking;
  graduationYear: SourceTracking | null;
  educationLevel: SourceTracking | null;
}

export interface ProjectEntry {
  name: SourceTracking;
  description: SourceTracking | null;
  technologies: string[];
  url: SourceTracking | null;
}

export interface CertificationEntry {
  name: SourceTracking;
  issuer: SourceTracking | null;
  date: SourceTracking | null;
}

export interface LanguageEntry {
  name: SourceTracking;
  proficiency: SourceTracking | null;
}

export interface SocialLinks {
  linkedin: SourceTracking | null;
  github: SourceTracking | null;
  portfolio: SourceTracking | null;
  website: SourceTracking | null;
}

export interface TimelineEntry {
  type: 'experience' | 'education' | 'project';
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  title: string;
  organization: string;
}

export interface RawDocumentRef {
  referenceId: string;
  markdownLength: number;
  plainTextLength: number;
  sectionsCount: number;
}

export interface ProfileMetadata {
  resumeLanguage: string;
  pages: number;
  hasTables: boolean;
  hasImages: boolean;
  sectionCount: number;
  sourceFileName: string;
  sourceFileSize: number;
  mimeType: string;
}

export interface ProcessingContext {
  parser: string;
  parserVersion: string;
  pipelineVersion: string;
  processingTimeMs: number;
  processedAt: string;
  warnings: string[];
  errors: string[];
  extractorsRun: string[];
  normalizersRun: string[];
  resolversRun: string[];
}

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  isValid: boolean;
}

export interface CompletenessResult {
  score: number;
  missingFields: string[];
  presentFields: string[];
}

export interface CandidateProfile {
  schemaVersion: '1.0';
  candidateId: string;
  personal: PersonalInfo;
  contact: ContactInfo;
  skills: SkillEntry[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  socialLinks: SocialLinks;
  timeline: TimelineEntry[];
  rawDocument: RawDocumentRef;
  metadata: ProfileMetadata;
  processing: ProcessingContext;
  validation: ValidationResult;
  completeness: CompletenessResult;
}
