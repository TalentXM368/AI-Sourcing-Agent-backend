import { registerEmbeddingWorker } from './embedding.worker.js';
import { registerIndexingWorker } from './indexing.worker.js';
import { registerMatchingWorker } from './matching.worker.js';
import { registerAIEvaluationWorker } from './ai-evaluation.worker.js';
import { registerPipelineWorker } from './pipeline.worker.js';

let workersStarted = false;

export function startAllWorkers(): void {
  if (workersStarted) return;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[Workers] REDIS_URL not set — workers disabled. Processing will run inline.');
    return;
  }

  console.log('[Workers] Starting all queue workers...');
  registerEmbeddingWorker();
  registerIndexingWorker();
  registerMatchingWorker();
  registerAIEvaluationWorker();
  registerPipelineWorker();
  workersStarted = true;
  console.log('[Workers] All workers started');
}

export async function stopAllWorkers(): Promise<void> {
  if (!workersStarted) return;
  console.log('[Workers] Stopping all workers...');
  const { closeAllQueues } = await import('../index.js');
  await closeAllQueues();
  workersStarted = false;
  console.log('[Workers] All workers stopped');
}

export async function getWorkerStats() {
  const { getQueueStats } = await import('../index.js');
  return getQueueStats();
}
