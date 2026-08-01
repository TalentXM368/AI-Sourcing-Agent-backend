import { RETRY_CONFIG } from '../constants/index.js';

export interface AIProviderResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface AIProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;
  protected dead = false;
  protected deadUntil = 0;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get isDead(): boolean {
    if (this.dead && Date.now() > this.deadUntil) {
      this.dead = false;
    }
    return this.dead;
  }

  markDead(): void {
    this.dead = true;
    this.deadUntil = Date.now() + 60000;
  }

  abstract sendChat(
    systemPrompt: string,
    userPrompt: string,
    schema?: object,
  ): Promise<AIProviderResponse>;

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = RETRY_CONFIG.maxRetries,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isQuota = lastError.message.includes('429') ||
          lastError.message.includes('quota') ||
          lastError.message.includes('rate_limit');
        if (isQuota) {
          this.markDead();
          throw lastError;
        }
        if (attempt < retries) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
            RETRY_CONFIG.maxDelayMs,
          );
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError || new Error('Max retries exceeded');
  }

  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = RETRY_CONFIG.timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
