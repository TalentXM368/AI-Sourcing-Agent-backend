import type { EnrichmentContext } from '../types/index.js';
import { PROMPT_VERSIONS } from '../constants/index.js';

export const ENRICHMENT_PROMPT_VERSION = PROMPT_VERSIONS.enrichment;

export function buildEnrichmentPrompt(ctx: EnrichmentContext): string {
  const skillsList = ctx.skills.length > 0 ? ctx.skills.join(', ') : 'Not specified';
  const titlesList = ctx.jobTitles.length > 0 ? ctx.jobTitles.join(', ') : 'Not specified';
  const companiesList = ctx.companies.length > 0 ? ctx.companies.join(', ') : 'Not specified';

  return `Analyze this candidate profile and generate enriched metadata.

CANDIDATE NAME: ${ctx.candidateName}
JOB TITLES: ${titlesList}
COMPANIES: ${companiesList}
SKILLS: ${skillsList}
DEGREE: ${ctx.degree || 'Not specified'}
YEARS OF EXPERIENCE: ${ctx.yearsOfExperience || 'Not specified'}
SUMMARY: ${ctx.summary || 'Not provided'}

Return JSON:
{
  "industry": "<primary industry, e.g., 'Technology', 'Healthcare', 'Finance'>",
  "domain": "<specific domain, e.g., 'Cloud Infrastructure', 'Mobile Development', 'Data Science'>",
  "seniority": "<entry | mid | senior | lead | executive | unknown>",
  "primaryRole": "<main professional role, e.g., 'Software Engineer', 'Product Manager'>",
  "secondaryRoles": ["<additional roles if applicable>"],
  "technologyStack": ["<key technologies from skills and experience>"],
  "functionalArea": "<functional area, e.g., 'Engineering', 'Design', 'Marketing'>",
  "headline": "<2-3 word professional headline, e.g., 'Senior Software Engineer'>",
  "summary": "<1-2 sentence recruiter-friendly professional summary>",
  "reason": "<brief explanation of how you determined these values>"
}

RULES:
- Only infer from the provided context — never fabricate
- If you cannot determine a field with confidence, set it to null
- seniority should be inferred from job titles and years of experience
- headline should be concise and recruiter-friendly
- summary should highlight key strengths and experience
- technologyStack should include only technologies mentioned in the profile`;
}
