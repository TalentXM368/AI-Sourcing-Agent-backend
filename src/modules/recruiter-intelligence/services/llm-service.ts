import type { RecruiterAIRouter } from '../providers/index.js';
import type { EvaluationPrompt, LLMProviderResponse } from '../types/provider.types.js';

export class LLMService {
  constructor(private router: RecruiterAIRouter) {}

  async evaluate(prompt: EvaluationPrompt): Promise<LLMProviderResponse> {
    return this.router.route(prompt);
  }

  get availableProviders(): string[] {
    return this.router.availableProviders;
  }

  get lastProvider(): string {
    return this.router.lastProvider;
  }
}
