import type { HealthCheckResult } from './database.check.js';

export async function checkOpenAI(): Promise<HealthCheckResult> {
  const start = performance.now();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      name: 'openai',
      status: 'unhealthy',
      latencyMs: 0,
      message: 'OPENAI_API_KEY not configured',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = performance.now() - start;

    if (response.ok) {
      return {
        name: 'openai',
        status: 'healthy',
        latencyMs,
        message: `OpenAI API accessible (${latencyMs.toFixed(0)}ms)`,
      };
    }

    if (response.status === 401) {
      return {
        name: 'openai',
        status: 'unhealthy',
        latencyMs,
        message: 'OpenAI API key invalid',
      };
    }

    return {
      name: 'openai',
      status: 'degraded',
      latencyMs,
      message: `OpenAI returned ${response.status}`,
    };
  } catch (error) {
    return {
      name: 'openai',
      status: 'unhealthy',
      latencyMs: performance.now() - start,
      message: `OpenAI connection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
