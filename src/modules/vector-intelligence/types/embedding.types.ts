export interface EmbeddingMetadata {
  embeddingVersion: string;
  profileVersion: string;
  provider: string;
  model: string;
  dimensions: number;
  indexedAt: string;
}

export interface EmbeddingJob {
  jobId: string;
  entityType: 'candidate' | 'job';
  entityId: string;
  priority: 'high' | 'normal' | 'low';
  createdAt: string;
  retryCount: number;
  maxRetries: number;
}

export interface EmbeddingJobResult {
  jobId: string;
  entityType: 'candidate' | 'job';
  entityId: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface CandidateSemanticText {
  role: string;
  skills: string;
  summary: string;
  experience: string;
  education: string;
  location: string;
  full: string;
}

export interface JobSemanticText {
  title: string;
  skills: string;
  summary: string;
  responsibilities: string;
  experience: string;
  location: string;
  full: string;
}

export interface VectorSearchResult {
  entityId: string;
  entityType: 'candidate' | 'job';
  score: number;
  payload: Record<string, unknown>;
}

export interface VectorSearchRequest {
  entityType: 'candidate' | 'job';
  query: string;
  topK: number;
  filters?: Record<string, unknown>;
  embeddingProvider?: string;
}

export type EmbeddingProviderName = 'openai' | 'local';

export interface EmbeddingProviderConfig {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  apiKey?: string;
  baseUrl?: string;
}
