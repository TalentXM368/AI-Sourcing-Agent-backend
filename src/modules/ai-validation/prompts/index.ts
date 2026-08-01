import { PROMPT_VERSIONS, FIELD_TO_PROMPT_KEY } from '../constants/index.js';
import type { ValidationContext } from '../types/index.js';
import { buildNamePrompt, NAME_PROMPT_VERSION } from './name.prompt.js';
import { buildCompanyPrompt, COMPANY_PROMPT_VERSION } from './company.prompt.js';
import { buildJobTitlePrompt, JOB_TITLE_PROMPT_VERSION } from './job-title.prompt.js';
import { buildSkillPrompt, SKILL_PROMPT_VERSION } from './skill.prompt.js';
import { buildEducationPrompt, EDUCATION_PROMPT_VERSION } from './education.prompt.js';
import { buildProjectPrompt, PROJECT_PROMPT_VERSION } from './project.prompt.js';
import { buildCertificationPrompt, CERTIFICATION_PROMPT_VERSION } from './certification.prompt.js';
import { buildLanguagePrompt, LANGUAGE_PROMPT_VERSION } from './language.prompt.js';
import { buildEnrichmentPrompt, ENRICHMENT_PROMPT_VERSION } from './enrichment.prompt.js';
import type { EnrichmentContext } from '../types/index.js';

export const PROMPT_BUILDERS: Record<string, (ctx: ValidationContext) => string> = {
  name: buildNamePrompt,
  company: buildCompanyPrompt,
  jobTitle: buildJobTitlePrompt,
  skill: buildSkillPrompt,
  education: buildEducationPrompt,
  project: buildProjectPrompt,
  certification: buildCertificationPrompt,
  language: buildLanguagePrompt,
};

export const PROMPT_VERSION_MAP: Record<string, string> = {
  name: NAME_PROMPT_VERSION,
  company: COMPANY_PROMPT_VERSION,
  jobTitle: JOB_TITLE_PROMPT_VERSION,
  skill: SKILL_PROMPT_VERSION,
  education: EDUCATION_PROMPT_VERSION,
  project: PROJECT_PROMPT_VERSION,
  certification: CERTIFICATION_PROMPT_VERSION,
  language: LANGUAGE_PROMPT_VERSION,
  enrichment: ENRICHMENT_PROMPT_VERSION,
};

export function getPromptKey(fieldName: string): string {
  return FIELD_TO_PROMPT_KEY[fieldName] || 'unknown';
}

export function getPromptVersion(fieldName: string): string {
  const key = getPromptKey(fieldName);
  return PROMPT_VERSION_MAP[key] || 'unknown';
}

export function buildValidationPrompt(ctx: ValidationContext): string {
  const key = getPromptKey(ctx.fieldName);
  const builder = PROMPT_BUILDERS[key];
  if (!builder) {
    throw new Error(`No prompt builder for field: ${ctx.fieldName}`);
  }
  return builder(ctx);
}

export { buildEnrichmentPrompt, ENRICHMENT_PROMPT_VERSION };
export type { EnrichmentContext };
