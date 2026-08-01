import type { CollectionConfig, PayloadIndexField } from '../types/index.js';

export const VECTOR_CONSTANTS = {
  COLLECTIONS: {
    CANDIDATES: 'candidates',
    JOBS: 'jobs',
  },
  EMBEDDING_VERSION: process.env.EMBEDDING_VERSION || '1.0.0',
  PROFILE_VERSION: '1.0',
  DEFAULT_DIMENSIONS: parseInt(process.env.EMBEDDING_DIMENSIONS || '384', 10),
  DEFAULT_MODEL: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
  DEFAULT_TOP_K: 10,
  MAX_TOP_K: 100,
  QUEUE: {
    MAX_CONCURRENT: 1,
    RETRY_DELAY_MS: 1000,
    MAX_RETRIES: 3,
    BATCH_SIZE: 10,
  },
  PAYLOAD_INDEXES: [
    { field_name: 'entityType', field_schema: 'keyword' as const },
    { field_name: 'name', field_schema: 'text' as const },
    { field_name: 'headline', field_schema: 'text' as const },
    { field_name: 'skills', field_schema: 'keyword' as const },
    { field_name: 'location', field_schema: 'text' as const },
    { field_name: 'experienceYears', field_schema: 'integer' as const },
    { field_name: 'educationLevel', field_schema: 'keyword' as const },
    { field_name: 'industry', field_schema: 'keyword' as const },
    { field_name: 'employmentType', field_schema: 'keyword' as const },
    { field_name: 'seniority', field_schema: 'keyword' as const },
  ] satisfies PayloadIndexField[],
  PROVIDER_CONFIG: {
    openai: {
      name: 'openai' as const,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    local: {
      name: 'local' as const,
      model: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '384', 10),
    },
  },
} as const;

export const CANDIDATE_COLLECTION_CONFIG: CollectionConfig = {
  name: VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES,
  vectors: {
    size: VECTOR_CONSTANTS.DEFAULT_DIMENSIONS,
    distance: 'Cosine',
  },
  on_disk_payload: false,
  optimizers_config: {
    indexing_threshold: 20000,
  },
};

export const JOB_COLLECTION_CONFIG: CollectionConfig = {
  name: VECTOR_CONSTANTS.COLLECTIONS.JOBS,
  vectors: {
    size: VECTOR_CONSTANTS.DEFAULT_DIMENSIONS,
    distance: 'Cosine',
  },
  on_disk_payload: false,
  optimizers_config: {
    indexing_threshold: 20000,
  },
};
