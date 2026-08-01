export const AI_VALIDATION_VERSION = '2.3.0';

export const CONFIDENCE_THRESHOLDS = {
  SKIP_AI: parseFloat(process.env.AI_VALIDATION_SKIP_THRESHOLD || '0.90'),
  VALIDATE: parseFloat(process.env.AI_VALIDATION_VALIDATE_THRESHOLD || '0.40'),
  MIN_AI_CONFIDENCE: parseFloat(process.env.AI_MIN_CONFIDENCE || '0.75'),
  MIN_IMPROVEMENT: parseFloat(process.env.AI_MIN_IMPROVEMENT || '0.15'),
  ENRICHMENT_MIN_SOURCE: parseFloat(process.env.AI_ENRICHMENT_MIN_SOURCE || '0.60'),
} as const;

export const MERGE_CONFIG = {
  highConfidenceThreshold: CONFIDENCE_THRESHOLDS.SKIP_AI,
  minAIConfidence: CONFIDENCE_THRESHOLDS.MIN_AI_CONFIDENCE,
  minImprovement: CONFIDENCE_THRESHOLDS.MIN_IMPROVEMENT,
} as const;

export const AI_EXCLUDED_FIELDS = new Set([
  'contact.email',
  'contact.phone',
  'contact.linkedin',
  'contact.github',
  'contact.portfolio',
  'contact.website',
  'experience.startDate',
  'experience.endDate',
  'education.graduationYear',
  'certifications.date',
]);

export const AI_VALIDATABLE_FIELDS = [
  'personal.name',
  'personal.headline',
  'experience.company',
  'experience.title',
  'education.degree',
  'education.specialization',
  'education.university',
  'projects.name',
  'projects.description',
  'certifications.name',
  'certifications.issuer',
  'languages.name',
  'skills',
] as const;

export const AI_ENRICHABLE_FIELDS = [
  'enrichment.industry',
  'enrichment.domain',
  'enrichment.seniority',
  'enrichment.primaryRole',
  'enrichment.secondaryRoles',
  'enrichment.technologyStack',
  'enrichment.functionalArea',
  'enrichment.headline',
  'enrichment.summary',
] as const;

export const PROVIDER_PRIORITY = (process.env.AI_PROVIDER_PRIORITY || 'openai,gemini,groq,claude')
  .split(',')
  .map(p => p.trim());

export const PROVIDER_CONFIG: Record<string, {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}> = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    maxTokens: 500,
    temperature: 0.1,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxTokens: 500,
    temperature: 0.1,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    maxTokens: 500,
    temperature: 0.1,
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-3-haiku-20240307',
    maxTokens: 500,
    temperature: 0.1,
  },
};

export const CACHE_CONFIG = {
  maxEntries: parseInt(process.env.AI_CACHE_MAX_ENTRIES || '1000'),
  ttlMs: parseInt(process.env.AI_CACHE_TTL_MS || '3600000'),
} as const;

export const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.AI_MAX_RETRIES || '2'),
  baseDelayMs: 500,
  maxDelayMs: 5000,
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '15000'),
} as const;

export const PROMPT_VERSIONS = {
  name: 'candidate-name-v1',
  company: 'company-validation-v1',
  jobTitle: 'job-title-validation-v1',
  skill: 'skills-validation-v1',
  education: 'education-validation-v1',
  project: 'project-validation-v1',
  certification: 'certification-validation-v1',
  language: 'language-validation-v1',
  headline: 'headline-enrichment-v1',
  summary: 'summary-enrichment-v1',
  enrichment: 'context-enrichment-v1',
} as const;

export const FIELD_TO_PROMPT_KEY: Record<string, string> = {
  'personal.name': 'name',
  'personal.headline': 'headline',
  'experience.company': 'company',
  'experience.title': 'jobTitle',
  'education.degree': 'education',
  'education.specialization': 'education',
  'education.university': 'education',
  'projects.name': 'project',
  'projects.description': 'project',
  'certifications.name': 'certification',
  'certifications.issuer': 'certification',
  'languages.name': 'language',
  'skills': 'skill',
};
