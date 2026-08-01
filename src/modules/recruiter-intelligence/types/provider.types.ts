export interface RerankerResult {
  index: number;
  score: number;
  document?: string;
}

export interface RerankerProvider {
  name: string;
  isDead: boolean;
  markDead(): void;
  rerank(query: string, documents: string[], topN: number): Promise<RerankerResult[]>;
}

export interface LLMProviderResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface LLMProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export interface EvaluationPrompt {
  systemPrompt: string;
  userPrompt: string;
  schema?: object;
}

export interface LLMProvider {
  name: string;
  isDead: boolean;
  markDead(): void;
  evaluate(prompt: EvaluationPrompt): Promise<LLMProviderResponse>;
}
