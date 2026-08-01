import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import { getRedisConnection, closeRedisConnection } from './connection.js';
import type { JobType, QueueJobData } from './job-types.js';

const QUEUE_NAMES = ['embedding', 'indexing', 'matching', 'ai-evaluation', 'pipeline'] as const;

type QueueName = typeof QUEUE_NAMES[number];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 86400, count: 50 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

const queues: Map<QueueName, Queue> = new Map();
const workers: Map<QueueName, Worker> = new Map();
const queueEvents: Map<QueueName, QueueEvents> = new Map();

function getQueueName(jobType: JobType): QueueName {
  switch (jobType) {
    case 'embedding-generation': return 'embedding';
    case 'candidate-indexing':
    case 'job-indexing':
    case 'indexing': return 'indexing';
    case 'matching': return 'matching';
    case 'ai-evaluation': return 'ai-evaluation';
    case 'pipeline': return 'pipeline';
  }
}

export function getQueue(jobType: JobType): Queue {
  const queueName = getQueueName(jobType);
  if (!queues.has(queueName)) {
    queues.set(queueName, new Queue(queueName, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }));
  }
  return queues.get(queueName)!;
}

export async function enqueueJob(jobType: JobType, data: QueueJobData, opts?: JobsOptions) {
  const queue = getQueue(jobType);
  const job = await queue.add(jobType, data, opts);
  console.log(`[Queue] Enqueued ${jobType} job ${job.id} for ${JSON.stringify(data)}`);
  return job;
}

export function registerWorker(
  jobType: JobType,
  processor: (data: QueueJobData) => Promise<unknown>,
): Worker {
  const queueName = getQueueName(jobType);

  if (workers.has(queueName)) {
    workers.get(queueName)!.close();
  }

  const worker = new Worker(queueName, async (job) => {
    console.log(`[Worker:${queueName}] Processing ${job.name} job ${job.id}`);
    try {
      const result = await processor(job.data as QueueJobData);
      console.log(`[Worker:${queueName}] Completed ${job.name} job ${job.id}`);
      return result;
    } catch (error) {
      console.error(`[Worker:${queueName}] Failed ${job.name} job ${job.id}:`, error);
      throw error;
    }
  }, {
    connection: getRedisConnection(),
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker:${queueName}] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker:${queueName}] Job ${job.id} completed in ${job.finishedOn ? job.finishedOn - (job.processedOn || 0) : 0}ms`);
  });

  workers.set(queueName, worker);

  const events = new QueueEvents(queueName, { connection: getRedisConnection() });
  queueEvents.set(queueName, events);

  return worker;
}

export async function closeAllQueues(): Promise<void> {
  for (const [, worker] of workers) {
    await worker.close();
  }
  for (const [, queue] of queues) {
    await queue.close();
  }
  for (const [, events] of queueEvents) {
    await events.close();
  }
  await closeRedisConnection();
  queues.clear();
  workers.clear();
  queueEvents.clear();
}

export async function getQueueStats(): Promise<Record<QueueName, { waiting: number; active: number; completed: number; failed: number }>> {
  const stats = {} as Record<QueueName, { waiting: number; active: number; completed: number; failed: number }>;
  for (const queueName of QUEUE_NAMES) {
    if (queues.has(queueName)) {
      const queue = queues.get(queueName)!;
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);
      stats[queueName] = { waiting, active, completed, failed };
    } else {
      stats[queueName] = { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
  }
  return stats;
}
