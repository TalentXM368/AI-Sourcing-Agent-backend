import { randomUUID } from 'crypto';
import type { StructuredDocument } from '../types/input.types.js';
import type {
  CandidateProfile,
  PersonalInfo,
  ContactInfo,
  SocialLinks,
  TimelineEntry,
  RawDocumentRef,
  ProfileMetadata,
  ProcessingContext,
  ValidationResult,
  CompletenessResult,
} from '../types/profile.types.js';
import type {
  MergedExtractionResult,
  ExtractedExperience,
  ExtractedEducation,
  ExtractedSkill,
  ExtractedProject,
  ExtractedCertification,
  ExtractedLanguage,
} from '../types/extracted.types.js';
import type { SourceTracking } from '../types/common.types.js';
import { PIPELINE_VERSION, PARSER_VERSION } from '../constants/index.js';
import {
  resolveConflict,
  resolveNameConflict,
  resolveEntityName,
} from '../resolvers/index.js';
import {
  normalizeDateString,
  calculateDurationMonths,
} from '../normalizers/index.js';
import { validateContact, validateTimeline, validateCompleteness } from '../validators/index.js';

function buildPersonalInfo(
  name: SourceTracking | null,
  headline: SourceTracking | null,
  summary: string,
): PersonalInfo {
  return {
    name: name || {
      raw: 'Unknown',
      value: 'Unknown',
      extractor: 'profile-builder',
      sourceSection: 'header',
      confidence: { score: 0, reasons: ['No name found'] },
    },
    headline,
    summary,
  };
}

function buildContactInfo(contact: MergedExtractionResult['contact']): ContactInfo {
  return {
    email: contact.email,
    phone: contact.phone,
    linkedin: contact.linkedin,
    github: contact.github,
    portfolio: contact.portfolio,
    website: contact.website,
    city: contact.city,
    state: contact.state,
    country: contact.country,
  };
}

function buildSocialLinks(contact: MergedExtractionResult['contact']): SocialLinks {
  return {
    linkedin: contact.linkedin,
    github: contact.github,
    portfolio: contact.portfolio,
    website: contact.website,
  };
}

function buildTimeline(
  experience: ExtractedExperience[],
  education: ExtractedEducation[],
  projects: ExtractedProject[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const exp of experience) {
    entries.push({
      type: 'experience',
      startDate: normalizeDateString(exp.startDateRaw),
      endDate: normalizeDateString(exp.endDateRaw),
      isCurrent: exp.isCurrent,
      title: exp.title,
      organization: resolveEntityName(exp.company),
    });
  }

  for (const edu of education) {
    entries.push({
      type: 'education',
      startDate: null,
      endDate: edu.graduationYearRaw ? normalizeDateString(edu.graduationYearRaw + '-01-01') : null,
      isCurrent: false,
      title: edu.degree,
      organization: edu.university,
    });
  }

  for (const proj of projects) {
    entries.push({
      type: 'project',
      startDate: null,
      endDate: null,
      isCurrent: false,
      title: proj.name,
      organization: '',
    });
  }

  // Sort by start date (most recent first)
  entries.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  });

  return entries;
}

function buildRawDocumentRef(doc: StructuredDocument): RawDocumentRef {
  return {
    referenceId: randomUUID(),
    markdownLength: doc.markdown.length,
    plainTextLength: doc.plainText.length,
    sectionsCount: doc.sections?.length || 0,
  };
}

function buildProfileMetadata(doc: StructuredDocument): ProfileMetadata {
  return {
    resumeLanguage: doc.metadata?.language || 'unknown',
    pages: doc.metadata?.pages || 0,
    hasTables: (doc.tables?.length || 0) > 0,
    hasImages: (doc.images?.length || 0) > 0,
    sectionCount: doc.sections?.length || 0,
    sourceFileName: doc.metadata?.fileName || 'unknown',
    sourceFileSize: doc.metadata?.fileSize || 0,
    mimeType: doc.metadata?.mimeType || 'unknown',
  };
}

function buildProcessingContext(
  startTime: number,
  warnings: string[],
  errors: string[],
  extractorsRun: string[],
  normalizersRun: string[],
  resolversRun: string[],
): ProcessingContext {
  return {
    parser: 'candidate-intelligence',
    parserVersion: PARSER_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    processingTimeMs: Date.now() - startTime,
    processedAt: new Date().toISOString(),
    warnings,
    errors,
    extractorsRun,
    normalizersRun,
    resolversRun,
  };
}

export function buildProfile(
  doc: StructuredDocument,
  extraction: MergedExtractionResult,
  startTime: number,
  warnings: string[],
  errors: string[],
  extractorsRun: string[],
  normalizersRun: string[],
  resolversRun: string[],
): CandidateProfile {
  const personal = buildPersonalInfo(extraction.name, extraction.headline, extraction.summary);
  const contact = buildContactInfo(extraction.contact);
  const socialLinks = buildSocialLinks(extraction.contact);
  const timeline = buildTimeline(extraction.experience, extraction.education, extraction.projects);
  const rawDocument = buildRawDocumentRef(doc);
  const metadata = buildProfileMetadata(doc);
  const processing = buildProcessingContext(startTime, warnings, errors, extractorsRun, normalizersRun, resolversRun);

  // Run validators
  const contactWarnings = validateContact(contact);
  const timelineWarnings = validateTimeline(extraction.experience, extraction.education);

  const validation: ValidationResult = {
    warnings: [...contactWarnings, ...timelineWarnings],
    isValid: contactWarnings.filter(w => w.severity === 'error').length === 0,
  };

  // Build profile for completeness check
  const profile: CandidateProfile = {
    schemaVersion: '1.0',
    candidateId: randomUUID(),
    personal,
    contact,
    skills: extraction.skills.map(s => ({
      canonical: s.normalized,
      raw: s.raw,
      category: s.category,
      confidence: s.confidence,
    })),
    experience: extraction.experience.map(exp => ({
      company: {
        raw: exp.company,
        value: resolveEntityName(exp.company),
        extractor: 'experience',
        sourceSection: exp.sourceSection,
        confidence: exp.confidence,
      },
      title: {
        raw: exp.title,
        value: exp.title,
        extractor: 'experience',
        sourceSection: exp.sourceSection,
        confidence: exp.confidence,
      },
      employmentType: exp.employmentType ? {
        raw: exp.employmentType,
        value: exp.employmentType,
        extractor: 'experience',
        sourceSection: exp.sourceSection,
        confidence: exp.confidence,
      } : null,
      startDate: exp.startDateRaw ? {
        raw: exp.startDateRaw,
        value: normalizeDateString(exp.startDateRaw) || exp.startDateRaw,
        extractor: 'date-normalizer',
        sourceSection: exp.sourceSection,
        confidence: exp.confidence,
      } : null,
      endDate: exp.endDateRaw ? {
        raw: exp.endDateRaw,
        value: normalizeDateString(exp.endDateRaw) || exp.endDateRaw,
        extractor: 'date-normalizer',
        sourceSection: exp.sourceSection,
        confidence: exp.confidence,
      } : null,
      isCurrent: exp.isCurrent,
      durationMonths: calculateDurationMonths(exp.startDateRaw, exp.endDateRaw),
      responsibilities: exp.responsibilities,
    })),
    education: extraction.education.map(edu => ({
      degree: {
        raw: edu.degree,
        value: edu.degree,
        extractor: 'education',
        sourceSection: edu.sourceSection,
        confidence: edu.confidence,
      },
      specialization: edu.specialization ? {
        raw: edu.specialization,
        value: edu.specialization,
        extractor: 'education',
        sourceSection: edu.sourceSection,
        confidence: edu.confidence,
      } : null,
      university: {
        raw: edu.university,
        value: edu.university,
        extractor: 'education',
        sourceSection: edu.sourceSection,
        confidence: edu.confidence,
      },
      graduationYear: edu.graduationYearRaw ? {
        raw: edu.graduationYearRaw,
        value: edu.graduationYearRaw,
        extractor: 'education',
        sourceSection: edu.sourceSection,
        confidence: edu.confidence,
      } : null,
      educationLevel: null,
    })),
    projects: extraction.projects.map(proj => ({
      name: {
        raw: proj.name,
        value: proj.name,
        extractor: 'projects',
        sourceSection: proj.sourceSection,
        confidence: proj.confidence,
      },
      description: proj.description ? {
        raw: proj.description,
        value: proj.description,
        extractor: 'projects',
        sourceSection: proj.sourceSection,
        confidence: proj.confidence,
      } : null,
      technologies: proj.technologies,
      url: proj.url ? {
        raw: proj.url,
        value: proj.url,
        extractor: 'projects',
        sourceSection: proj.sourceSection,
        confidence: proj.confidence,
      } : null,
    })),
    certifications: extraction.certifications.map(cert => ({
      name: {
        raw: cert.name,
        value: cert.name,
        extractor: 'certifications',
        sourceSection: cert.sourceSection,
        confidence: cert.confidence,
      },
      issuer: cert.issuer ? {
        raw: cert.issuer,
        value: cert.issuer,
        extractor: 'certifications',
        sourceSection: cert.sourceSection,
        confidence: cert.confidence,
      } : null,
      date: cert.dateRaw ? {
        raw: cert.dateRaw,
        value: cert.dateRaw,
        extractor: 'certifications',
        sourceSection: cert.sourceSection,
        confidence: cert.confidence,
      } : null,
    })),
    languages: extraction.languages.map(lang => ({
      name: {
        raw: lang.name,
        value: lang.name,
        extractor: 'languages',
        sourceSection: lang.sourceSection,
        confidence: lang.confidence,
      },
      proficiency: lang.proficiency ? {
        raw: lang.proficiency,
        value: lang.proficiency,
        extractor: 'languages',
        sourceSection: lang.sourceSection,
        confidence: lang.confidence,
      } : null,
    })),
    socialLinks,
    timeline,
    rawDocument,
    metadata,
    processing,
    validation,
    completeness: { score: 0, missingFields: [], presentFields: [] },
  };

  // Calculate completeness
  profile.completeness = validateCompleteness(profile);

  return profile;
}
