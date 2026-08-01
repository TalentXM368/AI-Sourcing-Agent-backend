import { createBenchmarkRouter } from './routes/benchmark.routes.js';

let benchmarkRouter: ReturnType<typeof createBenchmarkRouter> | null = null;

export function getBenchmarkRouter() {
  if (!benchmarkRouter) {
    benchmarkRouter = createBenchmarkRouter();
  }
  return benchmarkRouter;
}
