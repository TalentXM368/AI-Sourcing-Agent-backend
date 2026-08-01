import type { ResolvedField } from '../interfaces/index.js';

export interface LowConfidenceField {
  fieldName: string;
  currentValue: string;
  confidence: number;
  candidateValues: string[];
  reason: string;
}

export interface QualityScore {
  overall: number;
  fieldConfidence: number;
  conflictCount: number;
  resolvedCount: number;
  missingFields: string[];
  validationWarningCount: number;
}

export interface ResolvedPersonalInfo {
  name: ResolvedField<string>;
  headline: ResolvedField<string> | null;
  summary: string;
}

export interface ResolvedContactInfo {
  email: ResolvedField<string> | null;
  phone: ResolvedField<string> | null;
  linkedin: ResolvedField<string> | null;
  github: ResolvedField<string> | null;
  portfolio: ResolvedField<string> | null;
  website: ResolvedField<string> | null;
  city: ResolvedField<string> | null;
  state: ResolvedField<string> | null;
  country: ResolvedField<string> | null;
}

export interface ResolvedExperienceEntry {
  company: ResolvedField<string>;
  title: ResolvedField<string>;
  employmentType: ResolvedField<string> | null;
  startDate: ResolvedField<string> | null;
  endDate: ResolvedField<string> | null;
  isCurrent: boolean;
  durationMonths: number;
  responsibilities: string[];
}

export interface ResolvedEducationEntry {
  degree: ResolvedField<string>;
  specialization: ResolvedField<string> | null;
  university: ResolvedField<string>;
  graduationYear: ResolvedField<string> | null;
  educationLevel: ResolvedField<string> | null;
}

export interface ResolvedProjectEntry {
  name: ResolvedField<string>;
  description: ResolvedField<string> | null;
  technologies: string[];
  url: ResolvedField<string> | null;
}

export interface ResolvedCertificationEntry {
  name: ResolvedField<string>;
  issuer: ResolvedField<string> | null;
  date: ResolvedField<string> | null;
}

export interface ResolvedLanguageEntry {
  name: ResolvedField<string>;
  proficiency: ResolvedField<string> | null;
}

export interface ResolutionMetadata {
  resolvedAt: string;
  resolutionTimeMs: number;
  fieldsProcessed: number;
  fieldsResolved: number;
  fieldsWithConflict: number;
}

export interface ResolvedCandidateProfile {
  candidateId: string;
  personal: ResolvedPersonalInfo;
  contact: ResolvedContactInfo;
  skills: ResolvedField<string>[];
  experience: ResolvedExperienceEntry[];
  education: ResolvedEducationEntry[];
  projects: ResolvedProjectEntry[];
  certifications: ResolvedCertificationEntry[];
  languages: ResolvedLanguageEntry[];
  lowConfidenceFields: LowConfidenceField[];
  qualityScore: QualityScore;
  resolutionMetadata: ResolutionMetadata;
}
