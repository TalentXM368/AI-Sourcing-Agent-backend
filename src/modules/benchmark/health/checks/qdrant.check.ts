import type { HealthCheckResult } from './database.check.js';

export async function checkQdrant(): Promise<HealthCheckResult> {
  const start = performance.now();
  const qdrantUrl = process.env.QDRANT_URL;

  if (!qdrantUrl) {
    return {
      name: 'qdrant',
      status: 'degraded',
      latencyMs: 0,
      message: 'QDRANT_URL not configured (optional — vector search disabled)',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${qdrantUrl}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = performance.now() - start;

    if (response.ok) {
      return {
        name: 'qdrant',
        status: latencyMs < 1000 ? 'healthy' : 'degraded',
        latencyMs,
        message: `Qdrant connected (${latencyMs.toFixed(0)}ms)`,
      };
    }

    return {
      name: 'qdrant',
      status: 'degraded',
      latencyMs,
      message: `Qdrant returned ${response.status} (service may be starting)`,
    };
  } catch (error) {
    return {
      name: 'qdrant',
      status: 'degraded',
      latencyMs: performance.now() - start,
      message: `Qdrant unreachable: ${error instanceof Error ? error.message : String(error)} (non-critical — vector search disabled)`,
    };
  }
}
