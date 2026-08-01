export { BaseAIProvider, type AIProviderResponse, type AIProviderConfig } from './base-provider.js';
export { OpenAIProvider } from './openai.provider.js';
export { ClaudeProvider } from './claude.provider.js';

import { OpenAIProvider } from './openai.provider.js';
import { ClaudeProvider } from './claude.provider.js';
import { PROVIDER_CONFIG } from '../constants/index.js';
import type { AIProviderConfig } from './base-provider.js';
import { BaseAIProvider } from './base-provider.js';

export function createProvider(name: string): BaseAIProvider | null {
  const config = PROVIDER_CONFIG[name];
  if (!config || !config.apiKey) return null;

  const providerConfig: AIProviderConfig = {
    name,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  };

  switch (name) {
    case 'openai':
      return new OpenAIProvider(providerConfig);
    case 'gemini':
      return new OpenAIProvider(providerConfig);
    case 'groq':
      return new OpenAIProvider(providerConfig);
    case 'claude':
      return new ClaudeProvider(providerConfig);
    default:
      return null;
  }
}
