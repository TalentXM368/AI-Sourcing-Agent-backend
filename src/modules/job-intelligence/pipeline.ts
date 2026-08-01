import type { StructuredDocument, JobProfile, MergedJobExtractionResult } from './types/index.js';
import { processJDSections } from './processors/section-processor.js';
import {
  extractJobMetadata,
  extractJobSkills,
  extractJobExperience,
  extractJobEducation,
  extractJobCompensation,
  extractJobLocation,
  extractJobClassification,
  extractJobContent,
} from './extractors/index.js';
import { buildJobProfile } from './builders/profile-builder.js';

export async function runJobPipeline(
  doc: StructuredDocument,
  jobId?: string,
): Promise<JobProfile> {
  const startTime = Date.now();
  const id = jobId || generateJobId();

  try {
    const sections = processJDSections(doc);
    const fullText = doc.plainText || doc.markdown || '';

    const [
      metadata,
      skills,
      experience,
      education,
      compensation,
      locationResult,
      classification,
      content,
    ] = await Promise.all([
      Promise.resolve(extractJobMetadata(sections, fullText)),
      Promise.resolve(extractJobSkills(sections, fullText)),
      Promise.resolve(extractJobExperience(sections, fullText)),
      Promise.resolve(extractJobEducation(sections, fullText)),
      Promise.resolve(extractJobCompensation(sections, fullText)),
      Promise.resolve(extractJobLocation(sections, fullText)),
      Promise.resolve(extractJobClassification(sections, fullText)),
      Promise.resolve(extractJobContent(sections, fullText)),
    ]);

    classification.workMode = locationResult.workMode;

    const extraction: MergedJobExtractionResult = {
      metadata,
      skills,
      experience,
      education,
      compensation,
      location: {
        city: locationResult.city,
        state: locationResult.state,
        country: locationResult.country,
        raw: locationResult.raw,
        workMode: locationResult.workMode,
      },
      classification,
      content,
    };

    const processingTimeMs = Date.now() - startTime;

    const profile = buildJobProfile(id, doc, sections, extraction, processingTimeMs);

    console.log(`[Job Intelligence] Pipeline completed in ${processingTimeMs}ms for job ${id}`);

    return profile;
  } catch (error) {
    console.error(`[Job Intelligence] Pipeline failed for job ${id}:`, error);
    throw error;
  }
}

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
