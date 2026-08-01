import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingQueue } from '../queue/embedding-queue.js';

describe('EmbeddingQueue', () => {
  let queue: EmbeddingQueue;

  beforeEach(() => {
    queue = new EmbeddingQueue();
  });

  it('starts with empty queue', () => {
    const status = queue.getQueueStatus();
    expect(status.pending).toBe(0);
    expect(status.processing).toBe(0);
  });

  it('enqueues jobs and returns jobId', () => {
    const jobId = queue.enqueue({
      entityType: 'candidate',
      entityId: 'test-id',
      priority: 'normal',
    });

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');

    const status = queue.getQueueStatus();
    expect(status.pending).toBe(1);
  });

  it('processes jobs when processor is set', async () => {
    const completedEntityIds: string[] = [];
    const processor = vi.fn().mockImplementation(async (job: { entityType: string; entityId: string }) => {
      completedEntityIds.push(job.entityId);
      return {
        jobId: 'test',
        entityType: job.entityType,
        entityId: job.entityId,
        success: true,
        durationMs: 100,
      };
    });

    queue.setProcessor(processor);

    queue.enqueue({
      entityType: 'candidate',
      entityId: 'candidate-1',
      priority: 'normal',
    });

    // Wait for processing to complete
    await vi.waitFor(() => {
      expect(completedEntityIds).toContain('candidate-1');
    }, { timeout: 2000 });
  });

  it('cancels pending jobs', () => {
    queue.enqueue({
      entityType: 'candidate',
      entityId: 'cancel-test',
      priority: 'normal',
    });

    const status = queue.getQueueStatus();
    expect(status.pending).toBe(1);

    // Get the jobId from the queue
    const jobId = (queue as unknown as { queue: Array<{ jobId: string }> }).queue[0].jobId;
    const cancelled = queue.cancelJob(jobId);

    expect(cancelled).toBe(true);

    const statusAfter = queue.getQueueStatus();
    expect(statusAfter.pending).toBe(0);
  });

  it('returns false when cancelling non-existent job', () => {
    const cancelled = queue.cancelJob('non-existent-id');
    expect(cancelled).toBe(false);
  });

  it('queues multiple jobs', () => {
    queue.enqueue({ entityType: 'candidate', entityId: 'c1', priority: 'normal' });
    queue.enqueue({ entityType: 'job', entityId: 'j1', priority: 'high' });
    queue.enqueue({ entityType: 'candidate', entityId: 'c2', priority: 'low' });

    const status = queue.getQueueStatus();
    expect(status.pending).toBe(3);
  });

  it('emits events via on()', async () => {
    const handler = vi.fn();
    queue.on('job:completed', handler);

    const processor = vi.fn().mockImplementation(async (job: { entityType: string; entityId: string }) => ({
      jobId: 'test',
      entityType: job.entityType,
      entityId: job.entityId,
      success: true,
      durationMs: 50,
    }));

    queue.setProcessor(processor);

    queue.enqueue({ entityType: 'candidate', entityId: 'evt-test', priority: 'normal' });

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('retries failed jobs', async () => {
    let callCount = 0;
    const processor = vi.fn().mockImplementation(async (job: { entityType: string; entityId: string }) => {
      callCount++;
      return {
        jobId: 'test',
        entityType: job.entityType,
        entityId: job.entityId,
        success: callCount >= 2,
        error: callCount < 2 ? 'Temporary failure' : undefined,
        durationMs: 100,
      };
    });

    queue.setProcessor(processor);

    const retryingHandler = vi.fn();
    queue.on('job:retrying', retryingHandler);

    queue.enqueue({ entityType: 'candidate', entityId: 'retry-test', priority: 'normal' });

    await vi.waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2);
    }, { timeout: 5000 });

    expect(retryingHandler).toHaveBeenCalled();
  });
});
