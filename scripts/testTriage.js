#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { applyRuntimeEnv } = require('../config/runtimeEnv');
const { triageNzbs, closeSharedNntpPool } = require('../src/services/triage');

applyRuntimeEnv();

async function main() {
  const rootDir = process.cwd();
  const nzbDir = resolveNzbDir(rootDir);
  if (!nzbDir) {
    console.error('No NZB directory found. Checked test_nzbs, nzbs, and provided overrides.');
    process.exit(1);
  }
  console.log(`[triage-test] Using NZB directory: ${nzbDir}`);
  const effectiveNntpHost = process.env.NZB_TRIAGE_NNTP_HOST;
  if (!effectiveNntpHost) {
    console.warn('[triage-test] Warning: NZB_TRIAGE_NNTP_HOST is not set. Archive inspections will be skipped.');
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
        console.log('[NZB TRIAGE] Stream candidate status', {
          title: filename,
          status: 'not-evaluated',
          triageApplied: false,
          triagePriority: 2,
          blockers: [],
          warnings: ['not-run'],
          archiveFindings: [],
          archiveSampleEntries: [],
          archiveCheckStatus: 'not-run',
          missingArticlesStatus: 'not-run',
          timedOut: false,
        });
        return;
      }
      const triageStatus = deriveTriageStatus(decision);
      const triagePriority = getTriagePriority(triageStatus);
      const archiveFindings = decision.archiveFindings || [];
      const archiveSampleEntries = collectArchiveSampleEntries(archiveFindings);
      const archiveCheckStatus = deriveArchiveCheckStatus(decision, archiveFindings);
      const missingArticlesStatus = deriveMissingArticlesStatus(decision, archiveFindings);

      console.log('[NZB TRIAGE] Stream candidate status', {
        title: decision.nzbTitle || filename,
        status: triageStatus,
        triageApplied: true,
        triagePriority,
        blockers: decision.blockers || [],
        warnings: decision.warnings || [],
        archiveFindings: 'see below',
        archiveSampleEntries,
        archiveCheckStatus,
        missingArticlesStatus,
        timedOut: false,
      });
      // Print archiveFindings with full details (avoids [Object] truncation)
      if (archiveFindings.length > 0) {
        console.log('  archiveFindings:');
        archiveFindings.forEach((f, i) => {
          console.log(`    [${i}] ${f.source} | ${f.filename || '?'} | status: ${f.status}`);
          if (f.details) {
            console.log(`        details: ${JSON.stringify(f.details)}`);
          }
        });
      }
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

function deriveTriageStatus(decision) {
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers : [];
  const warnings = Array.isArray(decision?.warnings) ? decision.warnings : [];
  const archiveFindings = Array.isArray(decision?.archiveFindings) ? decision.archiveFindings : [];

  const hasSevenZipFinding = archiveFindings.some((finding) => {
    const label = String(finding?.status || '').toLowerCase();
    return label.startsWith('sevenzip');
  }) || warnings.some((warning) => String(warning || '').toLowerCase().startsWith('sevenzip'));

  const hasSevenZipStored = archiveFindings.some((finding) => {
    const label = String(finding?.status || '').toLowerCase();
    return label === 'sevenzip-stored';
  });

  let status = 'blocked';
  if (decision?.decision === 'accept' && blockers.length === 0) {
    const positiveFinding = archiveFindings.some((finding) => {
      const label = String(finding?.status || '').toLowerCase();
      return label === 'rar-stored' || label === 'sevenzip-stored' || label === 'segment-ok';
    });
    if (positiveFinding) {
      status = 'verified';
    } else if (hasSevenZipFinding) {
      status = 'unverified_7z';
    } else {
      status = 'unverified';
    }
  }

  if (status === 'verified' && hasSevenZipFinding && !hasSevenZipStored) {
    status = 'unverified_7z';
  }

  if (status === 'unverified' && hasSevenZipFinding) {
    status = 'unverified_7z';
  }

  return status;
}

function getTriagePriority(status) {
  if (status === 'verified') return 0;
  if (status === 'blocked' || status === 'fetch-error' || status === 'error') return 2;
  return 1;
}

function collectArchiveSampleEntries(archiveFindings) {
  const archiveSampleEntries = [];
  (archiveFindings || []).forEach((finding) => {
    const samples = finding?.details?.sampleEntries;
    if (Array.isArray(samples)) {
      samples.forEach((entry) => {
        if (entry && !archiveSampleEntries.includes(entry)) {
          archiveSampleEntries.push(entry);
        }
      });
    } else if (finding?.details?.name && !archiveSampleEntries.includes(finding.details.name)) {
      archiveSampleEntries.push(finding.details.name);
    }
  });
  return archiveSampleEntries;
}

function deriveArchiveCheckStatus(decision, archiveFindings) {
  const archiveStatuses = (archiveFindings || []).map((finding) => String(finding?.status || '').toLowerCase());
  const archiveFailureTokens = new Set([
    'rar-compressed',
    'rar-encrypted',
    'rar-solid',
    'sevenzip-unsupported',
    'archive-not-found',
    'archive-no-segments',
    'rar-insufficient-data',
    'rar-header-not-found',
  ]);
  const passedArchiveCheck = archiveStatuses.some((status) => status === 'rar-stored' || status === 'sevenzip-signature-ok' || status === 'sevenzip-stored');
  const failedArchiveCheck = (decision?.blockers || []).some((blocker) => archiveFailureTokens.has(blocker))
    || archiveStatuses.some((status) => archiveFailureTokens.has(status));

  if (failedArchiveCheck) return 'failed';
  if (passedArchiveCheck) return 'passed';
  if ((archiveFindings || []).length > 0) return 'inconclusive';
  return 'not-run';
}

function deriveMissingArticlesStatus(decision, archiveFindings) {
  const archiveStatuses = (archiveFindings || []).map((finding) => String(finding?.status || '').toLowerCase());
  const missingArticlesFailure = (decision?.blockers || []).includes('missing-articles')
    || archiveStatuses.includes('segment-missing');
  const missingArticlesSuccess = archiveStatuses.includes('segment-ok')
    || archiveStatuses.includes('sevenzip-untested');

  if (missingArticlesFailure) return 'failed';
  if (missingArticlesSuccess) return 'passed';
  if ((archiveFindings || []).length > 0) return 'inconclusive';
  return 'not-run';
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

function resolveNzbDir(rootDir) {
  const cliArg = process.argv[2] ? process.argv[2].trim() : '';
  const envDir = normalizeEnv(process.env.NZB_TRIAGE_TEST_DIR);
  const candidates = [cliArg, envDir, 'test_nzbs', 'nzbs']
    .filter(Boolean)
    .map((entry) => (path.isAbsolute(entry) ? entry : path.join(rootDir, entry)));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch (err) {
      // Ignore filesystem errors and continue
    }
  }
  return null;
}
