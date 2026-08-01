import type { BenchmarkResult } from '../harness/index.js';
import type { ReadinessReport } from '../health/readiness.js';

export function generateCSVReport(
  results: BenchmarkResult[],
  readiness: ReadinessReport,
): string {
  const lines: string[] = [];

  lines.push('module,timestamp,duration_ms,success,skipped,errors');
  for (const r of results) {
    lines.push(`${r.module},${r.timestamp},${r.duration},${r.success},${r.skipped},"${r.errors.join('; ')}"`);
  }

  lines.push('');
  lines.push('health_check,status,latency_ms,message');
  for (const c of readiness.checks) {
    lines.push(`${c.name},${c.status},${c.latencyMs.toFixed(0)},"${c.message}"`);
  }

  lines.push('');
  lines.push('metric,value');
  lines.push(`readiness_score,${readiness.overallScore}`);
  lines.push(`readiness_status,${readiness.overallStatus}`);
  lines.push(`modules_tested,${results.length}`);
  lines.push(`modules_passed,${results.filter(r => r.success && !r.skipped).length}`);
  lines.push(`modules_failed,${results.filter(r => !r.success).length}`);
  lines.push(`modules_skipped,${results.filter(r => r.skipped).length}`);

  return lines.join('\n');
}
