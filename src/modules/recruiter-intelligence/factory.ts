import { RecruiterAIRouter } from './providers/index.js';
import { EvaluationService } from './services/evaluation-service.js';
import { LLMService } from './services/llm-service.js';
import { createReranker } from './rerankers/index.js';
import { createRecruiterRouter } from './routes/recruiter.routes.js';
import { RECRUITER_CONSTANTS } from './constants/index.js';
import type { RecruiterAIOptions } from './types/input.types.js';

let evaluationService: EvaluationService | null = null;

export function createRecruiterServices(options?: RecruiterAIOptions) {
  const rerankerType = options?.reranker || 'cohere';
  const reranker = createReranker(rerankerType as 'cohere' | 'local-bge' | 'local-jina' | 'none');

  const providerPriority = options?.provider === 'auto' || !options?.provider
    ? RECRUITER_CONSTANTS.providerPriority
    : [options.provider];

  const llmRouter = new RecruiterAIRouter(providerPriority);
  const llmService = new LLMService(llmRouter);

  evaluationService = new EvaluationService(reranker, llmService);
  return { evaluationService };
}

export function getRecruiterRouter(options?: RecruiterAIOptions) {
  const { evaluationService: es } = createRecruiterServices(options);
  return createRecruiterRouter(es);
}

export function getEvaluationService(): EvaluationService | null {
  return evaluationService;
}
