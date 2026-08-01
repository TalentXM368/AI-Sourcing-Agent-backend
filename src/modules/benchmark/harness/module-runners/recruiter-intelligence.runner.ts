import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { startResourceBenchmark } from '../../metrics/index.js';
import { checkProviders } from '../../health/checks/index.js';

export class RecruiterIntelligenceRunner implements ModuleRunner {
  name = 'recruiter-intelligence';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    const providerHealth = await checkProviders();
    if (providerHealth.status === 'unhealthy') {
      result.skipped = true;
      result.skipReason = providerHealth.message;
      result.metrics = { resources: resourceBench.stop() };
      return result;
    }

    try {
      result.metrics = {
        providersStatus: providerHealth.status,
        providersConfigured: (providerHealth.details?.providers as Array<{ name: string; configured: boolean }>)?.filter(p => p.configured).map(p => p.name) || [],
        note: 'Full evaluation benchmark requires running backend server',
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
