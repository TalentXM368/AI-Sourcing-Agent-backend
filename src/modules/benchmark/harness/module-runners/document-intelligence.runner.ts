import type { BenchmarkResult, ModuleRunner } from '../index.js';
import { createBenchmarkResult } from '../index.js';
import { startResourceBenchmark } from '../../metrics/index.js';
import { checkDatabase, checkQdrant, checkOpenAI, checkProviders } from '../../health/checks/index.js';

export class DocumentIntelligenceRunner implements ModuleRunner {
  name = 'document-intelligence';

  async run(): Promise<BenchmarkResult> {
    const result = createBenchmarkResult(this.name, Date.now());
    const resourceBench = startResourceBenchmark();

    try {
      const dbHealth = await checkDatabase();
      const qdrantHealth = await checkQdrant();
      const openaiHealth = await checkOpenAI();
      const providerHealth = await checkProviders();

      result.metrics = {
        database: dbHealth.status,
        qdrant: qdrantHealth.status,
        openai: openaiHealth.status,
        providers: providerHealth.status,
        note: 'Document parsing benchmark requires file uploads via /api/benchmark/parse-existing',
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
