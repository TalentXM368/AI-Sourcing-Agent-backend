import { BaseAIProvider, type AIProviderResponse, type AIProviderConfig } from './base-provider.js';
import { SYSTEM_PROMPT } from '../prompts/base-prompt.js';

export class ClaudeProvider extends BaseAIProvider {
  constructor(config: AIProviderConfig) {
    super(config);
  }

  async sendChat(
    systemPrompt: string,
    userPrompt: string,
    _schema?: object,
  ): Promise<AIProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      const response = await this.fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
            system: `${SYSTEM_PROMPT}\n\n${systemPrompt}`,
            messages: [
              { role: 'user', content: userPrompt },
            ],
          }),
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

      const content = data.content?.[0]?.text || '';
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

      return {
        content,
        provider: this.config.name,
        model: this.config.model,
        tokensUsed,
        latencyMs: Date.now() - startTime,
      };
    });
  }
}
