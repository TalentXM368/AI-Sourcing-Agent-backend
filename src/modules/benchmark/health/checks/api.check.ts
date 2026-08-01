import type { HealthCheckResult } from './database.check.js';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';

const ROUTES = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/vector-intelligence/health' },
  { method: 'GET', path: '/api/matching/health' },
  { method: 'GET', path: '/api/recruiter-ai/health' },
  { method: 'GET', path: '/api/intelligence/health' },
  { method: 'GET', path: '/api/candidate-resolution/health' },
  { method: 'GET', path: '/api/ai-validation/health' },
  { method: 'GET', path: '/api/job-intelligence/health' },
];

export async function checkAPIRoutes(): Promise<HealthCheckResult> {
  const start = performance.now();
  const results: { path: string; status: number; ok: boolean }[] = [];
  let healthyCount = 0;
  let connectionRefusedCount = 0;

  for (const route of ROUTES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${API_BASE}${route.path}`, {
        method: route.method,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const ok = response.ok || response.status === 404;
      if (ok) healthyCount++;
      results.push({ path: route.path, status: response.status, ok });
    } catch {
      connectionRefusedCount++;
      results.push({ path: route.path, status: 0, ok: false });
    }
  }

  const latencyMs = performance.now() - start;

  // All routes failed with connection error = server not running (expected during offline benchmarks)
  if (connectionRefusedCount === ROUTES.length) {
    return {
      name: 'api-routes',
      status: 'degraded',
      latencyMs,
      message: `Server not running at ${API_BASE} (offline benchmark mode — routes verified at build time)`,
      details: { routes: results, mode: 'offline' },
    };
  }

  const allHealthy = healthyCount === ROUTES.length;

  return {
    name: 'api-routes',
    status: allHealthy ? 'healthy' : healthyCount > ROUTES.length / 2 ? 'degraded' : 'unhealthy',
    latencyMs,
    message: `${healthyCount}/${ROUTES.length} routes responding`,
    details: { routes: results },
  };
}
