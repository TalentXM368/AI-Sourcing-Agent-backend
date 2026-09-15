import type { BenchmarkResult } from '../harness/index.js';
import type { ReadinessReport } from '../health/readiness.js';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusClass(status: string): string {
  return `status-${status}`;
}

function badgeClass(result: BenchmarkResult): string {
  if (result.skipped) return 'badge-skip';
  return result.success ? 'badge-pass' : 'badge-fail';
}

function badgeLabel(result: BenchmarkResult): string {
  if (result.skipped) return 'Skipped';
  return result.success ? 'Pass' : 'Fail';
}

function renderLatencyTable(latency: Record<string, unknown> | undefined, label: string): string {
  if (!latency || typeof latency !== 'object') return '';
  const l = latency as Record<string, number>;
  if (!l.count || l.count === 0) return '';

  return `
    <div class="metric-group">
      <h4>${escapeHtml(label)}</h4>
      <div class="latency-grid">
        <div class="latency-item"><span class="latency-label">Samples</span><span class="latency-value">${l.count}</span></div>
        <div class="latency-item"><span class="latency-label">Min</span><span class="latency-value">${l.min?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">Mean</span><span class="latency-value">${l.mean?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">Median</span><span class="latency-value">${l.median?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">Max</span><span class="latency-value">${l.max?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">P95</span><span class="latency-value">${l.p95?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">P99</span><span class="latency-value">${l.p99?.toFixed(2)}ms</span></div>
        <div class="latency-item"><span class="latency-label">StdDev</span><span class="latency-value">${l.stdDev?.toFixed(2)}ms</span></div>
      </div>
    </div>`;
}

function renderResourceTable(resources: Record<string, unknown> | undefined): string {
  if (!resources || typeof resources !== 'object') return '';
  const r = resources as Record<string, unknown>;

  const before = r.before as Record<string, number> | undefined;
  const after = r.after as Record<string, number> | undefined;

  return `
    <div class="metric-group">
      <h4>Resource Utilization</h4>
      <div class="resource-grid">
        <div class="resource-item">
          <span class="resource-label">Heap Delta</span>
          <span class="resource-value ${(r.deltaHeapMB as number) > 10 ? 'text-red' : (r.deltaHeapMB as number) > 5 ? 'text-yellow' : 'text-green'}">${typeof r.deltaHeapMB === 'number' ? (r.deltaHeapMB as number).toFixed(2) + 'MB' : '-'}</span>
        </div>
        <div class="resource-item">
          <span class="resource-label">RSS Delta</span>
          <span class="resource-value ${(r.deltaRssMB as number) > 20 ? 'text-red' : (r.deltaRssMB as number) > 10 ? 'text-yellow' : 'text-green'}">${typeof r.deltaRssMB === 'number' ? (r.deltaRssMB as number).toFixed(2) + 'MB' : '-'}</span>
        </div>
        <div class="resource-item">
          <span class="resource-label">Peak Heap</span>
          <span class="resource-value">${typeof r.peakHeapMB === 'number' ? (r.peakHeapMB as number).toFixed(2) + 'MB' : '-'}</span>
        </div>
        <div class="resource-item">
          <span class="resource-label">Peak RSS</span>
          <span class="resource-value">${typeof r.peakRssMB === 'number' ? (r.peakRssMB as number).toFixed(2) + 'MB' : '-'}</span>
        </div>
      </div>
      ${before && after ? `
      <div class="resource-snapshot">
        <span class="snapshot-label">Before:</span> Heap ${before.heapUsedMB?.toFixed(1)}MB / RSS ${before.rssUsedMB?.toFixed(1)}MB
        &rarr;
        <span class="snapshot-label">After:</span> Heap ${after.heapUsedMB?.toFixed(1)}MB / RSS ${after.rssUsedMB?.toFixed(1)}MB
      </div>` : ''}
    </div>`;
}

function renderModuleDetails(result: BenchmarkResult): string {
  const m = result.metrics as Record<string, unknown>;
  const moduleId = escapeHtml(result.module);

  let details = '';

  switch (result.module) {
    case 'candidate-intelligence': {
      const successCount = m.successCount as number;
      const failCount = m.failCount as number;
      const totalCandidates = m.totalCandidates as number;
      const successRate = m.successRate as number;
      details = `
        <div class="metric-group">
          <h4>Parsing Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Total Candidates</span><span class="metric-value">${totalCandidates ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Parsed Successfully</span><span class="metric-value text-green">${successCount ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Failed</span><span class="metric-value ${failCount > 0 ? 'text-red' : 'text-green'}">${failCount ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Success Rate</span><span class="metric-value">${typeof successRate === 'number' ? (successRate * 100).toFixed(1) + '%' : '-'}</span></div>
          </div>
        </div>
        ${renderLatencyTable(m.latency as Record<string, unknown>, 'Parse Latency Distribution')}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    case 'job-intelligence': {
      const successCount = m.successCount as number;
      const failCount = m.failCount as number;
      const totalJobs = m.totalJobs as number;
      const successRate = m.successRate as number;
      details = `
        <div class="metric-group">
          <h4>Job Profile Generation Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Total Jobs</span><span class="metric-value">${totalJobs ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Generated Successfully</span><span class="metric-value text-green">${successCount ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Failed</span><span class="metric-value ${failCount > 0 ? 'text-red' : 'text-green'}">${failCount ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Success Rate</span><span class="metric-value">${typeof successRate === 'number' ? (successRate * 100).toFixed(1) + '%' : '-'}</span></div>
          </div>
        </div>
        ${renderLatencyTable(m.latency as Record<string, unknown>, 'Profile Generation Latency Distribution')}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    case 'vector-intelligence': {
      const qdrantStatus = m.qdrantStatus as string;
      const qdrantLatency = m.qdrantLatency as number;
      const searchConsistency = m.searchConsistency as number;
      details = `
        <div class="metric-group">
          <h4>Vector Search Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Qdrant Status</span><span class="metric-value ${statusClass(qdrantStatus === 'healthy' ? 'healthy' : 'unhealthy')}">${qdrantStatus ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Qdrant Latency</span><span class="metric-value">${typeof qdrantLatency === 'number' ? qdrantLatency.toFixed(0) + 'ms' : '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Search Consistency</span><span class="metric-value">${typeof searchConsistency === 'number' ? (searchConsistency * 100).toFixed(1) + '%' : '-'}</span></div>
          </div>
        </div>
        ${renderLatencyTable(m.searchLatency as Record<string, unknown>, 'Search Latency Distribution')}
        ${renderLatencyTable(m.indexLatency as Record<string, unknown>, 'Index Latency Distribution')}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    case 'matching': {
      const totalJobs = m.totalJobs as number;
      const totalCandidates = m.totalCandidates as number;
      const totalCandidatesRetrieved = m.totalCandidatesRetrieved as number;
      const totalCandidatesRanked = m.totalCandidatesRanked as number;
      const averageCandidatesPerJob = m.averageCandidatesPerJob as number;
      details = `
        <div class="metric-group">
          <h4>Matching Engine Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Total Jobs Scored</span><span class="metric-value">${totalJobs ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Total Candidates</span><span class="metric-value">${totalCandidates ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Candidates Retrieved</span><span class="metric-value">${totalCandidatesRetrieved ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Candidates Ranked</span><span class="metric-value">${totalCandidatesRanked ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Avg Candidates/Job</span><span class="metric-value">${typeof averageCandidatesPerJob === 'number' ? averageCandidatesPerJob.toFixed(1) : '-'}</span></div>
          </div>
        </div>
        ${renderLatencyTable(m.matchLatency as Record<string, unknown>, 'Match Latency Distribution')}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    case 'recruiter-intelligence': {
      const providersStatus = m.providersStatus as string;
      const providersConfigured = m.providersConfigured as string[];
      const note = m.note as string;
      details = `
        <div class="metric-group">
          <h4>AI Recruiter Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Providers Status</span><span class="metric-value ${statusClass(providersStatus === 'healthy' ? 'healthy' : providersStatus === 'degraded' ? 'degraded' : 'unhealthy')}">${providersStatus ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Active Providers</span><span class="metric-value">${providersConfigured?.join(', ') || 'None'}</span></div>
          </div>
        </div>
        ${note ? `<div class="note-box">${escapeHtml(note)}</div>` : ''}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    case 'document-intelligence': {
      const db = m.database as string;
      const qdrant = m.qdrant as string;
      const openai = m.openai as string;
      const providers = m.providers as string;
      const note = m.note as string;
      details = `
        <div class="metric-group">
          <h4>Document Intelligence Output</h4>
          <div class="metric-grid">
            <div class="metric-item"><span class="metric-label">Database</span><span class="metric-value ${statusClass(db === 'healthy' ? 'healthy' : 'unhealthy')}">${db ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">Qdrant</span><span class="metric-value ${statusClass(qdrant === 'healthy' ? 'healthy' : 'unhealthy')}">${qdrant ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">OpenAI</span><span class="metric-value ${statusClass(openai === 'healthy' ? 'healthy' : 'unhealthy')}">${openai ?? '-'}</span></div>
            <div class="metric-item"><span class="metric-label">AI Providers</span><span class="metric-value ${statusClass(providers === 'healthy' ? 'healthy' : 'unhealthy')}">${providers ?? '-'}</span></div>
          </div>
        </div>
        ${note ? `<div class="note-box">${escapeHtml(note)}</div>` : ''}
        ${renderResourceTable(m.resources as Record<string, unknown>)}`;
      break;
    }

    default: {
      details = `
        <div class="metric-group">
          <h4>Raw Metrics</h4>
          <pre class="json-dump">${escapeHtml(JSON.stringify(m, null, 2))}</pre>
        </div>`;
    }
  }

  if (result.errors.length > 0) {
    details += `
      <div class="error-box">
        <h4>Errors (${result.errors.length})</h4>
        <ul>${result.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      </div>`;
  }

  return details;
}

export function generateHTMLReport(
  results: BenchmarkResult[],
  readiness: ReadinessReport,
): string {
  const passed = results.filter(r => r.success && !r.skipped).length;
  const failed = results.filter(r => !r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  const passedModules = results.filter(r => r.success && !r.skipped);
  const failedModules = results.filter(r => !r.success);
  const skippedModules = results.filter(r => r.skipped);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Platform Benchmark Report — ${new Date().toLocaleDateString()}</title>
<style>
  :root {
    --green: #22c55e;
    --green-bg: #dcfce7;
    --yellow: #eab308;
    --yellow-bg: #fef9c3;
    --red: #ef4444;
    --red-bg: #fef2f2;
    --gray: #6b7280;
    --gray-bg: #f3f4f6;
    --blue: #3b82f6;
    --blue-bg: #dbeafe;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
  .container { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }

  /* Header */
  .header { margin-bottom: 40px; }
  .header h1 { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
  .header .subtitle { color: #64748b; font-size: 14px; }

  /* Navigation */
  .nav { display: flex; gap: 8px; margin-bottom: 32px; flex-wrap: wrap; }
  .nav a { padding: 6px 14px; border-radius: 6px; background: white; color: #475569; text-decoration: none; font-size: 13px; font-weight: 500; border: 1px solid #e2e8f0; transition: all 0.15s; }
  .nav a:hover { background: #f1f5f9; border-color: #cbd5e1; }

  /* Summary Cards */
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 40px; }
  .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); border: 1px solid #f1f5f9; }
  .card h3 { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600; }
  .card .value { font-size: 36px; font-weight: 700; line-height: 1.1; }
  .card .detail { font-size: 13px; color: #64748b; margin-top: 4px; }
  .text-green { color: var(--green); }
  .text-yellow { color: var(--yellow); }
  .text-red { color: var(--red); }
  .text-gray { color: var(--gray); }

  /* Readiness Bar */
  .readiness-bar { margin-bottom: 40px; }
  .readiness-bar h2 { font-size: 18px; margin-bottom: 12px; }
  .bar-track { height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  .bar-fill { height: 100%; border-radius: 6px; transition: width 0.3s; }
  .bar-fill.ready { background: var(--green); }
  .bar-fill.degraded { background: var(--yellow); }
  .bar-fill.not-ready { background: var(--red); }
  .bar-labels { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; }

  /* Blockers */
  .blockers { background: var(--red-bg); border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 40px; }
  .blockers h3 { color: #991b1b; margin-bottom: 10px; font-size: 16px; }
  .blockers li { margin-left: 20px; color: #991b1b; margin-bottom: 4px; }

  /* Section */
  .section { margin-bottom: 40px; }
  .section h2 { font-size: 22px; font-weight: 700; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }

  /* Table */
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #f1f5f9; }
  th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid #f1f5f9; }
  th { background: #f8fafc; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
  td { font-size: 14px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f8fafc; }
  .status-healthy { color: var(--green); font-weight: 600; }
  .status-degraded { color: var(--yellow); font-weight: 600; }
  .status-unhealthy { color: var(--red); font-weight: 600; }

  /* Badges */
  .badge { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
  .badge-pass { background: var(--green-bg); color: #166534; }
  .badge-fail { background: var(--red-bg); color: #991b1b; }
  .badge-skip { background: var(--gray-bg); color: #6b7280; }

  /* Module Cards */
  .module-card { background: white; border-radius: 12px; border: 1px solid #f1f5f9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px; overflow: hidden; }
  .module-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid #f1f5f9; }
  .module-header h3 { font-size: 18px; font-weight: 600; }
  .module-header .module-meta { display: flex; gap: 16px; align-items: center; font-size: 13px; color: #64748b; }
  .module-body { padding: 24px; }

  /* Metric Grid */
  .metric-group { margin-bottom: 20px; }
  .metric-group h4 { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .metric-item { background: #f8fafc; border-radius: 8px; padding: 14px 16px; border: 1px solid #f1f5f9; }
  .metric-label { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
  .metric-value { font-size: 20px; font-weight: 700; color: #1e293b; }

  /* Latency Grid */
  .latency-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .latency-item { background: #f8fafc; border-radius: 8px; padding: 10px 14px; border: 1px solid #f1f5f9; text-align: center; }
  .latency-label { display: block; font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; }
  .latency-value { font-size: 15px; font-weight: 600; color: #1e293b; font-variant-numeric: tabular-nums; }

  /* Resource Grid */
  .resource-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .resource-item { background: #f8fafc; border-radius: 8px; padding: 12px 14px; border: 1px solid #f1f5f9; text-align: center; }
  .resource-label { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
  .resource-value { font-size: 16px; font-weight: 600; color: #1e293b; }
  .resource-snapshot { font-size: 12px; color: #64748b; padding: 8px 12px; background: #f8fafc; border-radius: 6px; }
  .snapshot-label { font-weight: 600; }

  /* Notes / Errors */
  .note-box { background: var(--blue-bg); border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #1e40af; margin-bottom: 16px; }
  .error-box { background: var(--red-bg); border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin-top: 16px; }
  .error-box h4 { color: #991b1b; margin-bottom: 8px; font-size: 13px; }
  .error-box ul { margin-left: 18px; color: #991b1b; font-size: 13px; }
  .error-box li { margin-bottom: 4px; }

  /* JSON dump */
  .json-dump { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; font-size: 12px; font-family: 'JetBrains Mono', 'Fira Code', monospace; overflow-x: auto; line-height: 1.5; max-height: 400px; overflow-y: auto; }

  /* Recommendations */
  .recommendation-card { background: white; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .recommendation-card h3 { font-size: 16px; margin-bottom: 12px; }
  .recommendation-card ul { margin-left: 20px; }
  .recommendation-card li { margin-bottom: 8px; font-size: 14px; color: #475569; }

  /* Collapsible */
  details { margin-bottom: 16px; }
  details summary { cursor: pointer; font-size: 13px; color: #3b82f6; font-weight: 500; padding: 6px 0; }
  details summary:hover { color: #2563eb; }

  /* Footer */
  .footer { text-align: center; padding: 32px 0 16px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; margin-top: 40px; }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>Platform Benchmark Report</h1>
    <p class="subtitle">Generated: ${new Date().toISOString()} &mdash; AI SourcingXM &mdash; Phase 6.5 Validation Suite</p>
  </div>

  <!-- Navigation -->
  <nav class="nav">
    <a href="#summary">Summary</a>
    <a href="#readiness">Readiness</a>
    <a href="#health">Health Checks</a>
    <a href="#modules">Module Results</a>
    <a href="#recommendations">Recommendations</a>
    <a href="#raw">Raw Data</a>
  </nav>

  <!-- Summary Cards -->
  <div class="summary" id="summary">
    <div class="card">
      <h3>Readiness Score</h3>
      <div class="value ${readiness.overallScore >= 80 ? 'text-green' : readiness.overallScore >= 50 ? 'text-yellow' : 'text-red'}">${readiness.overallScore}/100</div>
      <div class="detail">${readiness.overallStatus.toUpperCase()}</div>
    </div>
    <div class="card">
      <h3>Modules Tested</h3>
      <div class="value">${results.length}</div>
      <div class="detail">${passed} passed, ${failed} failed, ${skipped} skipped</div>
    </div>
    <div class="card">
      <h3>Total Duration</h3>
      <div class="value">${(totalDuration / 1000).toFixed(1)}s</div>
      <div class="detail">Across all modules</div>
    </div>
    <div class="card">
      <h3>Services Healthy</h3>
      <div class="value ${readiness.checks.filter(c => c.status === 'healthy').length === readiness.checks.length ? 'text-green' : 'text-yellow'}">${readiness.checks.filter(c => c.status === 'healthy').length}/${readiness.checks.length}</div>
      <div class="detail">Health checks passed</div>
    </div>
    ${readiness.blockers.length > 0 ? `
    <div class="card" style="grid-column: span 2;">
      <h3>Blockers</h3>
      <div class="value text-red">${readiness.blockers.length}</div>
      <div class="detail">${readiness.blockers[0]}</div>
    </div>` : ''}
  </div>

  <!-- Readiness Bar -->
  <div class="readiness-bar" id="readiness">
    <h2>Production Readiness</h2>
    <div class="bar-track">
      <div class="bar-fill ${readiness.overallStatus}" style="width: ${readiness.overallScore}%"></div>
    </div>
    <div class="bar-labels">
      <span>0 (Not Ready)</span>
      <span>50 (Degraded)</span>
      <span>80 (Ready)</span>
      <span>100 (Full)</span>
    </div>
  </div>

  ${readiness.blockers.length > 0 ? `
  <div class="blockers">
    <h3>Blockers (${readiness.blockers.length})</h3>
    <ul>${readiness.blockers.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  </div>` : ''}

  <!-- Health Checks -->
  <div class="section" id="health">
    <h2>Health Checks</h2>
    <table>
      <thead>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Latency</th>
          <th>Message</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${readiness.checks.map(c => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td><span class="status-${c.status}">${c.status === 'healthy' ? 'Healthy' : c.status === 'degraded' ? 'Degraded' : 'Unhealthy'}</span></td>
          <td>${c.latencyMs.toFixed(0)}ms</td>
          <td>${escapeHtml(c.message)}</td>
          <td>${c.details ? `<details><summary>View details</summary><pre class="json-dump">${escapeHtml(JSON.stringify(c.details, null, 2))}</pre></details>` : '-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Module Results -->
  <div class="section" id="modules">
    <h2>Module Results (${passed} passed / ${failed} failed / ${skipped} skipped)</h2>
    ${results.map(r => `
    <div class="module-card">
      <div class="module-header">
        <div>
          <h3>${escapeHtml(r.module)}</h3>
        </div>
        <div class="module-meta">
          <span class="badge ${badgeClass(r)}">${badgeLabel(r)}</span>
          <span>${r.duration}ms</span>
          ${r.skipped && r.skipReason ? `<span style="color:#94a3b8;">${escapeHtml(r.skipReason)}</span>` : ''}
        </div>
      </div>
      <div class="module-body">
        ${renderModuleDetails(r)}
      </div>
    </div>`).join('')}
  </div>

  <!-- Recommendations -->
  <div class="section" id="recommendations">
    <h2>Recommendations</h2>
    <div class="recommendation-card">
      ${readiness.overallScore >= 80 ? `
      <h3 style="color:var(--green);">Platform is Production Ready</h3>
      <ul>
        <li>All critical services are healthy and responding.</li>
        <li>${passed}/${results.length} modules passed benchmarks successfully.</li>
        <li>You can proceed with frontend development and production deployment.</li>
        <li>Run stress tests periodically to validate under load.</li>
        <li>Monitor resource usage patterns during real-world usage.</li>
      </ul>` : readiness.overallScore >= 50 ? `
      <h3 style="color:var(--yellow);">Platform is Partially Ready</h3>
      <ul>
        <li>${passed}/${results.length} modules passed, but some services are degraded.</li>
        <li>Address the ${readiness.blockers.length} blocker(s) before production deployment.</li>
        <li>Consider running with reduced functionality for non-critical features.</li>
        <li>Set up monitoring and alerting for degraded services.</li>
      </ul>` : `
      <h3 style="color:var(--red);">Platform is Not Ready</h3>
      <ul>
        <li>Critical issues must be resolved before deployment.</li>
        <li>Focus on fixing the ${readiness.blockers.length} blocker(s) first.</li>
        <li>Re-run benchmarks after fixes to verify resolution.</li>
      </ul>`}
      ${failedModules.length > 0 ? `
      <h4 style="margin-top:16px;color:#991b1b;">Failed Modules</h4>
      <ul>${failedModules.map(m => `<li><strong>${escapeHtml(m.module)}</strong>: ${m.errors.join('; ')}</li>`).join('')}</ul>` : ''}
      ${skippedModules.length > 0 ? `
      <h4 style="margin-top:16px;color:#64748b;">Skipped Modules</h4>
      <ul>${skippedModules.map(m => `<li><strong>${escapeHtml(m.module)}</strong>: ${escapeHtml(m.skipReason || 'No reason given')}</li>`).join('')}</ul>` : ''}
    </div>
  </div>

  <!-- Raw Data -->
  <div class="section" id="raw">
    <h2>Raw Data</h2>
    <details>
      <summary>Expand full JSON dump</summary>
      <pre class="json-dump">${escapeHtml(JSON.stringify({ readiness, benchmarks: results.map(r => { const { _startMs, ...rest } = r as any; return rest; }) }, null, 2))}</pre>
    </details>
  </div>

  <!-- Footer -->
  <div class="footer">
    AI SourcingXM &mdash; Benchmark Suite v1.0 &mdash; Generated ${new Date().toISOString()}
  </div>

</div>
</body>
</html>`;
}
