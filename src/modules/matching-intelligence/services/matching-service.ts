import { pool } from '../../../db/index.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { EmbeddingService } from '../../vector-intelligence/services/embedding-service.js';
import type { MatchResult, MatchingWeights, HardFilters } from '../types/index.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';
import { applyHardFilters } from '../filters/hard-filters.js';
import {
  matchSkills,
  matchSemantic,
  matchExperience,
  matchEducation,
  matchIndustry,
  matchLocation,
  matchEmployment,
  matchSalary,
  calculateQualityBonus,
} from '../matchers/index.js';
import { calculateMatchScore } from '../scoring/match-score.js';
import { calculateConfidence } from '../confidence/confidence-score.js';
import { buildExplanation } from '../explanation/explanation-builder.js';
import { getEmbeddingCache } from './embedding-cache.js';
import { getMatchResultCache } from './match-result-cache.js';
import { buildQdrantFilterFromHardFilters } from '../utils/qdrant-filter-builder.js';

export class MatchingService {
  private embeddingCache = getEmbeddingCache();
  private resultCache = getMatchResultCache();

  constructor(private embeddingService: EmbeddingService) {}

  async matchJobToCandidates(
    jobId: string,
    filters?: HardFilters,
    topK?: number,
    weights?: Partial<MatchingWeights>,
  ): Promise<{ results: MatchResult[]; metadata: { candidatesRetrieved: number; candidatesFiltered: number; candidatesRanked: number; processingTimeMs: number } }> {
    const startTime = Date.now();

    const cached = this.resultCache.get(jobId, filters as Record<string, unknown>);
    if (cached) {
      console.log(`[Matching] Cache hit for job ${jobId} (${Date.now() - startTime}ms)`);
      return { results: cached.results, metadata: { ...cached.metadata, processingTimeMs: Date.now() - startTime } };
    }

    const effectiveTopK = topK || MATCHING_CONSTANTS.DEFAULT_TOP_K;

    const jobPromise = this.fetchJobProfile(jobId);

    const job = await jobPromise;
    if (!job) throw new Error(`Job ${jobId} not found`);

    const jobText = [
      job.title.value,
      job.summary.value,
      job.requiredSkills.map(s => s.canonical).join(' '),
    ].filter(Boolean).join(' ');

    let embedding = this.embeddingCache.get(jobId);
    const qdrantFilter = buildQdrantFilterFromHardFilters(filters || {});
    const searchResults = await this.embeddingService.searchCandidates(jobText, effectiveTopK, qdrantFilter);

    if (!embedding) {
      console.log(`[Matching] Embedding cache miss for job ${jobId}`);
    } else {
      console.log(`[Matching] Embedding cache hit for job ${jobId}`);
    }

    console.log(`[Matching] Retrieved ${searchResults.length} candidates from vector search`);

    const candidateIds = searchResults.map(r => r.entityId);
    const semanticScoreMap = new Map(searchResults.map(r => [r.entityId, r.score]));

    const candidates = await this.fetchCandidateProfiles(candidateIds);
    console.log(`[Matching] Fetched ${candidates.size} candidate profiles`);

    const results: MatchResult[] = [];
    let filteredCount = 0;

    for (const candidateId of candidateIds) {
      const candidate = candidates.get(candidateId);
      if (!candidate) continue;

      const filterContext = {
        candidateCountry: candidate.contact.country?.value,
        candidateState: candidate.contact.state?.value,
        candidateCity: candidate.contact.city?.value,
        candidateExperienceYears: candidate.experience.reduce((sum, e) => sum + e.durationMonths, 0) / 12,
        candidateSkills: candidate.skills.map(s => s.canonical),
        candidateEmploymentType: candidate.experience.find(e => e.isCurrent)?.employmentType?.value,
        candidateWorkMode: undefined,
        candidateWorkAuthorization: undefined,
        candidateNoticePeriodDays: undefined,
        candidateExpectedSalary: undefined,
      };

      if (filters && !applyHardFilters(filters, filterContext)) {
        filteredCount++;
        continue;
      }

      const semanticScore = matchSemantic(semanticScoreMap.get(candidateId) || 0);
      const skillResult = matchSkills(job, candidate);
      const experienceResult = matchExperience(job, candidate);
      const educationResult = matchEducation(job, candidate);
      const industryResult = matchIndustry(job, candidate);
      const locationResult = matchLocation(job, candidate);
      const employmentResult = matchEmployment(job, candidate);
      const salaryResult = matchSalary(job);
      const qualityBonus = calculateQualityBonus(candidate);

      const overallScore = calculateMatchScore(
        {
          skillScore: skillResult.score,
          semanticScore,
          experienceScore: experienceResult.score,
          educationScore: educationResult.score,
          industryScore: industryResult.score,
          locationScore: locationResult.score,
          employmentScore: employmentResult.score,
          salaryScore: salaryResult.score,
        },
        qualityBonus.multiplier,
        weights,
      );

      const requiredSkillsCount = job.requiredSkills.length;
      const skillCoverage = requiredSkillsCount > 0
        ? (skillResult.matched.length + skillResult.aliasMatched.length + skillResult.relatedMatched.length) / requiredSkillsCount
        : 1;

      const confidence = calculateConfidence(candidate, job, skillCoverage);

      const result: MatchResult = {
        candidateId,
        jobId,
        overallScore,
        semanticScore,
        skillScore: skillResult.score,
        experienceScore: experienceResult.score,
        educationScore: educationResult.score,
        industryScore: industryResult.score,
        locationScore: locationResult.score,
        employmentScore: employmentResult.score,
        salaryScore: salaryResult.score,
        matchedSkills: skillResult.matched,
        missingSkills: skillResult.missing,
        additionalSkills: skillResult.additional,
        hardFilterPassed: true,
        confidence,
      };

      results.push(result);
    }

    results.sort((a, b) => b.overallScore - a.overallScore);

    const processingTimeMs = Date.now() - startTime;
    console.log(`[Matching] Completed: ${results.length} ranked, ${filteredCount} filtered, ${processingTimeMs}ms`);

    const metadata = {
      candidatesRetrieved: searchResults.length,
      candidatesFiltered: filteredCount,
      candidatesRanked: results.length,
      processingTimeMs,
    };

    this.resultCache.set(jobId, filters as Record<string, unknown>, results, metadata);

    return { results, metadata };
  }

  async matchCandidateToJobs(
    candidateId: string,
    filters?: HardFilters,
    topK?: number,
    weights?: Partial<MatchingWeights>,
  ): Promise<{ results: MatchResult[]; metadata: { candidatesRetrieved: number; candidatesFiltered: number; candidatesRanked: number; processingTimeMs: number } }> {
    const startTime = Date.now();
    console.log(`[Matching] Started candidate ${candidateId} matching`);

    const candidate = await this.fetchCandidateProfile(candidateId);
    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

    const effectiveTopK = topK || MATCHING_CONSTANTS.DEFAULT_TOP_K;

    const candidateText = [
      candidate.personal.name.value,
      candidate.personal.headline?.value,
      candidate.skills.map(s => s.canonical).join(' '),
      candidate.personal.summary,
    ].filter(Boolean).join(' ');

    const searchResults = await this.embeddingService.searchJobs(candidateText, effectiveTopK);
    console.log(`[Matching] Retrieved ${searchResults.length} jobs from vector search`);

    const jobIds = searchResults.map(r => r.entityId);
    const semanticScoreMap = new Map(searchResults.map(r => [r.entityId, r.score]));

    const jobs = await this.fetchJobProfiles(jobIds);
    console.log(`[Matching] Fetched ${jobs.size} job profiles`);

    const results: MatchResult[] = [];
    let filteredCount = 0;

    for (const jobId of jobIds) {
      const job = jobs.get(jobId);
      if (!job) continue;

      const filterContext = {
        candidateCountry: candidate.contact.country?.value,
        candidateState: candidate.contact.state?.value,
        candidateCity: candidate.contact.city?.value,
        candidateExperienceYears: candidate.experience.reduce((sum, e) => sum + e.durationMonths, 0) / 12,
        candidateSkills: candidate.skills.map(s => s.canonical),
        candidateEmploymentType: candidate.experience.find(e => e.isCurrent)?.employmentType?.value,
        candidateWorkMode: undefined,
        candidateWorkAuthorization: undefined,
        candidateNoticePeriodDays: undefined,
        candidateExpectedSalary: undefined,
      };

      if (filters && !applyHardFilters(filters, filterContext)) {
        filteredCount++;
        continue;
      }

      const semanticScore = matchSemantic(semanticScoreMap.get(jobId) || 0);
      const skillResult = matchSkills(job, candidate);
      const experienceResult = matchExperience(job, candidate);
      const educationResult = matchEducation(job, candidate);
      const industryResult = matchIndustry(job, candidate);
      const locationResult = matchLocation(job, candidate);
      const employmentResult = matchEmployment(job, candidate);
      const salaryResult = matchSalary(job);
      const qualityBonus = calculateQualityBonus(candidate);

      const overallScore = calculateMatchScore(
        {
          skillScore: skillResult.score,
          semanticScore,
          experienceScore: experienceResult.score,
          educationScore: educationResult.score,
          industryScore: industryResult.score,
          locationScore: locationResult.score,
          employmentScore: employmentResult.score,
          salaryScore: salaryResult.score,
        },
        qualityBonus.multiplier,
        weights,
      );

      const requiredSkillsCount = job.requiredSkills.length;
      const skillCoverage = requiredSkillsCount > 0
        ? (skillResult.matched.length + skillResult.aliasMatched.length + skillResult.relatedMatched.length) / requiredSkillsCount
        : 1;

      const confidence = calculateConfidence(candidate, job, skillCoverage);

      const result: MatchResult = {
        candidateId,
        jobId,
        overallScore,
        semanticScore,
        skillScore: skillResult.score,
        experienceScore: experienceResult.score,
        educationScore: educationResult.score,
        industryScore: industryResult.score,
        locationScore: locationResult.score,
        employmentScore: employmentResult.score,
        salaryScore: salaryResult.score,
        matchedSkills: skillResult.matched,
        missingSkills: skillResult.missing,
        additionalSkills: skillResult.additional,
        hardFilterPassed: true,
        confidence,
      };

      results.push(result);
    }

    results.sort((a, b) => b.overallScore - a.overallScore);

    const processingTimeMs = Date.now() - startTime;
    console.log(`[Matching] Completed: ${results.length} ranked, ${filteredCount} filtered, ${processingTimeMs}ms`);

    return {
      results,
      metadata: {
        candidatesRetrieved: searchResults.length,
        candidatesFiltered: filteredCount,
        candidatesRanked: results.length,
        processingTimeMs,
      },
    };
  }

  private async fetchJobProfile(jobId: string): Promise<JobProfile | null> {
    const result = await pool.query(
      `SELECT id, role, company, location, required_skills, nice_to_have_skills,
              avoid_skills, experience_min, experience_max, description, raw_text,
              industry, region, status
       FROM jobs WHERE id = $1`,
      [jobId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return this.rowToJobProfile(row);
  }

  private async fetchJobProfiles(jobIds: string[]): Promise<Map<string, JobProfile>> {
    if (jobIds.length === 0) return new Map();
    const result = await pool.query(
      `SELECT id, role, company, location, required_skills, nice_to_have_skills,
              avoid_skills, experience_min, experience_max, description, raw_text,
              industry, region, status
       FROM jobs WHERE id = ANY($1)`,
      [jobIds],
    );
    const map = new Map<string, JobProfile>();
    for (const row of result.rows) {
      map.set(row.id, this.rowToJobProfile(row));
    }
    return map;
  }

  private rowToJobProfile(row: Record<string, unknown>): JobProfile {
    const st = (val: string | null) => ({
      raw: val || '', value: val || '', extractor: 'db', sourceSection: 'db',
      confidence: { score: 0.8, reasons: [] },
    });
    return {
      schemaVersion: '1.0',
      jobId: row.id as string,
      title: st(row.role as string),
      summary: st(row.description as string),
      company: st(row.company as string),
      industry: st(row.industry as string),
      domain: null, department: null,
      employmentType: st('full-time'),
      workMode: st('onsite'),
      seniority: st('mid'),
      experience: {
        minimumYears: row.experience_min ? { raw: String(row.experience_min), value: String(row.experience_min), extractor: 'db', sourceSection: 'db', confidence: { score: 0.8, reasons: [] } } : null,
        maximumYears: row.experience_max ? { raw: String(row.experience_max), value: String(row.experience_max), extractor: 'db', sourceSection: 'db', confidence: { score: 0.8, reasons: [] } } : null,
        preferredYears: null,
      },
      education: { degree: null, specialization: null, educationLevel: null },
      salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
      location: { city: null, state: null, country: st(row.region as string), raw: st(row.location as string) },
      requiredSkills: ((row.required_skills as string[]) || []).map(s => ({
        canonical: s, raw: s, category: 'other', confidence: 0.8,
      })),
      preferredSkills: ((row.nice_to_have_skills as string[]) || []).map(s => ({
        canonical: s, raw: s, category: 'other', confidence: 0.7,
      })),
      certifications: [], languages: [],
      responsibilities: [], benefits: [], technologies: [], tools: [],
      workAuthorization: null, visaSponsorship: null, travelRequirements: null, shift: null,
      metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
      processing: { pipelineVersion: '3.0.0', processingTimeMs: 0, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
      validation: { warnings: [], isValid: true },
      quality: { overall: 0.8, completeness: 0.7, fieldConfidence: 0.8, missingFields: [], suggestions: [] },
    };
  }

  private async fetchCandidateProfile(candidateId: string): Promise<CandidateProfile | null> {
    const result = await pool.query(
      `SELECT id, name, email, phone, headline, location, summary,
              skills, experience_years, education, work_history,
              data_quality_score, missing_fields
       FROM candidates WHERE id = $1`,
      [candidateId],
    );
    if (result.rows.length === 0) return null;
    return this.rowToCandidateProfile(result.rows[0]);
  }

  private async fetchCandidateProfiles(candidateIds: string[]): Promise<Map<string, CandidateProfile>> {
    if (candidateIds.length === 0) return new Map();
    const result = await pool.query(
      `SELECT id, name, email, phone, headline, location, summary,
              skills, experience_years, education, work_history,
              data_quality_score, missing_fields
       FROM candidates WHERE id = ANY($1)`,
      [candidateIds],
    );
    const map = new Map<string, CandidateProfile>();
    for (const row of result.rows) {
      map.set(row.id, this.rowToCandidateProfile(row));
    }
    return map;
  }

  private rowToCandidateProfile(row: Record<string, unknown>): CandidateProfile {
    const st = (val: string | null) => ({
      raw: val || '', value: val || '', extractor: 'db', sourceSection: 'db',
      confidence: { score: 0.8, reasons: [] },
    });
    const skills = (row.skills as Array<{ name: string; category?: string }>) || [];
    const workHistory = (row.work_history as Array<{
      title: string; company: string; from?: string; to?: string;
      description?: string; achievements?: string[]; is_current?: boolean;
    }>) || [];
    const education = (row.education as Array<{
      degree: string; school?: string; field?: string; year?: string;
    }>) || [];

    const locationParts = (row.location as string || '').split(',').map(s => s.trim());
    const totalMonths = workHistory.reduce((sum, w) => {
      if (w.from && w.to) {
        const from = new Date(w.from);
        const to = w.to === 'Present' ? new Date() : new Date(w.to);
        return sum + Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30));
      }
      return sum;
    }, 0);

    return {
      schemaVersion: '1.0',
      candidateId: row.id as string,
      personal: {
        name: st(row.name as string),
        headline: row.headline ? st(row.headline as string) : null,
        summary: (row.summary as string) || '',
      },
      contact: {
        email: row.email ? st(row.email as string) : null,
        phone: row.phone ? st(row.phone as string) : null,
        linkedin: null, github: null, portfolio: null, website: null,
        city: locationParts[0] ? st(locationParts[0]) : null,
        state: locationParts[1] ? st(locationParts[1]) : null,
        country: locationParts[2] ? st(locationParts[2]) : null,
      },
      skills: skills.map(s => ({
        canonical: s.name, raw: s.name, category: s.category || 'other',
        confidence: { score: 0.8, reasons: [] },
      })),
      experience: workHistory.map(w => ({
        company: st(w.company),
        title: st(w.title),
        employmentType: null,
        startDate: w.from ? st(w.from) : null,
        endDate: w.to ? st(w.to) : null,
        isCurrent: w.is_current || false,
        durationMonths: 0,
        responsibilities: w.description ? [w.description] : [],
      })),
      education: education.map(e => ({
        degree: st(e.degree),
        specialization: e.field ? st(e.field) : null,
        university: st(e.school || ''),
        graduationYear: e.year ? st(e.year) : null,
        educationLevel: null,
      })),
      projects: [], certifications: [], languages: [],
      socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
      timeline: [],
      rawDocument: { referenceId: '', markdownLength: 0, plainTextLength: 0, sectionsCount: 0 },
      metadata: {
        resumeLanguage: 'en', pages: 0, hasTables: false, hasImages: false,
        sectionCount: 0, sourceFileName: '', sourceFileSize: 0, mimeType: '',
      },
      processing: {
        parser: 'db', parserVersion: '1.0', pipelineVersion: '1.0',
        processingTimeMs: 0, processedAt: new Date().toISOString(),
        warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [],
      },
      validation: { warnings: [], isValid: true },
      completeness: {
        score: (row.data_quality_score as number) || 0.5,
        missingFields: (row.missing_fields as string[]) || [],
        presentFields: [],
      },
    };
  }
}
