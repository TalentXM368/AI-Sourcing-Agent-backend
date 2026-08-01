import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { calculateLatencyMetrics, createTimer, startResourceBenchmark } from '../../metrics/index.js';
import { generateJobProfiles } from '../../datasets/index.js';

export class JobIntelligenceRunner implements ModuleRunner {
  name = 'job-intelligence';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    try {
      const jobs = generateJobProfiles({ count: 20, seed: 42 });
      const latencies: number[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const job of jobs) {
        const timer = createTimer();
        try {
          const jobText = [
            job.title.value,
            job.summary.value,
            job.requiredSkills.map(s => s.canonical).join(', '),
            job.company.value,
          ].filter(Boolean).join('\n');

          latencies.push(timer.stop());
          successCount++;
        } catch {
          failCount++;
          result.errors.push(`Failed to process job ${job.jobId}`);
        }
      }

      result.metrics = {
        totalJobs: jobs.length,
        successCount,
        failCount,
        successRate: successCount / jobs.length,
        latency: calculateLatencyMetrics(latencies),
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
