export interface ThroughputMetrics {
  operationsPerSecond: number;
  totalOperations: number;
  totalTimeMs: number;
  averageTimeMs: number;
}

export function calculateThroughput(
  totalOperations: number,
  totalTimeMs: number,
): ThroughputMetrics {
  return {
    operationsPerSecond: totalTimeMs > 0 ? (totalOperations / totalTimeMs) * 1000 : 0,
    totalOperations,
    totalTimeMs,
    averageTimeMs: totalOperations > 0 ? totalTimeMs / totalOperations : 0,
  };
}
