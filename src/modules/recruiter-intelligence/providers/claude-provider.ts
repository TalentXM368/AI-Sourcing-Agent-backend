import { BaseLLMProvider } from './base-provider.js';
import type { LLMProviderResponse, EvaluationPrompt } from '../types/provider.types.js';

export class ClaudeProvider extends BaseLLMProvider {
  async evaluate(prompt: EvaluationPrompt): Promise<LLMProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();

      const body: Record<string, unknown> = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'user', content: `${prompt.systemPrompt}\n\n${prompt.userPrompt}` },
        ],
      };

      if (prompt.schema) {
        body.output_config = {
          format: {
            type: 'json_schema',
            schema: prompt.schema,
          },
        };
      }

      const response = await this.fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

      return {
        content: data.content[0]?.text || '',
        provider: this.config.name,
        model: this.config.model,
        tokensUsed,
        latencyMs: Date.now() - startTime,
      };
    });
  }
}
