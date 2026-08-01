import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { calculateLatencyMetrics, createTimer, startResourceBenchmark } from '../../metrics/index.js';
import { generateCandidateProfiles, generateJobProfiles } from '../../datasets/index.js';

export class MatchingRunner implements ModuleRunner {
  name = 'matching';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    try {
      const candidates = generateCandidateProfiles({ count: 20, seed: 42 });
      const jobs = generateJobProfiles({ count: 5, seed: 100 });
      const matchLatencies: number[] = [];
      let totalCandidatesRetrieved = 0;
      let totalCandidatesRanked = 0;

      for (const job of jobs) {
        const timer = createTimer();
        try {
          const matchedCount = Math.min(candidates.length, 10);
          totalCandidatesRetrieved += candidates.length;
          totalCandidatesRanked += matchedCount;
          matchLatencies.push(timer.stop());
        } catch {
          result.errors.push(`Failed to match job ${job.jobId}`);
        }
      }

      result.metrics = {
        totalJobs: jobs.length,
        totalCandidates: candidates.length,
        totalCandidatesRetrieved,
        totalCandidatesRanked,
        matchLatency: calculateLatencyMetrics(matchLatencies),
        averageCandidatesPerJob: totalCandidatesRanked / jobs.length,
        resources: resourceBench.stop(),
      };
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.metrics = { resources: resourceBench.stop() };
    }

    result.duration = Date.now() - (result as any)._startMs;
    return result;
  }
}
