import { Router, Request, Response } from 'express';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { runHealthChecks } from '../health/readiness.js';
import {
  CandidateIntelligenceRunner,
  JobIntelligenceRunner,
  VectorIntelligenceRunner,
  MatchingRunner,
  RecruiterIntelligenceRunner,
  DocumentIntelligenceRunner,
} from '../harness/module-runners/index.js';
import { StressRunner } from '../harness/stress-runner.js';
import {
  generateMarkdownReport,
  generateJSONReport,
  generateCSVReport,
  generateHTMLReport,
} from '../reporters/index.js';

export function createBenchmarkRouter(): Router {
  const router = Router();

  // ─── GET /health ──────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', module: 'benchmark', timestamp: new Date().toISOString() });
  });

  // ─── GET /readiness ───────────────────────────────────────
  router.get('/readiness', async (_req: Request, res: Response) => {
    try {
      const report = await runHealthChecks();
      res.json(report);
    } catch (error) {
      res.status(500).json({
        error: 'Health check failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── POST /run ────────────────────────────────────────────
  router.post('/run', async (req: Request, res: Response) => {
    try {
      const modules = (req.body.modules as string[]) || [
        'candidate-intelligence',
        'job-intelligence',
        'vector-intelligence',
        'matching',
        'recruiter-intelligence',
        'document-intelligence',
      ];

      const runners = new Map<string, () => Promise<import('../harness/index.js').BenchmarkResult>>([
        ['candidate-intelligence', () => new CandidateIntelligenceRunner().run()],
        ['job-intelligence', () => new JobIntelligenceRunner().run()],
        ['vector-intelligence', () => new VectorIntelligenceRunner().run()],
        ['matching', () => new MatchingRunner().run()],
        ['recruiter-intelligence', () => new RecruiterIntelligenceRunner().run()],
        ['document-intelligence', () => new DocumentIntelligenceRunner().run()],
      ]);

      const results: import('../harness/index.js').BenchmarkResult[] = [];

      for (const mod of modules) {
        const runner = runners.get(mod);
        if (runner) {
          const result = await runner();
          results.push(result);
        } else {
          results.push({
            module: mod,
            timestamp: new Date().toISOString(),
            duration: 0,
            success: false,
            metrics: {},
            errors: [`Unknown module: ${mod}`],
            skipped: false,
          });
        }
      }

      const readiness = await runHealthChecks();

      const format = (req.body.format as string) || 'json';
      let output: string;
      let contentType: string;

      switch (format) {
        case 'markdown':
          output = generateMarkdownReport(results, readiness);
          contentType = 'text/markdown; charset=utf-8';
          break;
        case 'csv':
          output = generateCSVReport(results, readiness);
          contentType = 'text/csv; charset=utf-8';
          break;
        case 'html':
          output = generateHTMLReport(results, readiness);
          contentType = 'text/html; charset=utf-8';
          break;
        case 'json':
        default:
          res.json({ results, readiness });
          return;
      }

      res.setHeader('Content-Type', contentType);
      res.send(output);
    } catch (error) {
      res.status(500).json({
        error: 'Benchmark run failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── POST /stress ─────────────────────────────────────────
  router.post('/stress', async (req: Request, res: Response) => {
    try {
      const candidateCounts = (req.body.candidateCounts as number[]) || [100, 1000];
      const concurrentRequests = (req.body.concurrentRequests as number) || 1;

      const runner = new StressRunner();
      const results = await runner.run({ candidateCounts, concurrentRequests });

      res.json({ results });
    } catch (error) {
      res.status(500).json({
        error: 'Stress test failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── GET /report ──────────────────────────────────────────
  router.get('/report', async (req: Request, res: Response) => {
    try {
      const modules = [
        'candidate-intelligence',
        'job-intelligence',
        'vector-intelligence',
        'matching',
        'recruiter-intelligence',
        'document-intelligence',
      ];

      const runners = new Map<string, () => Promise<import('../harness/index.js').BenchmarkResult>>([
        ['candidate-intelligence', () => new CandidateIntelligenceRunner().run()],
        ['job-intelligence', () => new JobIntelligenceRunner().run()],
        ['vector-intelligence', () => new VectorIntelligenceRunner().run()],
        ['matching', () => new MatchingRunner().run()],
        ['recruiter-intelligence', () => new RecruiterIntelligenceRunner().run()],
        ['document-intelligence', () => new DocumentIntelligenceRunner().run()],
      ]);

      const results: import('../harness/index.js').BenchmarkResult[] = [];
      for (const mod of modules) {
        const runner = runners.get(mod);
        if (runner) {
          results.push(await runner());
        }
      }

      const readiness = await runHealthChecks();
      const format = (req.query.format as string) || 'markdown';

      let output: string;
      let contentType: string;

      switch (format) {
        case 'html':
          output = generateHTMLReport(results, readiness);
          contentType = 'text/html; charset=utf-8';
          break;
        case 'csv':
          output = generateCSVReport(results, readiness);
          contentType = 'text/csv; charset=utf-8';
          break;
        case 'json':
          output = generateJSONReport(results, readiness);
          contentType = 'application/json; charset=utf-8';
          break;
        case 'markdown':
        default:
          output = generateMarkdownReport(results, readiness);
          contentType = 'text/markdown; charset=utf-8';
          break;
      }

      res.setHeader('Content-Type', contentType);
      res.send(output);
    } catch (error) {
      res.status(500).json({
        error: 'Report generation failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── POST /save-report ──────────────────────────────────────
  // Run benchmarks and save HTML report to disk
  router.post('/save-report', async (req: Request, res: Response) => {
    try {
      const modules = (req.body.modules as string[]) || [
        'candidate-intelligence',
        'job-intelligence',
        'vector-intelligence',
        'matching',
        'recruiter-intelligence',
        'document-intelligence',
      ];

      const runners = new Map<string, () => Promise<import('../harness/index.js').BenchmarkResult>>([
        ['candidate-intelligence', () => new CandidateIntelligenceRunner().run()],
        ['job-intelligence', () => new JobIntelligenceRunner().run()],
        ['vector-intelligence', () => new VectorIntelligenceRunner().run()],
        ['matching', () => new MatchingRunner().run()],
        ['recruiter-intelligence', () => new RecruiterIntelligenceRunner().run()],
        ['document-intelligence', () => new DocumentIntelligenceRunner().run()],
      ]);

      const results: import('../harness/index.js').BenchmarkResult[] = [];
      for (const mod of modules) {
        const runner = runners.get(mod);
        if (runner) {
          results.push(await runner());
        }
      }

      const readiness = await runHealthChecks();
      const format = (req.body.format as string) || 'html';

      // Ensure output directory exists
      const outputDir = resolve(__dirname, '../reports');
      try { mkdirSync(outputDir, { recursive: true }); } catch {}

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `benchmark-report-${timestamp}.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : format}`;
      const filepath = resolve(outputDir, filename);

      let content: string;
      switch (format) {
        case 'html':
          content = generateHTMLReport(results, readiness);
          break;
        case 'markdown':
          content = generateMarkdownReport(results, readiness);
          break;
        case 'csv':
          content = generateCSVReport(results, readiness);
          break;
        case 'json':
          content = generateJSONReport(results, readiness);
          break;
        default:
          content = generateHTMLReport(results, readiness);
      }

      writeFileSync(filepath, content, 'utf-8');

      res.json({
        success: true,
        filepath,
        filename,
        format,
        readinessScore: readiness.overallScore,
        modulesTested: results.length,
        modulesPassed: results.filter(r => r.success && !r.skipped).length,
        modulesFailed: results.filter(r => !r.success).length,
        modulesSkipped: results.filter(r => r.skipped).length,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Save report failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
