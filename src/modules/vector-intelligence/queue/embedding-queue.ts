import { randomUUID } from 'crypto';
import type { EmbeddingJob, EmbeddingJobResult } from '../types/index.js';
import { VECTOR_CONSTANTS } from '../constants/index.js';

type QueueProcessor = (job: EmbeddingJob) => Promise<EmbeddingJobResult>;

type QueueEvent = 'job:completed' | 'job:failed' | 'job:retrying';
type QueueEventHandler = (result: EmbeddingJobResult) => void;

export class EmbeddingQueue {
  private queue: EmbeddingJob[] = [];
  private processing = false;
  private processor: QueueProcessor | null = null;
  private eventHandlers = new Map<QueueEvent, QueueEventHandler[]>();
  private processingCount = 0;

  constructor(maxConcurrent?: number) {
    // maxConcurrent is kept for API compatibility but we process one at a time
    void maxConcurrent;
  }

  setProcessor(processor: QueueProcessor): void {
    this.processor = processor;
  }

  on(event: QueueEvent, handler: QueueEventHandler): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  private emit(event: QueueEvent, result: EmbeddingJobResult): void {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      handler(result);
    }
  }

  enqueue(job: Omit<EmbeddingJob, 'jobId' | 'createdAt' | 'retryCount' | 'maxRetries'>): string {
    const fullJob: EmbeddingJob = {
      ...job,
      jobId: randomUUID(),
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: VECTOR_CONSTANTS.QUEUE.MAX_RETRIES,
    };

    this.queue.push(fullJob);
    console.log(`[EmbeddingQueue] Enqueued ${job.entityType} ${job.entityId} (priority: ${job.priority})`);

    this.processNext().catch(err => {
      console.error('[EmbeddingQueue] Process loop error:', err);
    });

    return fullJob.jobId;
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (this.queue.length === 0) return;
    if (!this.processor) {
      console.warn('[EmbeddingQueue] No processor set, skipping queue');
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.processingCount++;

      try {
        const result = await this.processor(job);
        this.emit('job:completed', result);

        if (!result.success && job.retryCount < job.maxRetries) {
          job.retryCount++;
          this.emit('job:retrying', result);
          const delay = VECTOR_CONSTANTS.QUEUE.RETRY_DELAY_MS * Math.pow(2, job.retryCount - 1);
          await this.sleep(delay);
          this.queue.push(job);
        } else if (!result.success) {
          console.error(`[EmbeddingQueue] Job ${job.jobId} failed after ${job.maxRetries} retries: ${result.error}`);
        }
      } catch (error) {
        console.error(`[EmbeddingQueue] Job ${job.jobId} threw error:`, error);
        const failResult: EmbeddingJobResult = {
          jobId: job.jobId,
          entityType: job.entityType,
          entityId: job.entityId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: 0,
        };
        this.emit('job:failed', failResult);
      } finally {
        this.processingCount--;
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus(): { pending: number; processing: number } {
    return {
      pending: this.queue.length,
      processing: this.processingCount,
    };
  }

  cancelJob(jobId: string): boolean {
    const index = this.queue.findIndex(j => j.jobId === jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }
}

let globalQueue: EmbeddingQueue | null = null;

export function getGlobalQueue(): EmbeddingQueue {
  if (!globalQueue) {
    globalQueue = new EmbeddingQueue();
  }
  return globalQueue;
}
