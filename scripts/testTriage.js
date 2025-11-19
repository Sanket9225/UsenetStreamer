#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { triageNzbs, closeSharedNntpPool } = require('../src/services/triage');

async function main() {
  const rootDir = process.cwd();
  const nzbDir = path.join(rootDir, 'nzbs');

  if (!fs.existsSync(nzbDir) || !fs.statSync(nzbDir).isDirectory()) {
    console.error(`Expected nzb folder at ${nzbDir}, but it was not found.`);
    process.exit(1);
  }

  const nzbFiles = fs.readdirSync(nzbDir).filter((file) => file.toLowerCase().endsWith('.nzb'));
  if (nzbFiles.length === 0) {
    console.error('No .nzb files found in ./nzbs');
    process.exit(1);
  }

  const payloads = nzbFiles.map((file) =>
    fs.readFileSync(path.join(nzbDir, file), 'utf-8')
  );

  const triageOptions = {
    archiveDirs: getArchiveDirs(),
  };

  const nntpConfig = getNntpConfig();
  if (nntpConfig) triageOptions.nntpConfig = nntpConfig;

  const maxConnections = parseEnvNumber(process.env.NZB_TRIAGE_MAX_CONNECTIONS);
  if (maxConnections !== undefined) triageOptions.nntpMaxConnections = maxConnections;
  else triageOptions.nntpMaxConnections = 60;

  const healthTimeout = parseEnvNumber(process.env.NZB_TRIAGE_TIME_BUDGET_MS);
  if (healthTimeout !== undefined) triageOptions.healthCheckTimeoutMs = healthTimeout;

  const maxDecoded = parseEnvNumber(process.env.NZB_TRIAGE_MAX_DECODED_BYTES);
  if (maxDecoded !== undefined) triageOptions.maxDecodedBytes = maxDecoded;

  const maxParallelNzbs = parseEnvNumber(process.env.NZB_TRIAGE_MAX_PARALLEL_NZBS);
  if (maxParallelNzbs !== undefined) triageOptions.maxParallelNzbs = maxParallelNzbs;

  const statSampleCount = parseEnvNumber(process.env.NZB_TRIAGE_STAT_SAMPLE_COUNT);
  if (statSampleCount !== undefined) triageOptions.statSampleCount = statSampleCount;

  const archiveSampleCount = parseEnvNumber(process.env.NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT);
  if (archiveSampleCount !== undefined) triageOptions.archiveSampleCount = archiveSampleCount;

  const reuseEnv = normalizeEnv(process.env.NZB_TRIAGE_REUSE_POOL);
  if (reuseEnv !== undefined) triageOptions.reuseNntpPool = reuseEnv.toLowerCase() === 'true';

  const repeatRuns = Math.max(1, parseEnvNumber(process.env.NZB_TRIAGE_REPEAT) ?? 1);
  if (repeatRuns > 1) triageOptions.reuseNntpPool = true;

  for (let runIndex = 0; runIndex < repeatRuns; runIndex += 1) {
    if (repeatRuns > 1) console.log(`\nRun ${runIndex + 1} / ${repeatRuns}`);

    const summary = await triageNzbs(payloads, triageOptions);
    const decisionMap = new Map(summary.decisions.map((decision) => [decision.nzbIndex, decision]));

    nzbFiles.forEach((filename, index) => {
      const decision = decisionMap.get(index);
      if (!decision) {
        console.log(`NZB: ${filename} | decision: not-evaluated | blockers: none | warnings: not-run`);
        return;
      }
      console.log(formatDecisionRow(filename, decision));
    });

    console.log('\nSummary:');
    console.log(`  accepted: ${summary.accepted}`);
    console.log(`  rejected: ${summary.rejected}`);
    console.log(`  processed: ${summary.decisions.length} / ${nzbFiles.length}`);
    console.log(`  elapsed: ${summary.elapsedMs} ms`);

    printFlagCounts('blockers', summary.blockerCounts);
    printFlagCounts('warnings', summary.warningCounts);
    printMetrics(summary.metrics);
  }

  await closeSharedNntpPool();
}

function getArchiveDirs() {
  const raw = normalizeEnv(process.env.NZB_TRIAGE_ARCHIVE_DIRS);
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry));
}

function getNntpConfig() {
  const host = normalizeEnv(process.env.NZB_TRIAGE_NNTP_HOST);
  if (!host) return null;

  return {
    host,
    port: Number(normalizeEnv(process.env.NZB_TRIAGE_NNTP_PORT) ?? 119),
    user: normalizeEnv(process.env.NZB_TRIAGE_NNTP_USER),
    pass: normalizeEnv(process.env.NZB_TRIAGE_NNTP_PASS),
    useTLS: normalizeEnv(process.env.NZB_TRIAGE_NNTP_TLS)?.toLowerCase() === 'true',
  };
}

function normalizeEnv(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvNumber(value) {
  const normalized = normalizeEnv(value);
  if (normalized === undefined || normalized === null || normalized === '') return undefined;
  const num = Number(normalized);
  return Number.isNaN(num) ? undefined : num;
}

function printFlagCounts(label, counts) {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) {
    console.log(`  ${label}: none`);
    return;
  }
  console.log(`  ${label}:`);
  entries
    .sort(([, aCount], [, bCount]) => bCount - aCount)
    .forEach(([flag, count]) => {
      console.log(`    ${flag}: ${count}`);
    });
}

function formatDecisionRow(filename, decision) {
  const title = decision.nzbTitle ?? '(no title)';
  const blockers = decision.blockers.length ? decision.blockers.join(', ') : 'none';
  const warnings = decision.warnings.length ? decision.warnings.join(', ') : 'none';
  const archiveSummary = summarizeArchiveFindings(decision.archiveFindings ?? []);
  return [
    `NZB: ${filename}`,
    `title: ${title}`,
    `decision: ${decision.decision}`,
    `files: ${decision.fileCount}`,
    `blockers: ${blockers}`,
    `warnings: ${warnings}`,
    `archives: ${archiveSummary}`,
  ].join(' | ');
}

function printMetrics(metrics) {
  if (!metrics) return;
  const avgStat = metrics.statCalls > 0 ? Math.round(metrics.statDurationMs / metrics.statCalls) : 0;
  const avgBody = metrics.bodyCalls > 0 ? Math.round(metrics.bodyDurationMs / metrics.bodyCalls) : 0;
  console.log('  nnpt-calls:');
  console.log(`    stat: ${metrics.statCalls} (ok ${metrics.statSuccesses}, missing ${metrics.statMissing}, other ${metrics.statErrors}) avg ${avgStat} ms`);
  console.log(`    body: ${metrics.bodyCalls} (ok ${metrics.bodySuccesses}, missing ${metrics.bodyMissing}, other ${metrics.bodyErrors}) avg ${avgBody} ms`);
  if (typeof metrics.poolCreates === 'number') {
    console.log(`  pool: created ${metrics.poolCreates}, reused ${metrics.poolReuses}, closed ${metrics.poolCloses}, acquisitions ${metrics.clientAcquisitions}`);
  }
  if (metrics.poolTotals) {
    console.log(`  pool-totals: created ${metrics.poolTotals.created}, reused ${metrics.poolTotals.reused}, closed ${metrics.poolTotals.closed}`);
  }
}

function summarizeArchiveFindings(findings) {
  if (!findings || findings.length === 0) return 'none';
  const stored = findings.filter(item => item.status === 'rar-stored').length;
  const maxEntries = 10;
  const statuses = findings
    .slice(0, maxEntries)
    .map(item => {
      const label = item.filename ?? item.subject ?? 'unknown';
      return `${label}:${item.status}`;
    })
    .join(', ');
  const suffix = findings.length > maxEntries ? ', ...' : '';
  return `stored ${stored}/${findings.length} [${statuses}${suffix}]`;
}

main().catch((err) => {
  console.error('Triage script crashed:', err);
  process.exit(1);
});
