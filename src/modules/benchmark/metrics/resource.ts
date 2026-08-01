export interface ResourceSnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssUsedMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

export function captureResourceSnapshot(): ResourceSnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    rssUsedMB: mem.rss / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
  };
}

export interface ResourceBenchmark {
  before: ResourceSnapshot;
  after: ResourceSnapshot;
  deltaHeapMB: number;
  deltaRssMB: number;
  peakHeapMB: number;
  peakRssMB: number;
}

export function startResourceBenchmark(): { stop: () => ResourceBenchmark } {
  const before = captureResourceSnapshot();
  let peakHeap = before.heapUsedMB;
  let peakRss = before.rssUsedMB;

  const interval = setInterval(() => {
    const snap = captureResourceSnapshot();
    if (snap.heapUsedMB > peakHeap) peakHeap = snap.heapUsedMB;
    if (snap.rssUsedMB > peakRss) peakRss = snap.rssUsedMB;
  }, 100);

  return {
    stop: () => {
      clearInterval(interval);
      const after = captureResourceSnapshot();
      return {
        before,
        after,
        deltaHeapMB: after.heapUsedMB - before.heapUsedMB,
        deltaRssMB: after.rssUsedMB - before.rssUsedMB,
        peakHeapMB: peakHeap,
        peakRssMB: peakRss,
      };
    },
  };
}
