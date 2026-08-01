import type { StructuredDocument } from './types/input.types.js';
import type { CandidateProfile } from './types/profile.types.js';
import type { MergedExtractionResult } from './types/extracted.types.js';
import { processSections } from './processors/section-processor.js';
import {
  extractContact,
  extractSkills,
  extractExperience,
  extractEducation,
  extractProjects,
  extractCertifications,
  extractLanguages,
} from './extractors/index.js';
import { normalizeSkills } from './normalizers/index.js';
import {
  deduplicateExperience,
  deduplicateEducation,
  deduplicateProjects,
} from './resolvers/index.js';
import { buildProfile } from './builders/profile-builder.js';

export async function runPipeline(doc: StructuredDocument): Promise<CandidateProfile> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];
  const extractorsRun: string[] = [];
  const normalizersRun: string[] = [];
  const resolversRun: string[] = [];

  try {
    // Step 1: Process sections
    const sections = processSections(doc);
    const fullText = doc.plainText || doc.markdown;

    // Step 2: Run all extractors (independently)
    extractorsRun.push('contact', 'skills', 'experience', 'education', 'projects', 'certifications', 'languages');

    const contact = extractContact(sections, fullText);
    const skills = extractSkills(sections, fullText);
    const experience = extractExperience(sections);
    const education = extractEducation(sections);
    const projects = extractProjects(sections);
    const certifications = extractCertifications(sections);
    const languages = extractLanguages(sections);

    // Extract name from first few lines
    const headerLines = sections.slice(0, 3).map(s => s.content).join('\n').split('\n').slice(0, 8);
    let name = null;
    for (const line of headerLines) {
      const cleaned = line.replace(/[^a-zA-Z\s\-\.]/g, '').replace(/^[\s\._-]+/, '').trim();
      if (cleaned.length >= 2 && cleaned.split(/\s/).length <= 5) {
        name = {
          raw: cleaned,
          value: cleaned,
          extractor: 'name',
          sourceSection: 'header',
          confidence: { score: 0.8, reasons: ['First line heuristic'] },
        };
        break;
      }
    }

    // Extract headline
    const titleKeywords = [
      'engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior',
      'staff', 'principal', 'director', 'analyst', 'consultant', 'specialist',
      'scientist', 'intern', 'associate', 'coordinator', 'supervisor',
      'full stack', 'frontend', 'backend', 'devops', 'software',
    ];
    let headline = null;
    for (const line of headerLines.slice(1, 6)) {
      const lower = line.toLowerCase().trim();
      if (titleKeywords.some(kw => lower.includes(kw))) {
        headline = {
          raw: line.trim(),
          value: line.trim(),
          extractor: 'headline',
          sourceSection: 'header',
          confidence: { score: 0.7, reasons: ['Title keyword match'] },
        };
        break;
      }
    }

    // Step 3: Normalize skills
    normalizersRun.push('skills');
    const normalizedSkills = normalizeSkills(skills);

    // Step 4: Resolve conflicts and dedup
    resolversRun.push('entity', 'dedup');
    const dedupedExperience = deduplicateExperience(experience);
    const dedupedEducation = deduplicateEducation(education);
    const dedupedProjects = deduplicateProjects(projects);

    // Step 5: Build merged extraction result
    const extraction: MergedExtractionResult = {
      name,
      headline,
      summary: sections.find(s => s.normalizedName === 'summary')?.content || '',
      contact,
      skills: normalizedSkills,
      experience: dedupedExperience,
      education: dedupedEducation,
      projects: dedupedProjects,
      certifications,
      languages,
    };

    // Step 6: Build profile
    const profile = buildProfile(
      doc,
      extraction,
      startTime,
      warnings,
      errors,
      extractorsRun,
      normalizersRun,
      resolversRun,
    );

    return profile;
  } catch (error) {
    errors.push(`Pipeline error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
