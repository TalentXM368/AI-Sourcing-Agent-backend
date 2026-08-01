import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { calculateLatencyMetrics, startResourceBenchmark } from '../../metrics/index.js';
import { checkQdrant } from '../../health/checks/index.js';

export class VectorIntelligenceRunner implements ModuleRunner {
  name = 'vector-intelligence';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    const qdrantHealth = await checkQdrant();
    if (qdrantHealth.status === 'unhealthy') {
      result.skipped = true;
      result.skipReason = qdrantHealth.message;
      result.metrics = { resources: resourceBench.stop() };
      return result;
    }

    try {
      const searchLatencies: number[] = [];
      const indexLatencies: number[] = [];
      const searchConsistencyScores: number[] = [];

      result.metrics = {
        qdrantStatus: qdrantHealth.status,
        qdrantLatency: qdrantHealth.latencyMs,
        searchLatency: calculateLatencyMetrics(searchLatencies),
        indexLatency: calculateLatencyMetrics(indexLatencies),
        searchConsistency: searchConsistencyScores.length > 0
          ? searchConsistencyScores.reduce((a, b) => a + b, 0) / searchConsistencyScores.length
          : 0,
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
