import { BaseLLMProvider } from './base-provider.js';
import type { LLMProviderResponse, EvaluationPrompt } from '../types/provider.types.js';

export class OpenAIProvider extends BaseLLMProvider {
  async evaluate(prompt: EvaluationPrompt): Promise<LLMProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: prompt.userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      };

      if (prompt.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'recruiter_evaluation',
            strict: true,
            schema: prompt.schema,
          },
        };
      }

      const response = await this.fetchWithTimeout(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { total_tokens: number };
      };

      return {
        content: data.choices[0]?.message?.content || '',
        provider: this.config.name,
        model: this.config.model,
        tokensUsed: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - startTime,
      };
    });
  }
}
