import { checkDatabase, checkQdrant, checkOpenAI, checkProviders, checkEnvironment, checkAPIRoutes, type HealthCheckResult } from './checks/index.js';

export interface ReadinessReport {
  timestamp: string;
  overallScore: number;
  overallStatus: 'ready' | 'degraded' | 'not-ready';
  checks: HealthCheckResult[];
  blockers: string[];
}

export async function runHealthChecks(): Promise<ReadinessReport> {
  const checks: HealthCheckResult[] = [];

  checks.push(checkEnvironment());
  checks.push(await checkDatabase());
  checks.push(await checkQdrant());
  checks.push(await checkOpenAI());
  checks.push(await checkProviders());
  checks.push(await checkAPIRoutes());

  const blockers: string[] = [];
  let score = 100;

  for (const check of checks) {
    if (check.status === 'unhealthy') {
      if (check.name === 'database') {
        score -= 30;
        blockers.push('Database unreachable');
      } else if (check.name === 'environment') {
        score -= 20;
        blockers.push(check.message);
      } else if (check.name === 'ai-providers') {
        score -= 15;
        blockers.push('No AI providers configured');
      } else if (check.name === 'openai') {
        score -= 10;
        blockers.push('OpenAI API unreachable');
      }
      // qdrant and api-routes unhealthy is now handled via degraded path
    } else if (check.status === 'degraded') {
      if (check.name === 'qdrant') score -= 5;
      else if (check.name === 'ai-providers') score -= 5;
      else if (check.name === 'api-routes') score -= 3;
      else if (check.name === 'database') score -= 5;
    }
  }

  const overallScore = Math.max(0, score);
  const overallStatus = overallScore >= 80 ? 'ready' : overallScore >= 50 ? 'degraded' : 'not-ready';

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    overallStatus,
    checks,
    blockers,
  };
}
