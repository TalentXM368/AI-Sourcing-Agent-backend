import type { BenchmarkResult } from './index.js';
import { createBenchmarkResult } from './index.js';
import { calculateLatencyMetrics, startResourceBenchmark } from '../metrics/index.js';
import { generateCandidateProfiles, generateJobProfiles } from '../datasets/index.js';
import { checkQdrant } from '../health/checks/index.js';

export interface StressTestOptions {
  candidateCounts: number[];
  concurrentRequests?: number;
}

export class StressRunner {
  async run(options: StressTestOptions): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const qdrantHealth = await checkQdrant();

    for (const count of options.candidateCounts) {
      const result = createBenchmarkResult(`stress-${count}`, Date.now());
      const resourceBench = startResourceBenchmark();

      try {
        const candidates = generateCandidateProfiles({ count, seed: 42 });
        const jobs = generateJobProfiles({ count: Math.min(10, count), seed: 100 });

        const indexStart = performance.now();
        const indexTime = performance.now() - indexStart;

        const searchLatencies: number[] = [];
        for (const job of jobs) {
          const searchStart = performance.now();
          searchLatencies.push(performance.now() - searchStart);
        }

        result.metrics = {
          candidateCount: count,
          jobCount: jobs.length,
          indexTimeMs: indexTime,
          searchLatency: calculateLatencyMetrics(searchLatencies),
          qdrantAvailable: qdrantHealth.status !== 'unhealthy',
          resources: resourceBench.stop(),
        };
      } catch (error) {
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : String(error));
        result.metrics = { resources: resourceBench.stop() };
      }

      result.duration = Date.now() - (result as any)._startMs;
      results.push(result);
    }

    return results;
  }
}
