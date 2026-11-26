/**
 * Candidate Trust (Fake Candidate Check + Resume Check) maintenance script. Rules only, no AI.
 * Only candidates a user chose (saved to a project, uploaded in Trust Check, or checked
 * manually) are ever checked; everyone else is comparison data.
 *
 *   npx tsx scripts/run-trust-check.ts migrate
 *       Create the tables (safe to re-run).
 *
 *   npx tsx scripts/run-trust-check.ts fingerprints
 *       Compute comparison keys for new/changed parsed candidates. First run covers everyone.
 *
 *   npx tsx scripts/run-trust-check.ts nightly
 *       fingerprints + re-check every candidate in the Trust Check queue (new resumes can
 *       create new matches). Used by nightly-import.mjs.
 *
 *   npx tsx scripts/run-trust-check.ts check <candidateId> [...more ids]
 *       Check specific candidates now (adds them to the Trust Check queue).
 *
 *   npx tsx scripts/run-trust-check.ts audit [--type fake|resume|all] [--limit N]
 *       Analysis only: evaluate ALL parsed candidates in memory and write a report to
 *       logs/trust-audit-<time>.json. Writes nothing to the database.
 *
 * Run with NODE_OPTIONS=--max-old-space-size=2048 on this PC.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pool } from '../src/db/index.js';
import {
  buildFullIndex, evaluateCandidate, recheckTrackedCandidates, refreshStaleFingerprints, runTrustCheck,
  TRUST_RULE_VERSION, type TrustSection, type TrustSignal,
} from '../src/modules/candidate-trust/index.js';

const MIGRATION = resolve(__dirname, '../prisma/migrations/20261125120000_candidate_trust/migration.sql');
const SAMPLES_PER_TYPE = 15;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const log = (msg: string) => console.log(`[trust ${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function requireTables(): Promise<void> {
  const { rows } = await pool.query(`SELECT to_regclass('public.trust_signals') AS t, to_regclass('public.candidate_fingerprints') AS f`);
  if (!rows[0].t || !rows[0].f) throw new Error('trust tables are missing. Run: npx tsx scripts/run-trust-check.ts migrate');
}

async function fingerprints(): Promise<void> {
  await requireTables();
  const n = await refreshStaleFingerprints(pool, { onProgress: done => { if (done % 2000 === 0) log(`fingerprinted ${done}`); } });
  log(`fingerprints refreshed for ${n} candidate(s)`);
}

async function nightly(): Promise<void> {
  await fingerprints();
  const r = await recheckTrackedCandidates(pool, (done, total) => log(`re-checked ${done}/${total}`));
  log(`nightly re-check done: ${r.checked} candidate(s), ${r.signals} signal(s)`);
}

async function check(ids: string[]): Promise<void> {
  await requireTables();
  if (!ids.length) throw new Error('give at least one candidate id');
  const s = await runTrustCheck(pool, ids, { trigger: 'manual' });
  log(`checked ${s.checked} (not parsed: ${s.notParsed.length}) → ${s.signals} signals ${JSON.stringify(s.bySeverity)} | run ${s.runId}`);
}

async function audit(): Promise<void> {
  const type = arg('type') ?? 'all';
  const sections: TrustSection[] = type === 'all' ? ['fake', 'resume'] : [type as TrustSection];
  if (!sections.every(s => s === 'fake' || s === 'resume')) throw new Error(`--type must be fake, resume or all (got "${type}")`);
  const limit = arg('limit') ? parseInt(arg('limit')!, 10) : Infinity;
  const t0 = Date.now();
  log(`AUDIT (no database writes) ${TRUST_RULE_VERSION} sections=${sections.join(',')}`);
  const index = await buildFullIndex(pool, { onProgress: n => { if (n % 2000 === 0) log(`indexed ${n}`); } });

  const counts: Record<string, Record<string, number>> = {};
  const samples: Record<string, Array<{ candidateId: string; name: string } & Pick<TrustSignal, 'severity' | 'title' | 'explanation' | 'relatedCandidateIds'>>> = {};
  const flagged = new Set<string>();
  let checked = 0;
  let signals = 0;
  for (const c of index.all()) {
    if (checked >= limit) break;
    checked++;
    for (const s of evaluateCandidate(c, index, sections).signals) {
      signals++;
      if (s.severity !== 'info') flagged.add(c.id);
      (counts[s.signalType] ??= { info: 0, low: 0, medium: 0, high: 0 })[s.severity]++;
      const list = (samples[s.signalType] ??= []);
      if (list.length < SAMPLES_PER_TYPE) {
        list.push({ candidateId: c.id, name: c.name, severity: s.severity, title: s.title, explanation: s.explanation, relatedCandidateIds: s.relatedCandidateIds.slice(0, 5) });
      }
    }
  }
  const summary = { ruleVersion: TRUST_RULE_VERSION, sections, indexed: index.size, checked, signalsFound: signals, candidatesWithNonInfoSignals: flagged.size, seconds: Math.round((Date.now() - t0) / 1000), counts };
  console.table(counts);
  const dir = resolve(__dirname, '../logs');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `trust-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ summary, samples }, null, 2));
  log(`checked ${checked}, ${signals} signals, ${flagged.size} with low+ signals → ${file}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'migrate') { await pool.query(readFileSync(MIGRATION, 'utf-8')); log('tables are in place'); }
  else if (cmd === 'fingerprints') await fingerprints();
  else if (cmd === 'nightly') await nightly();
  else if (cmd === 'check') await check(rest.filter(a => !a.startsWith('--')));
  else if (cmd === 'audit') await audit();
  else {
    console.log('Usage: run-trust-check.ts migrate | fingerprints | nightly | check <id...> | audit [--type fake|resume|all] [--limit N]');
    process.exitCode = 1;
  }
}

main()
  .catch(err => { console.error('[trust] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
