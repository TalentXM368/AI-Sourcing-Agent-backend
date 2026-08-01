import { BaseAIProvider, type AIProviderResponse, type AIProviderConfig } from './base-provider.js';
import { SYSTEM_PROMPT } from '../prompts/base-prompt.js';

export class OpenAIProvider extends BaseAIProvider {
  constructor(config: AIProviderConfig) {
    super(config);
  }

  async sendChat(
    systemPrompt: string,
    userPrompt: string,
    schema?: object,
  ): Promise<AIProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n${systemPrompt}` },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      };

      if (schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'validation_result',
            strict: true,
            schema,
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
