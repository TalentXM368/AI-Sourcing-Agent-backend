import { BaseLLMProvider } from './base-provider.js';
import type { LLMProviderResponse, EvaluationPrompt } from '../types/provider.types.js';

export class GeminiProvider extends BaseLLMProvider {
  async evaluate(prompt: EvaluationPrompt): Promise<LLMProviderResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();

      const contents = [
        {
          role: 'user',
          parts: [{ text: `${prompt.systemPrompt}\n\n${prompt.userPrompt}` }],
        },
      ];

      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      };

      if (prompt.schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = prompt.schema;
      }

      const body = {
        contents,
        generationConfig,
      };

      const model = this.config.model || 'gemini-2.0-flash';
      const response = await this.fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ text: string }> };
        }>;
        usageMetadata?: { totalTokenCount: number };
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

      return {
        content: text,
        provider: this.config.name,
        model: this.config.model,
        tokensUsed,
        latencyMs: Date.now() - startTime,
      };
    });
  }
}
