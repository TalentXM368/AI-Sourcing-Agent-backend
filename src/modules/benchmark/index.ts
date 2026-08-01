export { createBenchmarkRouter } from './routes/benchmark.routes.js';
export { getBenchmarkRouter } from './factory.js';

// Harness
export type { BenchmarkResult, ModuleRunner } from './harness/index.js';
export { createBenchmarkResult } from './harness/index.js';
export { StressRunner } from './harness/stress-runner.js';

// Module runners
export {
  CandidateIntelligenceRunner,
  JobIntelligenceRunner,
  VectorIntelligenceRunner,
  MatchingRunner,
  RecruiterIntelligenceRunner,
  DocumentIntelligenceRunner,
} from './harness/module-runners/index.js';

// Health
export { runHealthChecks, type ReadinessReport } from './health/readiness.js';
export {
  checkDatabase,
  checkQdrant,
  checkOpenAI,
  checkProviders,
  checkEnvironment,
  checkAPIRoutes,
  type HealthCheckResult,
} from './health/checks/index.js';

// Metrics
export {
  calculateLatencyMetrics,
  createTimer,
  calculatePrecisionRecall,
  calculateNDCG,
  calculateMAP,
  calculateAccuracy,
  calculateThroughput,
  captureResourceSnapshot,
  startResourceBenchmark,
} from './metrics/index.js';

// Datasets
export {
  generateCandidateProfiles,
  generateJobProfiles,
  createCandidateProfile,
  createJobProfile,
  createMatchResult,
} from './datasets/index.js';

// Reporters
export {
  generateMarkdownReport,
  generateJSONReport,
  generateCSVReport,
  generateHTMLReport,
} from './reporters/index.js';
