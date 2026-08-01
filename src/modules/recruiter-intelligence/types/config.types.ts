export interface RecruiterConfig {
  version: string;
  scoreAdjustment: {
    baseline: number;
    scale: number;
    maxAdjustment: number;
    minAdjustment: number;
  };
  confidenceThresholds: {
    high: number;
    medium: number;
    low: number;
  };
  recommendationThresholds: {
    strongHire: number;
    goodHire: number;
    consider: number;
    maybe: number;
    notRecommended: number;
  };
  providerPriority: string[];
  concurrency: {
    maxLLMCalls: number;
    rerankBatchSize: number;
  };
  cache: {
    ttlMs: number;
    maxEntries: number;
  };
}
