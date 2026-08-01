import type { SourceTracking, Confidence } from './common.types.js';

export interface ExtractedContact {
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

export interface ExtractedSkill {
  raw: string;
  normalized: string;
  category: string;
  sourceSection: string;
  confidence: Confidence;
}

export interface ExtractedExperience {
  company: string;
  title: string;
  employmentType: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  isCurrent: boolean;
  responsibilities: string[];
  sourceSection: string;
  confidence: Confidence;
}

export interface ExtractedEducation {
  degree: string;
  specialization: string | null;
  university: string;
  graduationYearRaw: string | null;
  sourceSection: string;
  confidence: Confidence;
}

export interface ExtractedProject {
  name: string;
  description: string | null;
  technologies: string[];
  url: string | null;
  sourceSection: string;
  confidence: Confidence;
}

export interface ExtractedCertification {
  name: string;
  issuer: string | null;
  dateRaw: string | null;
  sourceSection: string;
  confidence: Confidence;
}

export interface ExtractedLanguage {
  name: string;
  proficiency: string | null;
  sourceSection: string;
  confidence: Confidence;
}

export interface MergedExtractionResult {
  name: SourceTracking | null;
  headline: SourceTracking | null;
  summary: string;
  contact: ExtractedContact;
  skills: ExtractedSkill[];
  experience: ExtractedExperience[];
  education: ExtractedEducation[];
  projects: ExtractedProject[];
  certifications: ExtractedCertification[];
  languages: ExtractedLanguage[];
}
