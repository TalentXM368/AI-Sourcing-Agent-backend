import type { HealthCheckResult } from './database.check.js';

const PROVIDERS = [
  { name: 'openai', envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' },
  { name: 'claude', envKey: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com' },
  { name: 'gemini', envKey: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com' },
  { name: 'groq', envKey: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' },
];

export async function checkProviders(): Promise<HealthCheckResult> {
  const start = performance.now();
  const results: { name: string; available: boolean; configured: boolean }[] = [];

  for (const provider of PROVIDERS) {
    const configured = !!process.env[provider.envKey];
    results.push({
      name: provider.name,
      available: configured,
      configured,
    });
  }

  const configuredCount = results.filter(r => r.configured).length;
  const latencyMs = performance.now() - start;

  if (configuredCount === 0) {
    return {
      name: 'ai-providers',
      status: 'unhealthy',
      latencyMs,
      message: 'No AI providers configured',
      details: { providers: results },
    };
  }

  return {
    name: 'ai-providers',
    status: configuredCount >= 2 ? 'healthy' : 'degraded',
    latencyMs,
    message: `${configuredCount}/${PROVIDERS.length} AI providers configured`,
    details: { providers: results },
  };
}
