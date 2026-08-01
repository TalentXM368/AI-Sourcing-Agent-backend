import { pool } from '../../../../db/index.js';

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
}

export async function checkDatabase(): Promise<HealthCheckResult> {
  const start = performance.now();
  try {
    await pool.query('SELECT 1');
    const latencyMs = performance.now() - start;
    return {
      name: 'database',
      status: latencyMs < 2000 ? 'healthy' : 'degraded',
      latencyMs,
      message: `PostgreSQL connected (${latencyMs.toFixed(0)}ms)`,
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'unhealthy',
      latencyMs: performance.now() - start,
      message: `PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
