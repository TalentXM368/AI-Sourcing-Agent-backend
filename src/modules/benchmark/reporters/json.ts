import type { BenchmarkResult } from '../harness/index.js';
import type { ReadinessReport } from '../health/readiness.js';

export function generateJSONReport(
  results: BenchmarkResult[],
  readiness: ReadinessReport,
): string {
  // Strip internal _startMs field from results before outputting
  const cleanResults = results.map(r => {
    const { _startMs, ...rest } = r as any;
    return rest;
  });

  return JSON.stringify({
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
    readiness,
    benchmarks: cleanResults,
  }, null, 2);
}
