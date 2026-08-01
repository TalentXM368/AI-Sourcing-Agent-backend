export type JobType =
  | 'embedding-generation'
  | 'candidate-indexing'
  | 'job-indexing'
  | 'indexing'
  | 'matching'
  | 'ai-evaluation'
  | 'pipeline';

export interface EmbeddingJobData {
  entityType: 'candidate' | 'job';
  entityId: string;
}

export interface IndexingJobData {
  entityType: 'candidate' | 'job';
  entityId: string;
}

export interface MatchingJobData {
  jobId: string;
  triggerSource: 'upload' | 'update' | 'manual' | 'candidate-upload' | 'job-upload';
}

export interface AIEvaluationJobData {
  jobId: string;
  candidateIds: string[];
  triggerSource: 'matching' | 'manual';
}

export interface PipelineJobData {
  entityType: 'candidate' | 'job';
  entityId: string;
  triggerSource: 'upload' | 'webhook' | 'pdl-search' | 'manual';
}

export type QueueJobData =
  | EmbeddingJobData
  | IndexingJobData
  | MatchingJobData
  | AIEvaluationJobData
  | PipelineJobData;
