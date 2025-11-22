const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const path = require('path');
const NNTPModule = require('nntp/lib/nntp');
const NNTP = typeof NNTPModule === 'function' ? NNTPModule : NNTPModule?.NNTP;
function timingLog(event, details) {
  const payload = details ? { ...details, ts: new Date().toISOString() } : { ts: new Date().toISOString() };
  console.log(`[NZB TRIAGE][TIMING] ${event}`, payload);
}

const ARCHIVE_EXTENSIONS = new Set(['.rar', '.r00', '.r01', '.r02', '.7z']);
const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);

const TRIAGE_ACTIVITY_TTL_MS = 60 * 60 * 1000; // 1 hour window for keep-alives
let lastTriageActivityTs = 0;

const DEFAULT_OPTIONS = {
  archiveDirs: [],
  nntpConfig: null,
  healthCheckTimeoutMs: 35000,
  maxDecodedBytes: 16 * 1024,
  nntpMaxConnections: 60,
  reuseNntpPool: true,
  nntpKeepAliveMs: 120000 ,
  maxParallelNzbs: Number.POSITIVE_INFINITY,
  statSampleCount: 1,
  archiveSampleCount: 1,
};

let sharedNntpPoolRecord = null;
let sharedNntpPoolBuildPromise = null;
let currentMetrics = null;
const poolStats = {
  created: 0,
  reused: 0,
  closed: 0,
};

function markTriageActivity() {
  lastTriageActivityTs = Date.now();
}

function isTriageActivityFresh() {
  if (!lastTriageActivityTs) return false;
  return (Date.now() - lastTriageActivityTs) < TRIAGE_ACTIVITY_TTL_MS;
}

function isSharedPoolStale() {
  if (!sharedNntpPoolRecord?.pool) return false;
  if (isTriageActivityFresh()) return false;
  const lastUsed = typeof sharedNntpPoolRecord.pool.getLastUsed === 'function'
    ? sharedNntpPoolRecord.pool.getLastUsed()
    : null;
  if (Number.isFinite(lastUsed)) {
    return (Date.now() - lastUsed) >= TRIAGE_ACTIVITY_TTL_MS;
  }
  // If we cannot determine last used timestamp, assume stale so we rebuild proactively.
  return true;
}

function buildKeepAliveMessageId() {
  const randomFragment = Math.random().toString(36).slice(2, 10);
  return `<keepalive-${Date.now().toString(36)}-${randomFragment}@invalid>`;
}

function snapshotPool(pool) {
  if (!pool) return {};
  const summary = { size: pool.size ?? 0 };
  if (typeof pool.getIdleCount === 'function') summary.idle = pool.getIdleCount();
  if (typeof pool.getLastUsed === 'function') summary.idleMs = Date.now() - pool.getLastUsed();
  return summary;
}

function recordPoolCreate(pool, meta = {}) {
  poolStats.created += 1;
  if (currentMetrics) currentMetrics.poolCreates += 1;
  timingLog('nntp-pool:created', {
    ...snapshotPool(pool),
    ...meta,
    totals: { ...poolStats },
  });
}

function recordPoolReuse(pool, meta = {}) {
  poolStats.reused += 1;
  if (currentMetrics) currentMetrics.poolReuses += 1;
  timingLog('nntp-pool:reused', {
    ...snapshotPool(pool),
    ...meta,
    totals: { ...poolStats },
  });
}

async function closePool(pool, reason) {
  if (!pool) return;
  const poolSnapshot = snapshotPool(pool);
  await pool.close();
  poolStats.closed += 1;
  if (currentMetrics) currentMetrics.poolCloses += 1;
  timingLog('nntp-pool:closed', {
    reason,
    ...poolSnapshot,
    totals: { ...poolStats },
  });
}

function getInFlightPoolBuild() {
  return sharedNntpPoolBuildPromise;
}

function setInFlightPoolBuild(promise) {
  sharedNntpPoolBuildPromise = promise;
}

function clearInFlightPoolBuild(promise) {
  if (sharedNntpPoolBuildPromise === promise) {
    sharedNntpPoolBuildPromise = null;
  }
}

async function preWarmNntpPool(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (!config.reuseNntpPool) return;
  if (!config.nntpConfig || !NNTP) return;

  const desiredConnections = config.nntpMaxConnections ?? 1;
  const keepAliveMs = Number.isFinite(config.nntpKeepAliveMs) ? config.nntpKeepAliveMs : 0;
  const poolKey = buildPoolKey(config.nntpConfig, desiredConnections, keepAliveMs);

  if (sharedNntpPoolRecord?.key === poolKey && sharedNntpPoolRecord?.pool) {
    if (typeof sharedNntpPoolRecord.pool.touch === 'function') {
      sharedNntpPoolRecord.pool.touch();
    }
    return;
  }

  try {
    const freshPool = await createNntpPool(config.nntpConfig, desiredConnections, { keepAliveMs });
    if (sharedNntpPoolRecord?.pool) {
      try {
        await closePool(sharedNntpPoolRecord.pool, 'prewarm-replaced');
      } catch (closeErr) {
        console.warn('[NZB TRIAGE] Failed to close previous pre-warmed NNTP pool', closeErr?.message || closeErr);
      }
    }
    sharedNntpPoolRecord = { key: poolKey, pool: freshPool, keepAliveMs };
    recordPoolCreate(freshPool, { reason: 'prewarm' });
  } catch (err) {
    console.warn('[NZB TRIAGE] Failed to pre-warm NNTP pool', {
      message: err?.message,
      code: err?.code,
      name: err?.name,
    });
  }
}

async function triageNzbs(nzbStrings, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const sharedPoolStale = config.reuseNntpPool && isSharedPoolStale();
  markTriageActivity();
  const healthTimeoutMs = Number.isFinite(config.healthCheckTimeoutMs) && config.healthCheckTimeoutMs > 0
    ? config.healthCheckTimeoutMs
    : DEFAULT_OPTIONS.healthCheckTimeoutMs;
  const start = Date.now();
  const decisions = [];

  currentMetrics = {
    statCalls: 0,
    statSuccesses: 0,
    statMissing: 0,
    statErrors: 0,
    statDurationMs: 0,
    bodyCalls: 0,
    bodySuccesses: 0,
    bodyMissing: 0,
    bodyErrors: 0,
    bodyDurationMs: 0,
    poolCreates: 0,
    poolReuses: 0,
    poolCloses: 0,
    clientAcquisitions: 0,
  };

  let nntpError = null;
  let nntpPool = null;
  let shouldClosePool = false;
  if (config.nntpConfig && NNTP) {
    const desiredConnections = config.nntpMaxConnections ?? 1;
    const keepAliveMs = Number.isFinite(config.nntpKeepAliveMs) ? config.nntpKeepAliveMs : 0;
    const poolKey = buildPoolKey(config.nntpConfig, desiredConnections, keepAliveMs);
    const canReuseSharedPool = config.reuseNntpPool
      && !sharedPoolStale
      && sharedNntpPoolRecord?.key === poolKey
      && sharedNntpPoolRecord?.pool;

    if (canReuseSharedPool) {
      nntpPool = sharedNntpPoolRecord.pool;
      if (typeof nntpPool?.touch === 'function') {
        nntpPool.touch();
      }
      recordPoolReuse(nntpPool, { reason: 'config-match' });
    } else {
      const hadSharedPool = Boolean(sharedNntpPoolRecord?.pool);
      if (config.reuseNntpPool && hadSharedPool && !getInFlightPoolBuild()) {
        await closeSharedNntpPool(sharedPoolStale ? 'stale' : 'replaced');
      }
      try {
        if (config.reuseNntpPool) {
          let buildPromise = getInFlightPoolBuild();
          if (!buildPromise) {
            buildPromise = (async () => {
              const freshPool = await createNntpPool(config.nntpConfig, desiredConnections, { keepAliveMs });
              const creationReason = sharedPoolStale
                ? 'stale-refresh'
                : (hadSharedPool ? 'refresh' : 'bootstrap');
              sharedNntpPoolRecord = { key: poolKey, pool: freshPool, keepAliveMs };
              recordPoolCreate(freshPool, { reason: creationReason });
              return freshPool;
            })();
            setInFlightPoolBuild(buildPromise);
          }
          nntpPool = await buildPromise;
          clearInFlightPoolBuild(buildPromise);
        } else {
          const freshPool = await createNntpPool(config.nntpConfig, desiredConnections, { keepAliveMs });
          nntpPool = freshPool;
          shouldClosePool = true;
          recordPoolCreate(freshPool, { reason: 'one-shot' });
        }
      } catch (err) {
        if (config.reuseNntpPool) {
          clearInFlightPoolBuild(getInFlightPoolBuild());
        }
        console.warn('[NZB TRIAGE] Failed to create NNTP pool', {
          message: err?.message,
          code: err?.code,
          name: err?.name,
          stack: err?.stack,
          raw: err
        });
        nntpError = err;
      }
    }
  } else if (config.nntpConfig && !NNTP) {
    nntpError = new Error('nntp module unavailable');
  }

  const parallelLimit = Math.max(1, Math.min(config.maxParallelNzbs ?? Number.POSITIVE_INFINITY, nzbStrings.length));
  const results = await runWithDeadline(
    () => analyzeWithConcurrency({
      nzbStrings,
      parallelLimit,
      config,
      nntpPool,
      nntpError,
    }),
    healthTimeoutMs,
  );
  results.sort((a, b) => a.index - b.index);
  for (const { decision } of results) decisions.push(decision);

  if (shouldClosePool && nntpPool) await closePool(nntpPool, 'one-shot');
  else if (config.reuseNntpPool && nntpPool && typeof nntpPool.touch === 'function') {
    nntpPool.touch();
  }

  const elapsedMs = Date.now() - start;
  const accepted = decisions.filter((x) => x.decision === 'accept').length;
  const rejected = decisions.filter((x) => x.decision === 'reject').length;
  const blockerCounts = buildFlagCounts(decisions, 'blockers');
  const warningCounts = buildFlagCounts(decisions, 'warnings');
  const metrics = currentMetrics;
  if (metrics) metrics.poolTotals = { ...poolStats };
  currentMetrics = null;
  return { decisions, accepted, rejected, elapsedMs, blockerCounts, warningCounts, metrics };
}

async function analyzeSingleNzb(raw, ctx) {
  const parsed = await parseStringPromise(raw, { explicitArray: false, trim: true });
  const files = extractFiles(parsed);
  const blockers = new Set();
  const warnings = new Set();
  const archiveFindings = [];
  const archiveCandidates = dedupeArchiveCandidates(files.filter(isArchiveFile));
  const checkedSegments = new Set();
  let primaryArchive = null;

  const runStatCheck = async (archive, segment) => {
    const segmentId = segment?.id;
    if (!segmentId || checkedSegments.has(segmentId)) return;
    checkedSegments.add(segmentId);
    try {
      await statSegment(ctx.nntpPool, segmentId);
      archiveFindings.push({
        source: 'nntp-stat',
        filename: archive.filename,
        subject: archive.subject,
        status: 'segment-ok',
        details: { segmentId },
      });
    } catch (err) {
      if (err?.code === 'STAT_MISSING' || err?.code === 430) {
        blockers.add('missing-articles');
        archiveFindings.push({
          source: 'nntp-stat',
          filename: archive.filename,
          subject: archive.subject,
          status: 'segment-missing',
          details: { segmentId },
        });
      } else {
        warnings.add('nntp-stat-error');
        archiveFindings.push({
          source: 'nntp-stat',
          filename: archive.filename,
          subject: archive.subject,
          status: 'segment-error',
          details: { segmentId, message: err?.message },
        });
      }
    }
  };

  if (archiveCandidates.length === 0) {
    warnings.add('no-archive-candidates');

    const uniqueSegments = collectUniqueSegments(files);

    if (!ctx.nntpPool) {
      if (ctx.nntpError) warnings.add(`nntp-error:${ctx.nntpError.code ?? ctx.nntpError.message}`);
      else warnings.add('nntp-disabled');
    } else if (uniqueSegments.length > 0) {
      const statSampleCount = Math.max(1, Math.floor(ctx.config?.statSampleCount ?? 1));
      const sampledSegments = pickRandomElements(uniqueSegments, statSampleCount);
      await Promise.all(sampledSegments.map(async ({ segmentId, file }) => {
        try {
          await statSegment(ctx.nntpPool, segmentId);
          archiveFindings.push({
            source: 'nntp-stat',
            filename: file.filename,
            subject: file.subject,
            status: 'segment-ok',
            details: { segmentId },
          });
        } catch (err) {
          if (err?.code === 'STAT_MISSING' || err?.code === 430) {
            blockers.add('missing-articles');
            archiveFindings.push({
              source: 'nntp-stat',
              filename: file.filename,
              subject: file.subject,
              status: 'segment-missing',
              details: { segmentId },
            });
          } else {
            warnings.add('nntp-stat-error');
            archiveFindings.push({
              source: 'nntp-stat',
              filename: file.filename,
              subject: file.subject,
              status: 'segment-error',
              details: { segmentId, message: err?.message },
            });
          }
        }
      }));
    }

    const decision = blockers.size === 0 ? 'accept' : 'reject';
    return buildDecision(decision, blockers, warnings, {
      fileCount: files.length,
      nzbTitle: extractTitle(parsed),
      nzbIndex: ctx.nzbIndex,
      archiveFindings,
    });
  }

  let storedArchiveFound = false;
  if (ctx.config.archiveDirs?.length) {
    for (const archive of archiveCandidates) {
      const localResult = await inspectLocalArchive(archive, ctx.config.archiveDirs);
      archiveFindings.push({
        source: 'local',
        filename: archive.filename,
        subject: archive.subject,
        status: localResult.status,
        path: localResult.path ?? null,
        details: localResult.details ?? null,
      });
      if (handleArchiveStatus(localResult.status, blockers, warnings)) {
        storedArchiveFound = true;
      }
    }
  }

  if (!ctx.nntpPool) {
    if (ctx.nntpError) warnings.add(`nntp-error:${ctx.nntpError.code ?? ctx.nntpError.message}`);
    else warnings.add('nntp-disabled');
  } else {
    const archiveWithSegments = archiveCandidates.find((candidate) => candidate.segments.length > 0);
    if (archiveWithSegments) {
      const nntpResult = await inspectArchiveViaNntp(archiveWithSegments, ctx);
      archiveFindings.push({
        source: 'nntp',
        filename: archiveWithSegments.filename,
        subject: archiveWithSegments.subject,
        status: nntpResult.status,
        details: nntpResult.details ?? null,
      });
      if (nntpResult.segmentId) {
        checkedSegments.add(nntpResult.segmentId);
        if (nntpResult.status === 'rar-stored' || nntpResult.status === 'sevenzip-stored') {
          archiveFindings.push({
            source: 'nntp-stat',
            filename: archiveWithSegments.filename,
            subject: archiveWithSegments.subject,
            status: 'segment-ok',
            details: { segmentId: nntpResult.segmentId },
          });
        }
      }
      primaryArchive = archiveWithSegments;
      if (handleArchiveStatus(nntpResult.status, blockers, warnings)) {
        storedArchiveFound = true;
      }
    } else {
      warnings.add('archive-no-segments');
    }
  }

  if (ctx.nntpPool && storedArchiveFound && blockers.size === 0) {
    const extraStatChecks = Math.max(0, Math.floor(ctx.config?.statSampleCount ?? 0));
    if (extraStatChecks > 0 && primaryArchive?.segments?.length) {
      const availablePrimarySegments = primaryArchive.segments
        .filter((segment) => segment?.id && !checkedSegments.has(segment.id));
      const primarySamples = pickRandomElements(
        availablePrimarySegments,
        Math.min(extraStatChecks, availablePrimarySegments.length),
      );
      await Promise.all(primarySamples.map((segment) => runStatCheck(primaryArchive, segment)));
    }

    const archivesWithSegments = archiveCandidates.filter((archive) => archive.segments.length > 0 && archive !== primaryArchive);
      const archiveSampleCount = Math.max(1, Math.floor(ctx.config?.archiveSampleCount ?? 1));
        const sampleArchives = pickRandomElements(
          archivesWithSegments.filter((archive) => {
            const segmentId = archive.segments[0]?.id;
            return segmentId && !checkedSegments.has(segmentId);
          }),
          archiveSampleCount,
        );

        await Promise.all(sampleArchives.map(async (archive) => {
          const segment = archive.segments.find((entry) => entry?.id && !checkedSegments.has(entry.id));
          if (!segment) return;
          await runStatCheck(archive, segment);
        }));
  }
  if (!storedArchiveFound && blockers.size === 0) warnings.add('rar-m0-unverified');

  const decision = blockers.size === 0 ? 'accept' : 'reject';
  return buildDecision(decision, blockers, warnings, {
    fileCount: files.length,
    nzbTitle: extractTitle(parsed),
    nzbIndex: ctx.nzbIndex,
    archiveFindings,
  });
}

async function analyzeWithConcurrency({ nzbStrings, parallelLimit, config, nntpPool, nntpError }) {
  const total = nzbStrings.length;
  if (total === 0) return [];
  const results = new Array(total);
  let nextIndex = 0;

  const workers = Array.from({ length: parallelLimit }, async () => {
    while (true) {
      const index = nextIndex;
      if (index >= total) break;
      nextIndex += 1;
      const nzbString = nzbStrings[index];
      const context = { config, nntpPool, nntpError, nzbIndex: index };
      try {
        const decision = await analyzeSingleNzb(nzbString, context);
        results[index] = { index, decision };
      } catch (err) {
        results[index] = { index, decision: buildErrorDecision(err, index) };
      }
    }
  });

  await Promise.all(workers);

  return results.filter(Boolean);
}

function extractFiles(parsedNzb) {
  const filesNode = parsedNzb?.nzb?.file ?? [];
  const items = Array.isArray(filesNode) ? filesNode : [filesNode];

  return items
    .filter(Boolean)
    .map((file) => {
      const subject = file.$?.subject ?? '';
      const filename = guessFilenameFromSubject(subject);
      const extension = filename ? getExtension(filename) : undefined;
      const segments = normalizeSegments(file.segments?.segment);
      return { subject, filename, extension, segments };
    });
}

function normalizeSegments(segmentNode) {
  const segments = Array.isArray(segmentNode) ? segmentNode : segmentNode ? [segmentNode] : [];
  return segments.map((seg) => ({
    number: Number(seg.$?.number ?? 0),
    bytes: Number(seg.$?.bytes ?? 0),
    id: seg._ ?? '',
  }));
}

function extractTitle(parsedNzb) {
  const meta = parsedNzb?.nzb?.head?.meta;
  if (!meta) return null;
  const items = Array.isArray(meta) ? meta : [meta];
  const match = items.find((entry) => entry?.$?.type === 'title');
  return match?._ ?? null;
}

function guessFilenameFromSubject(subject) {
  if (!subject) return null;
  const quoted = subject.match(/"([^"\\]+)"/);
  if (quoted) return quoted[1];
  const explicit = subject.match(/([\w\-.\(\)\[\]]+\.(?:rar|r\d{2}|7z|par2|sfv|nfo|mkv|mp4|avi|mov|wmv))/i);
  if (explicit) return explicit[1];
  return null;
}

function isArchiveFile(file) {
  const ext = file.extension ?? getExtension(file.filename);
  if (!ext) return false;
  if (ARCHIVE_EXTENSIONS.has(ext)) return true;
  return /^\.r\d{2}$/i.test(ext);
}

function getExtension(filename) {
  if (!filename) return undefined;
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  return filename.slice(lastDot).toLowerCase();
}

function dedupeArchiveCandidates(archives) {
  const seen = new Set();
  const result = [];
  for (const archive of archives) {
    const key = canonicalArchiveKey(archive.filename ?? archive.subject ?? '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(archive);
  }
  return result;
}

function canonicalArchiveKey(name) {
  if (!name) return null;
  let key = name.toLowerCase();
  key = key.replace(/\.part\d+\.rar$/i, '.rar');
  key = key.replace(/\.r\d{2}$/i, '.rar');
  return key;
}

async function inspectLocalArchive(file, archiveDirs) {
  const filename = file.filename ?? guessFilenameFromSubject(file.subject);
  if (!filename) return { status: 'missing-filename' };

  const candidateNames = buildCandidateNames(filename);
  for (const dir of archiveDirs) {
    for (const candidate of candidateNames) {
      const candidatePath = path.join(dir, candidate);
      try {
        const stat = await fs.stat(candidatePath);
        if (stat.isFile()) {
          const analysis = await analyzeArchiveFile(candidatePath);
          return { ...analysis, path: candidatePath };
        }
      } catch (err) {
        if (err.code !== 'ENOENT') return { status: 'io-error', details: err.message };
      }
    }
  }

  return { status: 'archive-not-found' };
}

function buildCandidateNames(filename) {
  const candidates = new Set();
  candidates.add(filename);

  if (/\.part\d+\.rar$/i.test(filename)) {
    candidates.add(filename.replace(/\.part\d+\.rar$/i, '.rar'));
  }

  if (/\.r\d{2}$/i.test(filename)) {
    candidates.add(filename.replace(/\.r\d{2}$/i, '.rar'));
  }

  return Array.from(candidates);
}

async function analyzeArchiveFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.slice(0, bytesRead);
    return inspectArchiveBuffer(slice);
  } finally {
    await handle.close();
  }
}

async function inspectArchiveViaNntp(file, ctx) {
  const segments = file.segments ?? [];
  if (segments.length === 0) return { status: 'archive-no-segments' };
  const segmentId = segments[0]?.id;
  if (!segmentId) return { status: 'archive-no-segments' };
  return runWithClient(ctx.nntpPool, async (client) => {
    let statStart = null;
    if (currentMetrics) {
      currentMetrics.statCalls += 1;
      statStart = Date.now();
    }
    try {
      await statSegmentWithClient(client, segmentId);
      if (currentMetrics && statStart !== null) {
        currentMetrics.statSuccesses += 1;
        currentMetrics.statDurationMs += Date.now() - statStart;
      }
    } catch (err) {
      if (currentMetrics && statStart !== null) {
        currentMetrics.statDurationMs += Date.now() - statStart;
        if (err.code === 'STAT_MISSING' || err.code === 430) currentMetrics.statMissing += 1;
        else currentMetrics.statErrors += 1;
      }
      if (err.code === 'STAT_MISSING' || err.code === 430) return { status: 'stat-missing', details: { segmentId }, segmentId };
      return { status: 'stat-error', details: { segmentId, message: err.message }, segmentId };
    }

    let bodyStart = null;
    if (currentMetrics) {
      currentMetrics.bodyCalls += 1;
      bodyStart = Date.now();
    }

    try {
      const bodyBuffer = await fetchSegmentBodyWithClient(client, segmentId);
      const decoded = decodeYencBuffer(bodyBuffer, ctx.config.maxDecodedBytes);
      const archiveResult = inspectArchiveBuffer(decoded);
      if (currentMetrics) {
        currentMetrics.bodySuccesses += 1;
        currentMetrics.bodyDurationMs += Date.now() - bodyStart;
      }
      return { ...archiveResult, segmentId };
    } catch (err) {
      if (currentMetrics && bodyStart !== null) currentMetrics.bodyDurationMs += Date.now() - bodyStart;
      if (currentMetrics) {
        if (err.code === 'BODY_MISSING') currentMetrics.bodyMissing += 1;
        else currentMetrics.bodyErrors += 1;
      }
      if (err.code === 'BODY_MISSING') return { status: 'body-missing', details: { segmentId }, segmentId };
      if (err.code === 'BODY_ERROR') return { status: 'body-error', details: { segmentId, message: err.message }, segmentId };
      if (err.code === 'DECODE_ERROR') return { status: 'decode-error', details: { segmentId, message: err.message }, segmentId };
      return { status: 'body-error', details: { segmentId, message: err.message }, segmentId };
    }
  });
}

function handleArchiveStatus(status, blockers, warnings) {
  switch (status) {
    case 'rar-stored':
      return true;
    case 'sevenzip-stored':
      return true;
    case 'rar-compressed':
    case 'rar-encrypted':
    case 'rar-solid':
    case 'rar5-unsupported':
    case 'sevenzip-unsupported':
      blockers.add(status);
      break;
    case 'stat-missing':
    case 'body-missing':
      blockers.add('missing-articles');
      break;
    case 'archive-not-found':
    case 'archive-no-segments':
    case 'rar-insufficient-data':
    case 'rar-header-not-found':
    case 'io-error':
    case 'stat-error':
    case 'body-error':
    case 'decode-error':
    case 'missing-filename':
      warnings.add(status);
      break;
    default:
      break;
  }
  return false;
}

function inspectArchiveBuffer(buffer) {
  if (buffer.length >= RAR4_SIGNATURE.length && buffer.subarray(0, RAR4_SIGNATURE.length).equals(RAR4_SIGNATURE)) {
    return inspectRar4(buffer);
  }

  if (buffer.length >= RAR5_SIGNATURE.length && buffer.subarray(0, RAR5_SIGNATURE.length).equals(RAR5_SIGNATURE)) {
    return inspectRar5(buffer);
  }

  if (buffer.length >= 6 && buffer[0] === 0x37 && buffer[1] === 0x7A) {
    return inspectSevenZip(buffer);
  }

  return { status: 'rar-header-not-found' };
}

function inspectRar4(buffer) {
  let offset = RAR4_SIGNATURE.length;

  while (offset + 7 <= buffer.length) {
    const headerType = buffer[offset + 2];
    const headerFlags = buffer.readUInt16LE(offset + 3);
    const headerSize = buffer.readUInt16LE(offset + 5);

    if (headerSize < 7) return { status: 'rar-corrupt-header' };
    if (offset + headerSize > buffer.length) return { status: 'rar-insufficient-data' };

    if (headerType === 0x74) {
      let pos = offset + 7;
      if (pos + 11 > buffer.length) return { status: 'rar-insufficient-data' };
      pos += 4; // pack size
      pos += 4; // unpacked size
      pos += 1; // host OS
      pos += 4; // file CRC
      pos += 4; // file time
      if (pos >= buffer.length) return { status: 'rar-insufficient-data' };
      pos += 1; // extraction version
      const methodByte = buffer[pos]; pos += 1;
      if (pos + 2 > buffer.length) return { status: 'rar-insufficient-data' };
      const nameSize = buffer.readUInt16LE(pos); pos += 2;
      pos += 4; // attributes
      if (headerFlags & 0x0100) pos += 4; // high pack size
      if (headerFlags & 0x0200) pos += 4; // high unpack size
      if (pos + nameSize > buffer.length) return { status: 'rar-insufficient-data' };
      const name = buffer.slice(pos, pos + nameSize).toString('utf8').replace(/\0/g, '');
      const encrypted = Boolean(headerFlags & 0x0004);
      const solid = Boolean(headerFlags & 0x0010);

      if (encrypted) return { status: 'rar-encrypted', details: { name } };
      if (solid) return { status: 'rar-solid', details: { name } };
      if (methodByte !== 0x30) return { status: 'rar-compressed', details: { name, method: methodByte } };

      return { status: 'rar-stored', details: { name, method: methodByte } };
    }

    offset += headerSize;
  }

  return { status: 'rar-header-not-found' };
}

function inspectRar5(buffer) {
  return { status: 'rar-stored', details: { note: 'rar5-header-assumed-stored' } };
}

function inspectSevenZip(buffer) {
  if (buffer.length < 32) return { status: 'sevenzip-insufficient-data' };
  const firstByte = buffer[6];
  if (firstByte === 0x00) return { status: 'sevenzip-stored' };
  return {
    status: 'sevenzip-unsupported',
    details: { methodByte: firstByte },
  };
}

function buildDecision(decision, blockers, warnings, meta) {
  return {
    decision,
    blockers: Array.from(blockers),
    warnings: Array.from(warnings),
    ...meta,
  };
}

function statSegment(pool, segmentId) {
  if (currentMetrics) currentMetrics.statCalls += 1;
  const start = Date.now();
  timingLog('nntp-stat:start', { segmentId });
  return runWithClient(pool, (client) => statSegmentWithClient(client, segmentId))
    .then((result) => {
      if (currentMetrics) currentMetrics.statSuccesses += 1;
      timingLog('nntp-stat:success', { segmentId, durationMs: Date.now() - start });
      return result;
    })
    .catch((err) => {
      if (currentMetrics) {
        if (err?.code === 'STAT_MISSING' || err?.code === 430) currentMetrics.statMissing += 1;
        else currentMetrics.statErrors += 1;
      }
      timingLog('nntp-stat:error', {
        segmentId,
        durationMs: Date.now() - start,
        code: err?.code,
        message: err?.message,
      });
      throw err;
    })
    .finally(() => {
      if (currentMetrics) currentMetrics.statDurationMs += Date.now() - start;
    });
}

function statSegmentWithClient(client, segmentId) {
  const STAT_TIMEOUT_MS = 5000; // Aggressive 5s timeout per STAT
  return new Promise((resolve, reject) => {
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        const error = new Error('STAT timed out after 5s');
        error.code = 'STAT_TIMEOUT';
        error.dropClient = true; // Mark client as broken
        reject(error);
      }
    }, STAT_TIMEOUT_MS);

    client.stat(`<${segmentId}>`, (err) => {
      if (completed) return; // Already timed out
      completed = true;
      clearTimeout(timer);
      
      if (err) {
        const error = new Error(err.message || 'STAT failed');
        const codeFromMessage = err.message && err.message.includes('430') ? 'STAT_MISSING' : err.code;
        error.code = err.code ?? codeFromMessage;
        if (['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(err.code)) {
          error.dropClient = true;
        }
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function fetchSegmentBody(pool, segmentId) {
  if (currentMetrics) currentMetrics.bodyCalls += 1;
  const start = Date.now();
  timingLog('nntp-body:start', { segmentId });
  return runWithClient(pool, (client) => fetchSegmentBodyWithClient(client, segmentId))
    .then((result) => {
      if (currentMetrics) currentMetrics.bodySuccesses += 1;
      timingLog('nntp-body:success', { segmentId, durationMs: Date.now() - start });
      return result;
    })
    .catch((err) => {
      if (currentMetrics) {
        if (err?.code === 'BODY_MISSING') currentMetrics.bodyMissing += 1;
        else currentMetrics.bodyErrors += 1;
      }
      timingLog('nntp-body:error', {
        segmentId,
        durationMs: Date.now() - start,
        code: err?.code,
        message: err?.message,
      });
      throw err;
    })
    .finally(() => {
      if (currentMetrics) currentMetrics.bodyDurationMs += Date.now() - start;
    });
}

function fetchSegmentBodyWithClient(client, segmentId) {
  return new Promise((resolve, reject) => {
    client.body(`<${segmentId}>`, (err, _articleNumber, _messageId, bodyBuffer) => {
      if (err) {
        const error = new Error(err.message || 'BODY failed');
        error.code = err.code ?? 'BODY_ERROR';
        if (error.code === 430) error.code = 'BODY_MISSING';
        if (['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(err.code)) {
          error.dropClient = true;
        }
        reject(error);
        return;
      }

      if (!bodyBuffer || bodyBuffer.length === 0) {
        const error = new Error('Empty BODY response');
        error.code = 'BODY_ERROR';
        reject(error);
        return;
      }

      resolve(bodyBuffer);
    });
  });
}

async function createNntpPool(config, maxConnections, options = {}) {
  const numeric = Number.isFinite(maxConnections) ? Math.floor(maxConnections) : 1;
  const connectionCount = Math.max(1, numeric);
  const keepAliveMs = Number.isFinite(options.keepAliveMs) && options.keepAliveMs > 0 ? options.keepAliveMs : 0;

  const attachErrorHandler = (client) => {
    if (!client) return;
    try {
      client.on('error', (err) => {
        console.warn('[NZB TRIAGE] NNTP client error (pool)', {
          code: err?.code,
          message: err?.message,
          errno: err?.errno,
        });
      });
    } catch (_) {}
    try {
      const socketFields = ['socket', 'stream', '_socket', 'tlsSocket', 'connection'];
      for (const key of socketFields) {
        const s = client[key];
        if (s && typeof s.on === 'function') {
          s.on('error', (err) => {
            console.warn('[NZB TRIAGE] NNTP socket error (pool)', {
              socketProp: key,
              code: err?.code,
              message: err?.message,
              errno: err?.errno,
            });
          });
        }
      }
    } catch (_) {}
  };

  const connectTasks = Array.from({ length: connectionCount }, () => createNntpClient(config));
  let initialClients = [];
  try {
    const settled = await Promise.allSettled(connectTasks);
    const successes = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
    const failure = settled.find((entry) => entry.status === 'rejected');
    if (failure) {
      await Promise.all(successes.map(closeNntpClient));
      throw failure.reason;
    }
    initialClients = successes;
    initialClients.forEach(attachErrorHandler);
  } catch (err) {
    throw err;
  }

  const idle = initialClients.slice();
  const waiters = [];
  const allClients = new Set(initialClients);
  let closing = false;
  let lastUsed = Date.now();
  let keepAliveTimer = null;

  const touch = () => {
    lastUsed = Date.now();
  };

  const attemptReplacement = () => {
    if (closing) return;
    (async () => {
      try {
        const replacement = await createNntpClient(config);
        attachErrorHandler(replacement);
        allClients.add(replacement);
        if (waiters.length > 0) {
          const waiter = waiters.shift();
          touch();
          waiter(replacement);
        } else {
          idle.push(replacement);
          touch();
        }
      } catch (createErr) {
        console.warn('[NZB TRIAGE] Failed to create replacement NNTP client', createErr?.message || createErr);
        if (!closing) {
          setTimeout(attemptReplacement, 1000);
        }
      }
    })();
  };

  const scheduleReplacement = (client) => {
    if (client) {
      allClients.delete(client);
      (async () => {
        try {
          await closeNntpClient(client);
        } catch (closeErr) {
          console.warn('[NZB TRIAGE] Failed to close NNTP client cleanly', closeErr?.message || closeErr);
        }
        attemptReplacement();
      })();
    } else {
      attemptReplacement();
    }
  };

  const noopTimers = new Map();
  const KEEPALIVE_INTERVAL_MS = 30000;
  const KEEPALIVE_TIMEOUT_MS = 6000;

  const scheduleKeepAlive = (client) => {
    if (closing || noopTimers.has(client)) return;
    if (!isTriageActivityFresh()) return;
    const timer = setTimeout(async () => {
      noopTimers.delete(client);
      if (!isTriageActivityFresh()) return;
      try {
        const statStart = Date.now();
        const keepAliveMessageId = buildKeepAliveMessageId();
        await Promise.race([
          new Promise((resolve, reject) => {
            client.stat(keepAliveMessageId, (err) => {
              if (err && err.code === 430) {
                resolve(); // 430 = article not found, which is expected and means socket is alive
              } else if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Keep-alive timeout')), KEEPALIVE_TIMEOUT_MS))
        ]);
        const elapsed = Date.now() - statStart;
        timingLog('nntp-keepalive:success', { durationMs: elapsed });
        if (!closing && idle.includes(client) && isTriageActivityFresh()) {
          scheduleKeepAlive(client);
        }
      } catch (err) {
        timingLog('nntp-keepalive:failed', { message: err?.message });
        console.warn('[NZB TRIAGE] Keep-alive failed, replacing client', err?.message || err);
        const idleIndex = idle.indexOf(client);
        if (idleIndex !== -1) {
          idle.splice(idleIndex, 1);
        }
        scheduleReplacement(client);
      }
    }, KEEPALIVE_INTERVAL_MS);
    noopTimers.set(client, timer);
  };

  const cancelKeepAlive = (client) => {
    const timer = noopTimers.get(client);
    if (timer) {
      clearTimeout(timer);
      noopTimers.delete(client);
    }
  };

  const releaseClient = (client, drop) => {
    if (!client) return;
    if (drop) {
      cancelKeepAlive(client);
      scheduleReplacement(client);
      return;
    }
    if (waiters.length > 0) {
      const waiter = waiters.shift();
      touch();
      waiter(client);
    } else {
      idle.push(client);
      touch();
      scheduleKeepAlive(client);
    }
  };

  const acquireClient = () => new Promise((resolve, reject) => {
    if (closing) {
      reject(new Error('NNTP pool closing'));
      return;
    }
    if (idle.length > 0) {
      const client = idle.pop();
      cancelKeepAlive(client);
      touch();
      resolve(client);
    } else {
      waiters.push(resolve);
    }
  });

  if (keepAliveMs > 0) {
    keepAliveTimer = setInterval(() => {
      if (closing) return;
      if (!isTriageActivityFresh()) return;
      if (Date.now() - lastUsed < keepAliveMs) return;
      if (waiters.length > 0) return;
      if (idle.length === 0) return;
      const client = idle.pop();
      if (!client) return;
      scheduleReplacement(client);
      touch();
    }, keepAliveMs);
    if (typeof keepAliveTimer.unref === 'function') keepAliveTimer.unref();
  }

  return {
    size: connectionCount,
    acquire: acquireClient,
    release(client, options = {}) {
      const drop = Boolean(options.drop);
      releaseClient(client, drop);
    },
    async close() {
      closing = true;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
      }
      noopTimers.forEach((timer) => clearTimeout(timer));
      noopTimers.clear();
      const clientsToClose = Array.from(allClients);
      allClients.clear();
      idle.length = 0;
      waiters.splice(0, waiters.length).forEach((resolve) => resolve(null));
      await Promise.all(clientsToClose.map((client) => closeNntpClient(client)));
    },
    touch,
    getLastUsed() {
      return lastUsed;
    },
    getIdleCount() {
      return idle.length;
    },
  };
}

async function runWithClient(pool, handler) {
  if (!pool) throw new Error('NNTP pool unavailable');
  const acquireStart = Date.now();
  const client = await pool.acquire();
  timingLog('nntp-client:acquired', {
    waitDurationMs: Date.now() - acquireStart,
  });
  if (currentMetrics) currentMetrics.clientAcquisitions += 1;
  if (!client) throw new Error('NNTP client unavailable');
  let dropClient = false;
  try {
    return await handler(client);
  } catch (err) {
    if (err?.dropClient) dropClient = true;
    throw err;
  } finally {
    pool.release(client, { drop: dropClient });
  }
}

function decodeYencBuffer(bodyBuffer, maxBytes) {
  const out = Buffer.alloc(maxBytes);
  let writeIndex = 0;
  const lines = bodyBuffer.toString('binary').split('\r\n');
  let decoding = false;

  for (const line of lines) {
    if (!decoding) {
      if (line.startsWith('=ybegin')) decoding = true;
      continue;
    }

    if (line.startsWith('=ypart')) continue;
    if (line.startsWith('=yend')) break;

    const src = Buffer.from(line, 'binary');
    for (let i = 0; i < src.length; i += 1) {
      let byte = src[i];
      if (byte === 0x3D) { // '=' escape
        i += 1;
        if (i >= src.length) break;
        byte = (src[i] - 64) & 0xff;
      }
      byte = (byte - 42) & 0xff;
      out[writeIndex] = byte;
      writeIndex += 1;
      if (writeIndex >= maxBytes) return out;
    }
  }

  if (writeIndex === 0) {
    const error = new Error('No yEnc payload detected');
    error.code = 'DECODE_ERROR';
    throw error;
  }

  return out.slice(0, writeIndex);
}

async function createNntpClient({ host, port = 119, user, pass, useTLS = false, connTimeout }) {
  if (!NNTP) throw new Error('NNTP client unavailable');

  const client = new NNTP();
  const connectStart = Date.now();
  timingLog('nntp-connect:start', { host, port, useTLS, auth: Boolean(user) });
  
  // Attach early error handler to catch DNS/connection failures before 'ready'
  const earlyErrorHandler = (err) => {
    timingLog('nntp-connect:error', {
      host,
      port,
      useTLS,
      auth: Boolean(user),
      durationMs: Date.now() - connectStart,
      code: err?.code,
      message: err?.message,
    });
    console.warn('[NZB TRIAGE] NNTP connection error', {
      host,
      port,
      useTLS,
      message: err?.message,
      code: err?.code
    });
  };
  
  client.once('error', earlyErrorHandler);
  
  await new Promise((resolve, reject) => {
    client.once('ready', () => {
      // Remove the early error handler since we're about to add persistent ones
      client.removeListener('error', earlyErrorHandler);
      
      timingLog('nntp-connect:ready', {
        host,
        port,
        useTLS,
        auth: Boolean(user),
        durationMs: Date.now() - connectStart,
      });
      // Attach a runtime error handler to the client to prevent unhandled socket errors
      // from bubbling up and crashing the process. We log and let pool replacement
      // logic handle any broken clients.
      try {
        client.on('error', (err) => {
          timingLog('nntp-client:error', {
            host,
            port,
            useTLS,
            auth: Boolean(user),
            message: err?.message,
            code: err?.code,
          });
          console.warn('[NZB TRIAGE] NNTP client runtime error', err?.message || err);
        });
      } catch (_) {}
      try {
        // attach to a few common socket field names used by different NNTP implementations
        const socketFields = ['socket', 'stream', '_socket', 'tlsSocket', 'connection'];
        for (const key of socketFields) {
          const s = client[key];
          if (s && typeof s.on === 'function') {
            s.on('error', (err) => {
              timingLog('nntp-socket:error', { host, port, socketProp: key, message: err?.message, code: err?.code });
              console.warn('[NZB TRIAGE] NNTP socket runtime error', key, err?.message || err);
            });
          }
        }
      } catch (_) {}
      resolve();
    });
    // This error handler is for connection phase failures (DNS, TLS handshake, auth)
    // It will be removed and replaced with persistent handlers after 'ready'
    client.once('error', (err) => {
      reject(err);
    });
    
    // Intercept socket creation to attach error handlers immediately
    const originalConnect = client.connect;
    client.connect = function(...args) {
      const result = originalConnect.apply(this, args);
      // After connect() is called, the socket should exist
      process.nextTick(() => {
        try {
          const socketFields = ['socket', 'stream', '_socket', 'tlsSocket', 'connection'];
          for (const key of socketFields) {
            const s = client[key];
            if (s && typeof s.on === 'function' && !s.listenerCount('error')) {
              s.on('error', earlyErrorHandler);
            }
          }
        } catch (_) {}
      });
      return result;
    };
    
    client.connect({
      host,
      port,
      secure: useTLS,
      user,
      password: pass,
      connTimeout,
    });
  });
  return client;
}

function closeNntpClient(client) {
  return new Promise((resolve) => {
    const finalize = () => {
      client.removeListener('end', finalize);
      client.removeListener('close', finalize);
      client.removeListener('error', finalize);
      resolve();
    };

    client.once('end', finalize);
    client.once('close', finalize);
    client.once('error', finalize);
    try {
      client.end();
    } catch (_) {
      finalize();
      return;
    }
    setTimeout(finalize, 1000);
  });
}

function buildFlagCounts(decisions, property) {
  const counts = {};
  for (const decision of decisions) {
    const items = decision?.[property];
    if (!items || items.length === 0) continue;
    for (const item of items) {
      counts[item] = (counts[item] ?? 0) + 1;
    }
  }
  return counts;
}

function pickRandomSubset(items, fraction) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const desiredCount = Math.max(1, Math.ceil(items.length * fraction));
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(desiredCount, shuffled.length));
}

function collectUniqueSegments(files) {
  const unique = [];
  const seen = new Set();
  for (const file of files) {
    if (!file?.segments) continue;
    for (const segment of file.segments) {
      const segmentId = segment?.id;
      if (!segmentId || seen.has(segmentId)) continue;
      seen.add(segmentId);
      unique.push({ file, segmentId });
    }
  }
  return unique;
}

function pickRandomElements(items, maxCount) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const count = Math.min(maxCount, items.length);
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function buildErrorDecision(err, nzbIndex) {
  const blockers = new Set(['analysis-error']);
  const warnings = new Set();
  if (err?.code) warnings.add(`code:${err.code}`);
  if (err?.message) warnings.add(err.message);
  if (warnings.size === 0) warnings.add('analysis-failed');
  return buildDecision('reject', blockers, warnings, {
    fileCount: 0,
    nzbTitle: null,
    nzbIndex,
    archiveFindings: [],
  });
}

function buildPoolKey(config, connections, keepAliveMs = 0) {
  return [
    config.host,
    config.port ?? 119,
    config.user ?? '',
    config.useTLS ? 'tls' : 'plain',
    connections,
    keepAliveMs,
  ].join('|');
}

async function closeSharedNntpPool(reason = 'manual') {
  if (sharedNntpPoolRecord?.pool) {
    await closePool(sharedNntpPoolRecord.pool, reason);
    sharedNntpPoolRecord = null;
  }
}

function runWithDeadline(factory, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return factory();
  let timer = null;
  let operationPromise;
  try {
    operationPromise = factory();
  } catch (err) {
    return Promise.reject(err);
  }
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Health check timed out');
      error.code = 'HEALTHCHECK_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = {
  preWarmNntpPool,
  triageNzbs,
  closeSharedNntpPool,
};
