/**
 * Standalone benchmark report generator.
 * Run with: npx tsx scripts/run-benchmark.ts
 *
 * Generates an HTML report at backend/reports/benchmark-report-<timestamp>.html
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

async function main() {
  console.log('Running platform benchmarks...\n');

  // Dynamically import module runners to avoid circular deps
  const {
    CandidateIntelligenceRunner,
    JobIntelligenceRunner,
    VectorIntelligenceRunner,
    MatchingRunner,
    RecruiterIntelligenceRunner,
    DocumentIntelligenceRunner,
  } = await import('../src/modules/benchmark/harness/module-runners/index.js');
  const { runHealthChecks } = await import('../src/modules/benchmark/health/readiness.js');
  const { generateHTMLReport } = await import('../src/modules/benchmark/reporters/html.js');

  const runners: { name: string; runner: { run(): Promise<import('../src/modules/benchmark/harness/index.js').BenchmarkResult> } }[] = [
    { name: 'candidate-intelligence', runner: new CandidateIntelligenceRunner() },
    { name: 'job-intelligence', runner: new JobIntelligenceRunner() },
    { name: 'vector-intelligence', runner: new VectorIntelligenceRunner() },
    { name: 'matching', runner: new MatchingRunner() },
    { name: 'recruiter-intelligence', runner: new RecruiterIntelligenceRunner() },
    { name: 'document-intelligence', runner: new DocumentIntelligenceRunner() },
  ];

  const results: import('../src/modules/benchmark/harness/index.js').BenchmarkResult[] = [];

  for (const { name, runner } of runners) {
    process.stdout.write(`  Running ${name}... `);
    try {
      const result = await runner.run();
      results.push(result);
      if (result.skipped) {
        console.log(`SKIPPED (${result.skipReason})`);
      } else if (result.success) {
        console.log(`PASS (${result.duration}ms)`);
      } else {
        console.log(`FAIL (${result.errors.join('; ')})`);
      }
    } catch (error) {
      console.log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        module: name,
        timestamp: new Date().toISOString(),
        duration: 0,
        success: false,
        metrics: {},
        errors: [error instanceof Error ? error.message : String(error)],
        skipped: false,
      });
    }
  }

  console.log('\nRunning health checks...');
  const readiness = await runHealthChecks();
  console.log(`  Readiness: ${readiness.overallScore}/100 (${readiness.overallStatus})`);

  // Write HTML report
  const outputDir = resolve(__dirname, '../reports');
  try { mkdirSync(outputDir, { recursive: true }); } catch {}

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `benchmark-report-${timestamp}.html`;
  const filepath = resolve(outputDir, filename);

  const html = generateHTMLReport(results, readiness);
  writeFileSync(filepath, html, 'utf-8');

  console.log(`\nHTML report saved to: ${filepath}`);
  console.log(`\nSummary: ${results.filter(r => r.success && !r.skipped).length}/${results.length} passed, readiness ${readiness.overallScore}/100`);
}

main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
