export interface BenchmarkResult {
  module: string;
  timestamp: string;
  duration: number;
  success: boolean;
  metrics: Record<string, unknown>;
  errors: string[];
  skipped: boolean;
  skipReason?: string;
}

export interface ModuleRunner {
  name: string;
  run(): Promise<BenchmarkResult>;
}

export function createBenchmarkResult(module: string, startMs: number): BenchmarkResult & { _startMs: number } {
  return {
    module,
    timestamp: new Date().toISOString(),
    duration: 0,
    success: true,
    metrics: {},
    errors: [],
    skipped: false,
    _startMs: startMs,
  };
}
