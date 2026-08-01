import type { RecruiterConfig } from '../types/config.types.js';

export const RECRUITER_CONSTANTS: RecruiterConfig = {
  version: '1.0.0',

  scoreAdjustment: {
    baseline: 0.5,
    scale: 20,
    maxAdjustment: 10,
    minAdjustment: -10,
  },

  confidenceThresholds: {
    high: 0.85,
    medium: 0.60,
    low: 0.0,
  },

  recommendationThresholds: {
    strongHire: 90,
    goodHire: 75,
    consider: 60,
    maybe: 45,
    notRecommended: 0,
  },

  providerPriority: (process.env.RECRUITER_AI_PROVIDER_PRIORITY || 'openai,claude,gemini,groq')
    .split(',')
    .map(p => p.trim()),

  concurrency: {
    maxLLMCalls: parseInt(process.env.RECRUITER_AI_MAX_CONCURRENCY || '5', 10),
    rerankBatchSize: parseInt(process.env.RECRUITER_AI_RERANK_BATCH || '32', 10),
  },

  cache: {
    ttlMs: parseInt(process.env.RECRUITER_AI_CACHE_TTL_MS || '600000', 10),
    maxEntries: parseInt(process.env.RECRUITER_AI_CACHE_MAX || '100', 10),
  },
};

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
    maxTokens: 2000,
    temperature: 0.1,
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-3-haiku-20240307',
    maxTokens: 2000,
    temperature: 0.1,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxTokens: 2000,
    temperature: 0.1,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    maxTokens: 2000,
    temperature: 0.1,
  },
};

export const RERANKER_CONFIG = {
  default: (process.env.RERANKER_PROVIDER || 'cohere') as 'cohere' | 'local-bge' | 'local-jina' | 'none',
  cohereModel: process.env.COHERE_RERANK_MODEL || 'rerank-v4.0-pro',
  localModel: process.env.LOCAL_RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3',
  maxBatchSize: parseInt(process.env.RECRUITER_AI_RERANK_BATCH || '32', 10),
};

export const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.AI_MAX_RETRIES || '2', 10),
  baseDelayMs: 500,
  maxDelayMs: 5000,
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '30000', 10),
};
