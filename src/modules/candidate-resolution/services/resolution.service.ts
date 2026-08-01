import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { SourceTracking } from '../../candidate-intelligence/types/common.types.js';
import type {
  ResolvedCandidateProfile,
  ResolvedPersonalInfo,
  ResolvedContactInfo,
  ResolvedExperienceEntry,
  ResolvedEducationEntry,
  ResolvedProjectEntry,
  ResolvedCertificationEntry,
  ResolvedLanguageEntry,
  LowConfidenceField,
  QualityScore,
  ResolutionMetadata,
} from '../types/index.js';
import type { FieldCandidate, ResolvedField } from '../interfaces/index.js';
import { KnowledgeService } from '../knowledge/index.js';
import { NormalizationService } from './normalization.service.js';
import { getSourcePriority } from '../engines/source-priority.engine.js';
import { runConsensus } from '../engines/consensus.engine.js';
import { computeConfidence } from '../engines/confidence.engine.js';
import { getConfidenceLevel } from '../constants/index.js';
import {
  NameResolver,
  EmailResolver,
  PhoneResolver,
  LinkedinResolver,
  CompanyResolver,
  JobTitleResolver,
  SkillResolver,
  LocationResolver,
} from '../resolvers/index.js';
import { validateDuplicates } from '../validators/duplicate.validator.js';
import { validateTimeline } from '../validators/timeline.validator.js';
import { computeQualityScore } from '../validators/quality.validator.js';

export class ResolutionService {
  private knowledge: KnowledgeService;
  private normalization: NormalizationService;
  private nameResolver: NameResolver;
  private emailResolver: EmailResolver;
  private phoneResolver: PhoneResolver;
  private linkedinResolver: LinkedinResolver;
  private companyResolver: CompanyResolver;
  private jobTitleResolver: JobTitleResolver;
  private skillResolver: SkillResolver;
  private locationResolver: LocationResolver;

  constructor() {
    this.knowledge = new KnowledgeService();
    this.normalization = new NormalizationService(this.knowledge);
    this.nameResolver = new NameResolver(this.knowledge);
    this.emailResolver = new EmailResolver(this.knowledge);
    this.phoneResolver = new PhoneResolver(this.knowledge);
    this.linkedinResolver = new LinkedinResolver(this.knowledge);
    this.companyResolver = new CompanyResolver(this.knowledge);
    this.jobTitleResolver = new JobTitleResolver(this.knowledge);
    this.skillResolver = new SkillResolver(this.knowledge);
    this.locationResolver = new LocationResolver(this.knowledge);
  }

  async resolve(profile: CandidateProfile): Promise<ResolvedCandidateProfile> {
    const startTime = Date.now();
    const lowConfidence: LowConfidenceField[] = [];

    // Resolve personal info
    const personal = this.resolvePersonal(profile, lowConfidence);

    // Resolve contact
    const contact = this.resolveContact(profile, lowConfidence);

    // Resolve skills
    const skills = this.resolveSkills(profile, lowConfidence);

    // Resolve experience
    const experience = this.resolveExperience(profile, lowConfidence);

    // Resolve education
    const education = this.resolveEducation(profile, lowConfidence);

    // Resolve projects
    const projects = this.resolveProjects(profile, lowConfidence);

    // Resolve certifications
    const certifications = this.resolveCertifications(profile, lowConfidence);

    // Resolve languages
    const languages = this.resolveLanguages(profile, lowConfidence);

    // Build profile
    const resolved: ResolvedCandidateProfile = {
      candidateId: profile.candidateId,
      personal,
      contact,
      skills,
      experience,
      education,
      projects,
      certifications,
      languages,
      lowConfidenceFields: lowConfidence,
      qualityScore: { overall: 0, fieldConfidence: 0, conflictCount: 0, resolvedCount: 0, missingFields: [], validationWarningCount: 0 },
      resolutionMetadata: {
        resolvedAt: new Date().toISOString(),
        resolutionTimeMs: Date.now() - startTime,
        fieldsProcessed: 0,
        fieldsResolved: 0,
        fieldsWithConflict: 0,
      },
    };

    // Run validators
    const duplicateWarnings = validateDuplicates(resolved);
    const timelineWarnings = validateTimeline(resolved);
    resolved.qualityScore = computeQualityScore(resolved);

    // Update metadata
    resolved.resolutionMetadata.fieldsProcessed = resolved.qualityScore.resolvedCount;
    resolved.resolutionMetadata.fieldsResolved = resolved.qualityScore.resolvedCount;
    resolved.resolutionMetadata.fieldsWithConflict = resolved.qualityScore.conflictCount;

    return resolved;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveField<T>(
    fieldName: string,
    value: T | null | undefined,
    source: string,
    sourceSection: string,
    confidence: number,
    resolver: { normalize(v: any): any; validate(v: any): { isValid: boolean; warnings: string[] } },
    lowConfidence: LowConfidenceField[],
  ): ResolvedField<T> | null {
    if (value === null || value === undefined) return null;

    const candidate: FieldCandidate<T> = {
      value,
      source,
      sourceSection,
      confidence,
      priority: getSourcePriority(fieldName, sourceSection),
    };

    const normalized = resolver.normalize(value);
    const validation = resolver.validate(normalized);

    // Compute confidence based on single candidate
    const singleConfidence = Math.min(confidence * 0.8, 0.7);

    const resolved: ResolvedField<T> = {
      value: normalized,
      raw: String(value),
      confidence: singleConfidence,
      confidenceLevel: getConfidenceLevel(singleConfidence),
      reasons: [`Source: ${source}`, `Section: ${sourceSection}`],
      sources: [source],
      isValid: validation.isValid,
      validationWarnings: validation.warnings,
    };

    if (singleConfidence < 0.60) {
      lowConfidence.push({
        fieldName,
        currentValue: String(normalized),
        confidence: singleConfidence,
        candidateValues: [],
        reason: `Low confidence from source: ${source}`,
      });
    }

    return resolved;
  }

  private resolvePersonal(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedPersonalInfo {
    const name = this.resolveField(
      'personal.name',
      profile.personal.name?.raw || profile.personal.name?.value || null,
      profile.personal.name?.extractor || 'unknown',
      profile.personal.name?.sourceSection || 'header',
      profile.personal.name?.confidence?.score || 0,
      this.nameResolver,
      lowConfidence,
    ) || {
      value: 'Unknown',
      raw: 'Unknown',
      confidence: 0,
      confidenceLevel: 'low' as const,
      reasons: ['No name found'],
      sources: [],
      isValid: false,
      validationWarnings: ['Name is unknown'],
    };

    const headline = this.resolveField(
      'personal.headline',
      profile.personal.headline?.raw || profile.personal.headline?.value || null,
      profile.personal.headline?.extractor || 'unknown',
      profile.personal.headline?.sourceSection || 'header',
      profile.personal.headline?.confidence?.score || 0,
      this.jobTitleResolver,
      lowConfidence,
    );

    return { name, headline, summary: profile.personal.summary };
  }

  private resolveContact(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedContactInfo {
    return {
      email: this.resolveField('contact.email', profile.contact.email?.raw || profile.contact.email?.value || null, profile.contact.email?.extractor || 'unknown', 'contact', profile.contact.email?.confidence?.score || 0, this.emailResolver, lowConfidence),
      phone: this.resolveField('contact.phone', profile.contact.phone?.raw || profile.contact.phone?.value || null, profile.contact.phone?.extractor || 'unknown', 'contact', profile.contact.phone?.confidence?.score || 0, this.phoneResolver, lowConfidence),
      linkedin: this.resolveField('contact.linkedin', profile.contact.linkedin?.raw || profile.contact.linkedin?.value || null, profile.contact.linkedin?.extractor || 'unknown', 'contact', profile.contact.linkedin?.confidence?.score || 0, this.linkedinResolver, lowConfidence),
      github: this.resolveField('contact.github', profile.contact.github?.raw || profile.contact.github?.value || null, profile.contact.github?.extractor || 'unknown', 'contact', profile.contact.github?.confidence?.score || 0, this.linkedinResolver, lowConfidence),
      portfolio: this.resolveField('contact.portfolio', profile.contact.portfolio?.raw || profile.contact.portfolio?.value || null, profile.contact.portfolio?.extractor || 'unknown', 'contact', profile.contact.portfolio?.confidence?.score || 0, this.linkedinResolver, lowConfidence),
      website: this.resolveField('contact.website', profile.contact.website?.raw || profile.contact.website?.value || null, profile.contact.website?.extractor || 'unknown', 'contact', profile.contact.website?.confidence?.score || 0, this.linkedinResolver, lowConfidence),
      city: this.resolveField('contact.city', profile.contact.city?.raw || profile.contact.city?.value || null, profile.contact.city?.extractor || 'unknown', 'contact', profile.contact.city?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.resolveCity(v) || v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      state: this.resolveField('contact.state', profile.contact.state?.raw || profile.contact.state?.value || null, profile.contact.state?.extractor || 'unknown', 'contact', profile.contact.state?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.resolveState(v) || v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      country: this.resolveField('contact.country', profile.contact.country?.raw || profile.contact.country?.value || null, profile.contact.country?.extractor || 'unknown', 'contact', profile.contact.country?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.resolveCountry(v) || v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
    };
  }

  private resolveSkills(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedField<string>[] {
    const seen = new Map<string, ResolvedField<string>>();
    for (const skill of profile.skills) {
      const key = skill.canonical?.toLowerCase() || skill.raw?.toLowerCase();
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing || skill.confidence.score > existing.confidence) {
        const resolved = this.resolveField(
          'skills',
          skill.raw || skill.canonical,
          'skills',
          'skills',
          skill.confidence.score || 0,
          this.skillResolver,
          lowConfidence,
        );
        if (resolved) seen.set(key, resolved);
      }
    }
    return Array.from(seen.values());
  }

  private resolveExperience(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedExperienceEntry[] {
    return profile.experience.map(exp => ({
      company: this.resolveField('experience.company', exp.company?.raw || exp.company?.value || null, exp.company?.extractor || 'experience', 'experience', exp.company?.confidence?.score || 0, this.companyResolver, lowConfidence)!,
      title: this.resolveField('experience.title', exp.title?.raw || exp.title?.value || null, exp.title?.extractor || 'experience', 'experience', exp.title?.confidence?.score || 0, this.jobTitleResolver, lowConfidence)!,
      employmentType: this.resolveField('experience.employmentType', exp.employmentType?.raw || exp.employmentType?.value || null, 'experience', 'experience', exp.employmentType?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      startDate: this.resolveField('experience.startDate', exp.startDate?.raw || exp.startDate?.value || null, 'experience', 'experience', exp.startDate?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      endDate: this.resolveField('experience.endDate', exp.endDate?.raw || exp.endDate?.value || null, 'experience', 'experience', exp.endDate?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      isCurrent: exp.isCurrent,
      durationMonths: exp.durationMonths,
      responsibilities: exp.responsibilities,
    })).filter(e => e.company && e.title);
  }

  private resolveEducation(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedEducationEntry[] {
    return profile.education.map(edu => ({
      degree: this.resolveField('education.degree', edu.degree?.raw || edu.degree?.value || null, 'education', 'education', edu.degree?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.resolveDegree(v) || v, validate: (v: string) => ({ isValid: !!v && v !== 'Unknown', warnings: (!v || v === 'Unknown') ? ['Degree unknown'] : [] }) }, lowConfidence)!,
      specialization: this.resolveField('education.specialization', edu.specialization?.raw || edu.specialization?.value || null, 'education', 'education', edu.specialization?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      university: this.resolveField('education.university', edu.university?.raw || edu.university?.value || null, 'education', 'education', edu.university?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence)!,
      graduationYear: this.resolveField('education.graduationYear', edu.graduationYear?.raw || edu.graduationYear?.value || null, 'education', 'education', edu.graduationYear?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      educationLevel: this.resolveField('education.educationLevel', edu.educationLevel?.raw || edu.educationLevel?.value || null, 'education', 'education', edu.educationLevel?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.getEducationLevel(v) || v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
    })).filter(e => e.degree && e.university);
  }

  private resolveProjects(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedProjectEntry[] {
    return profile.projects.map(proj => ({
      name: this.resolveField('projects.name', proj.name?.raw || proj.name?.value || null, 'projects', 'projects', proj.name?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence)!,
      description: this.resolveField('projects.description', proj.description?.raw || proj.description?.value || null, 'projects', 'projects', proj.description?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      technologies: proj.technologies,
      url: this.resolveField('projects.url', proj.url?.raw || proj.url?.value || null, 'projects', 'projects', proj.url?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
    })).filter(p => p.name);
  }

  private resolveCertifications(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedCertificationEntry[] {
    return profile.certifications.map(cert => ({
      name: this.resolveField('certifications.name', cert.name?.raw || cert.name?.value || null, 'certifications', 'certifications', cert.name?.confidence?.score || 0, { normalize: (v: string) => v.trim(), validate: (v: string) => ({ isValid: !!v && v.length >= 3, warnings: (!v || v.length < 3) ? ['Certification name too short'] : [] }) }, lowConfidence)!,
      issuer: this.resolveField('certifications.issuer', cert.issuer?.raw || cert.issuer?.value || null, 'certifications', 'certifications', cert.issuer?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
      date: this.resolveField('certifications.date', cert.date?.raw || cert.date?.value || null, 'certifications', 'certifications', cert.date?.confidence?.score || 0, { normalize: (v: string) => v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
    })).filter(c => c.name);
  }

  private resolveLanguages(profile: CandidateProfile, lowConfidence: LowConfidenceField[]): ResolvedLanguageEntry[] {
    return profile.languages.map(lang => ({
      name: this.resolveField('languages.name', lang.name?.raw || lang.name?.value || null, 'languages', 'languages', lang.name?.confidence?.score || 0, { normalize: (v: string) => v.trim().replace(/\b\w/g, (c: string) => c.toUpperCase()), validate: (v: string) => ({ isValid: !!v && v.length >= 2, warnings: (!v || v.length < 2) ? ['Language name too short'] : [] }) }, lowConfidence)!,
      proficiency: this.resolveField('languages.proficiency', lang.proficiency?.raw || lang.proficiency?.value || null, 'languages', 'languages', lang.proficiency?.confidence?.score || 0, { normalize: (v: string) => this.knowledge.resolveLanguageProficiency(v) || v, validate: () => ({ isValid: true, warnings: [] }) }, lowConfidence),
    })).filter(l => l.name);
  }
}
