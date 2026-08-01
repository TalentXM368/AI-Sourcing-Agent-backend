import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { calculateLatencyMetrics, createTimer, startResourceBenchmark } from '../../metrics/index.js';
import { generateCandidateProfiles } from '../../datasets/index.js';

export class CandidateIntelligenceRunner implements ModuleRunner {
  name = 'candidate-intelligence';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    try {
      const candidates = generateCandidateProfiles({ count: 20, seed: 42 });
      const latencies: number[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const candidate of candidates) {
        const timer = createTimer();
        try {
          const profileText = [
            candidate.personal.name.value,
            candidate.personal.headline?.value || '',
            candidate.personal.summary,
            candidate.skills.map(s => s.canonical).join(', '),
            candidate.experience.map(e => `${e.title.value} at ${e.company.value}`).join('; '),
          ].filter(Boolean).join('\n');

          latencies.push(timer.stop());
          successCount++;
        } catch {
          failCount++;
          result.errors.push(`Failed to process candidate ${candidate.candidateId}`);
        }
      }

      result.metrics = {
        totalCandidates: candidates.length,
        successCount,
        failCount,
        successRate: successCount / candidates.length,
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
