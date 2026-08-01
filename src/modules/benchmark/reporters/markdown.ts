import type { BenchmarkResult } from '../harness/index.js';
import type { ReadinessReport } from '../health/readiness.js';

export function generateMarkdownReport(
  results: BenchmarkResult[],
  readiness: ReadinessReport,
): string {
  const lines: string[] = [];

  lines.push(`# Benchmark Report — ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`- **Overall Readiness:** ${readiness.overallScore}/100 (${readiness.overallStatus})`);
  lines.push(`- **Modules Tested:** ${results.length}`);
  lines.push(`- **Passed:** ${results.filter(r => r.success && !r.skipped).length}`);
  lines.push(`- **Failed:** ${results.filter(r => !r.success).length}`);
  lines.push(`- **Skipped:** ${results.filter(r => r.skipped).length}`);
  lines.push('');

  if (readiness.blockers.length > 0) {
    lines.push('### Blockers');
    readiness.blockers.forEach(b => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## Health Checks');
  lines.push('');
  lines.push('| Check | Status | Latency | Message |');
  lines.push('|-------|--------|---------|---------|');
  for (const check of readiness.checks) {
    const icon = check.status === 'healthy' ? '✓' : check.status === 'degraded' ? '⚠' : '✗';
    lines.push(`| ${check.name} | ${icon} ${check.status} | ${check.latencyMs.toFixed(0)}ms | ${check.message} |`);
  }
  lines.push('');

  lines.push('## Module Results');
  lines.push('');
  for (const result of results) {
    const icon = result.skipped ? '⊘' : result.success ? '✓' : '✗';
    lines.push(`### ${icon} ${result.module}`);
    lines.push('');
    lines.push(`- Duration: ${result.duration}ms`);
    if (result.skipped) {
      lines.push(`- Skipped: ${result.skipReason}`);
    }
    if (result.errors.length > 0) {
      lines.push(`- Errors: ${result.errors.join('; ')}`);
    }
    const metrics = result.metrics as Record<string, unknown>;
    for (const [key, value] of Object.entries(metrics)) {
      if (key === 'resources') continue;
      if (typeof value === 'object' && value !== null) {
        lines.push(`- ${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`- ${key}: ${value}`);
      }
    }
    lines.push('');
  }

  lines.push('## Recommendations');
  lines.push('');
  if (readiness.overallScore >= 80) {
    lines.push('The platform is production-ready. Proceed with frontend development.');
  } else if (readiness.overallScore >= 50) {
    lines.push('The platform is partially ready. Address the blockers before frontend development.');
  } else {
    lines.push('The platform is not ready. Critical issues must be resolved first.');
  }
  lines.push('');

  return lines.join('\n');
}
