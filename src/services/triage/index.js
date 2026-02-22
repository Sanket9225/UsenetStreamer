const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const lzma = require('lzma-native');
const { isVideoFileName } = require('../../utils/parsers');
const NNTPModule = require('nntp/lib/nntp');
const NNTP = typeof NNTPModule === 'function' ? NNTPModule : NNTPModule?.NNTP;
function timingLog(event, details) {
  const payload = details ? { ...details, ts: new Date().toISOString() } : { ts: new Date().toISOString() };
  // console.log(`[NZB TRIAGE][TIMING] ${event}`, payload);
}

const ARCHIVE_EXTENSIONS = new Set(['.rar', '.r00', '.r01', '.r02', '.7z', '.zip']);
const VIDEO_FILE_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.avi', '.ts', '.m4v', '.mpg', '.mpeg', '.wmv', '.flv', '.webm'];
const ISO_FILE_EXTENSIONS = ['.iso'];
const ARCHIVE_ONLY_MIN_PARTS = 10;
const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ARCHIVE_SAMPLE_ENTRY_LIMIT = 5;

const TRIAGE_ACTIVITY_TTL_MS = 5 * 60 * 1000; // 5 mins window for keep-alives
let lastTriageActivityTs = 0;

const DEFAULT_OPTIONS = {
  archiveDirs: [],
  nntpConfig: null,
  healthCheckTimeoutMs: 35000,
  maxDecodedBytes: 256 * 1024,
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

  // If there's already a build in progress, await it instead of starting a second one
  const existingBuild = getInFlightPoolBuild();
  if (existingBuild) {
    await existingBuild;
    return;
  }

  // If pool exists and matches config, just touch it
  if (sharedNntpPoolRecord?.key === poolKey && sharedNntpPoolRecord?.pool) {
    if (isSharedPoolStale()) {
      await closeSharedNntpPool('stale-prewarm');
    } else {
      if (typeof sharedNntpPoolRecord.pool.touch === 'function') {
        sharedNntpPoolRecord.pool.touch();
      }
      return;
    }
  }

  const buildPromise = (async () => {
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
  })();

  setInFlightPoolBuild(buildPromise);
  await buildPromise;
  clearInFlightPoolBuild(buildPromise);
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
  const archiveFiles = files.filter(isArchiveFile);
  const archiveCandidates = dedupeArchiveCandidates(archiveFiles);
  const checkedSegments = new Set();
  let primaryArchive = null;

  // Early NZB-level check: detect multipart RAR sets with inconsistent segment counts
  const inconsistentParts = detectInconsistentRarParts(files);
  if (inconsistentParts) {
    blockers.add('rar-inconsistent-parts');
    archiveFindings.push({
      source: 'nzb-metadata',
      filename: inconsistentParts.sample,
      subject: null,
      status: 'rar-inconsistent-parts',
      details: {
        archiveName: inconsistentParts.archiveName,
        totalParts: inconsistentParts.totalParts,
        expectedSegments: inconsistentParts.expectedSegments,
        mismatchCount: inconsistentParts.mismatchCount,
        segmentCounts: inconsistentParts.segmentCounts,
      },
    });
  }

  const hasPlayableVideo = files.some((file) => {
    const name = file.filename || guessFilenameFromSubject(file.subject) || '';
    return isPlayableVideoName(name);
  });


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
      const fallbackSampleCount = Math.max(1, Math.floor(ctx.config?.archiveSampleCount ?? 1));
      const sampledSegments = pickRandomElements(uniqueSegments, fallbackSampleCount);
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
    const archiveWithSegments = selectArchiveForInspection(archiveCandidates);
    if (archiveWithSegments) {
      const nzbPassword = extractPassword(parsed);
      const nntpResult = await inspectArchiveViaNntp(archiveWithSegments, ctx, files, nzbPassword);
      archiveFindings.push({
        source: 'nntp',
        filename: archiveWithSegments.filename,
        subject: archiveWithSegments.subject,
        status: nntpResult.status,
        details: nntpResult.details ?? null,
      });
      if (nntpResult.segmentId) {
        checkedSegments.add(nntpResult.segmentId);
        if (nntpResult.status === 'rar-stored' || nntpResult.status === 'sevenzip-signature-ok') {
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

  // Run STAT sampling for any archive inspection (including 7z) to detect missing articles
  const archiveInspected = Boolean(primaryArchive);
  if (ctx.nntpPool && archiveInspected && blockers.size === 0) {
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

    const archiveSampleCount = Math.max(0, Math.floor(ctx.config?.archiveSampleCount ?? 0));
    if (archiveSampleCount > 0) {
      const primaryKey = canonicalArchiveKey(primaryArchive?.filename || primaryArchive?.subject || '');
      const candidateArchives = archiveCandidates.filter((archive) => {
        if (!archive?.segments?.length) return false;
        const key = canonicalArchiveKey(archive.filename || archive.subject || '');
        if (primaryKey && key === primaryKey) return false;
        if (!archive.segments.some((segment) => segment?.id && !checkedSegments.has(segment.id))) return false;
        return true;
      });

      const uniqueCandidates = [];
      const seenArchiveKeys = new Set();
      candidateArchives.forEach((archive) => {
        const key = canonicalArchiveKey(archive.filename || archive.subject || '');
        if (!key || seenArchiveKeys.has(key)) return;
        seenArchiveKeys.add(key);
        uniqueCandidates.push(archive);
      });

      const sampleArchives = pickRandomElements(uniqueCandidates, archiveSampleCount);

      await Promise.all(sampleArchives.map(async (archive) => {
        const segment = archive.segments.find((entry) => entry?.id && !checkedSegments.has(entry.id));
        if (!segment) return;
        await runStatCheck(archive, segment);
      }));
    }
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

function extractPassword(parsedNzb) {
  const meta = parsedNzb?.nzb?.head?.meta;
  if (!meta) return null;
  const items = Array.isArray(meta) ? meta : [meta];
  const match = items.find((entry) => entry?.$?.type === 'password');
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

function isArchiveEntryName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return /\.r\d{2}(?:\b|$)/.test(lower)
    || /\.part\d+\.rar/.test(lower)
    || lower.endsWith('.rar')
    || lower.endsWith('.7z')
    || lower.endsWith('.zip');
}

function isIsoFileName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return ISO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isDiscStructurePath(name) {
  if (!name) return false;
  const lower = name.toLowerCase().replace(/\\/g, '/');
  // Blu-ray disc: BDMV/ directory structure
  if (/\bbdmv\//.test(lower)) return true;
  // DVD disc: VIDEO_TS/ directory structure
  if (/\bvideo_ts\//.test(lower)) return true;
  // Blu-ray/DVD root markers
  if (lower.endsWith('.bdjo') || lower.endsWith('.clpi') || lower.endsWith('.mpls')) return true;
  if (lower.endsWith('.bup') || lower.endsWith('.ifo') || lower.endsWith('.vob')) return true;
  return false;
}

function isPlayableVideoName(name) {
  if (!name) return false;
  if (!isVideoFileName(name)) return false;
  return !/sample|proof/i.test(name);
}

function isSevenZipFilename(name) {
  if (!name) return false;
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('.7z')) return true;
  return /\.7z\.\d{2,3}$/.test(lower);
}

function analyzeBufferFilenames(buffer) {
  if (!buffer || buffer.length === 0) {
    return { nested: 0, playable: 0, discImages: 0, samples: [] };
  }
  const ascii = buffer.toString('latin1');
  const filenameRegex = /[A-Za-z0-9_\-()\[\]\s]{3,120}\.[A-Za-z0-9]{2,5}(?:\.[A-Za-z0-9]{2,5})?/g;
  const matches = ascii.match(filenameRegex) || [];
  let nested = 0;
  let playable = 0;
  let discImages = 0;
  const samples = [];
  matches.forEach((raw) => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;
    samples.push(normalized);
    if (VIDEO_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext))) {
      playable += 1;
      return;
    }
    if (ISO_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext))) {
      discImages += 1;
      return;
    }
    if (isArchiveEntryName(normalized)) {
      nested += 1;
    }
  });
  return { nested, playable, discImages, samples };
}

function recordSampleEntry(target, name) {
  if (!target || !name) return;
  if (target.includes(name)) return;
  if (target.length >= ARCHIVE_SAMPLE_ENTRY_LIMIT) return;
  target.push(name);
}

function applyHeuristicArchiveHints(result, buffer, context = {}) {
  if (!buffer || buffer.length === 0) {
    return result;
  }
  const statusLabel = String(result?.status || '').toLowerCase();
  if (statusLabel.startsWith('sevenzip')) {
    return result;
  }
  const hints = analyzeBufferFilenames(buffer);
  if (hints.discImages > 0) {
    return {
      status: 'rar-iso-image',
      details: {
        ...(result.details || {}),
        discImages: hints.discImages,
        heuristic: true,
        sample: hints.samples[0] || null,
        filename: context.filename || null,
      }
    };
  }
  if (hints.nested > 0 && hints.playable === 0) {
    const detailPatch = {
      ...(result.details || {}),
      nestedEntries: hints.nested,
      heuristic: true,
      sample: hints.samples[0] || null,
      filename: context.filename || null,
    };
    if (result.status.startsWith('sevenzip')) {
      return { status: 'sevenzip-nested-archive', details: detailPatch };
    }
    if (result.status === 'rar-stored' || result.status === 'rar5-unsupported') {
      return { status: 'rar-nested-archive', details: detailPatch };
    }
  }
  return result;
}

function getExtension(filename) {
  if (!filename) return undefined;
  const lower = filename.toLowerCase();
  const splitMatch = lower.match(/\.(rar|7z|zip)\.(?:part)?\d{2,3}$/);
  if (splitMatch) return `.${splitMatch[1]}`;
  const partMatch = lower.match(/\.part\d+\.(rar|7z|zip)$/);
  if (partMatch) return `.${partMatch[1]}`;
  const lastDot = lower.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  return lower.slice(lastDot);
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

// Detect multipart .partNN.rar sets with wildly inconsistent segment counts.
// In a healthy multipart RAR, all volumes except the last have the same segment count.
// If parts have wildly different sizes, the NZB was likely filled/patched with bad data.
const PARTNN_RAR_RE = /^(.+)\.part(\d+)\.rar$/i;
function detectInconsistentRarParts(files) {
  const groups = new Map();
  for (const file of files) {
    const name = file.filename || guessFilenameFromSubject(file.subject) || '';
    const m = PARTNN_RAR_RE.exec(name);
    if (!m) continue;
    const archiveName = m[1].toLowerCase();
    const partNum = parseInt(m[2], 10);
    const segCount = Array.isArray(file.segments) ? file.segments.length : 0;
    if (!groups.has(archiveName)) groups.set(archiveName, []);
    groups.get(archiveName).push({ partNum, segCount, filename: name });
  }

  for (const [archiveName, parts] of groups) {
    if (parts.length < 3) continue; // Need at least 3 parts to judge consistency
    // Sort by part number so we can exclude the last part (which is expected to be smaller)
    parts.sort((a, b) => a.partNum - b.partNum);
    const allButLast = parts.slice(0, -1);
    if (allButLast.length < 2) continue;
    const expectedSize = allButLast[0].segCount;
    if (expectedSize === 0) continue;
    const mismatchCount = allButLast.filter((p) => p.segCount !== expectedSize).length;
    // If more than 20% of parts (excluding last) have different segment counts, flag it
    if (mismatchCount > 0 && mismatchCount / allButLast.length > 0.2) {
      const sizes = parts.map((p) => p.segCount);
      return {
        archiveName,
        totalParts: parts.length,
        expectedSegments: expectedSize,
        mismatchCount,
        segmentCounts: sizes,
        sample: parts.find((p) => p.segCount !== expectedSize)?.filename || null,
      };
    }
  }
  return null;
}

function canonicalArchiveKey(name) {
  if (!name) return null;
  return name.toLowerCase();
}

function selectArchiveForInspection(archives) {
  if (!Array.isArray(archives) || archives.length === 0) return null;
  const candidates = archives
    .filter((archive) => archive.segments && archive.segments.length > 0)
    .map((archive) => ({
      archive,
      score: buildArchiveScore(archive),
    }))
    .sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].archive : null;
}

function buildArchiveScore(archive) {
  const filename = archive.filename || guessFilenameFromSubject(archive.subject) || '';
  let score = 0;
  if (/\.rar$/i.test(filename)) score += 10;
  if (/\.r\d{2}$/i.test(filename)) score += 9;
  if (/\.part\d+\.rar$/i.test(filename)) score += 8;
  if (/\.7z$/i.test(filename)) score += 10;
  if (/\.7z\.001$/i.test(filename)) score += 10;
  if (/\.7z\.\d{3}$/i.test(filename)) score += 9;
  if (/proof|sample|nfo/i.test(filename)) score -= 5;
  if (isVideoFileName(filename)) score += 4;
  return score;
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

async function inspectArchiveViaNntp(file, ctx, allFiles, nzbPassword) {
  const segments = file.segments ?? [];
  if (segments.length === 0) return { status: 'archive-no-segments' };
  const segmentId = segments[0]?.id;
  if (!segmentId) return { status: 'archive-no-segments' };
  const effectiveFilename = file.filename || guessFilenameFromSubject(file.subject) || '';
  const isSevenZip = isSevenZipFilename(effectiveFilename);
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

    // 7z: attempt deep inspection (fetch header + footer, parse coders in pure JS)
    if (isSevenZip) {
      try {
        const deepResult = await inspectSevenZipDeep(file, ctx, allFiles || [], client, nzbPassword);
        return { ...deepResult, segmentId };
      } catch (err) {
        // Deep inspection failed; fall back to signature-ok so 7z still caps at unverified_7z
        return { status: 'sevenzip-signature-ok', details: { filename: effectiveFilename, deepError: err?.message }, segmentId };
      }
    }

    let bodyStart = null;
    if (currentMetrics) {
      currentMetrics.bodyCalls += 1;
      bodyStart = Date.now();
    }

    try {
      const bodyBuffer = await fetchSegmentBodyWithClient(client, segmentId);
      const decoded = decodeYencBuffer(bodyBuffer, ctx.config.maxDecodedBytes);
      // console.log('[NZB TRIAGE] Inspecting archive buffer', {
      //   filename: file.filename,
      //   subject: file.subject,
      //   segmentId,
      //   sampleBytes: decoded.slice(0, 8).toString('hex'),
      // });
      let archiveResult = inspectArchiveBuffer(decoded);
      archiveResult = applyHeuristicArchiveHints(archiveResult, decoded, { filename: effectiveFilename });
      // console.log('[NZB TRIAGE] Archive inspection via NNTP', {
      //   status: archiveResult.status,
      //   details: archiveResult.details,
      //   filename: file.filename,
      //   subject: file.subject,
      // });
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
    case 'sevenzip-stored':
      return true;
    case 'sevenzip-signature-ok':
      warnings.add('sevenzip-signature-ok');
      break;
    case 'rar-compressed':
    case 'rar-encrypted':
    case 'rar-solid':
    case 'rar5-unsupported':
    case 'rar-nested-archive':
    case 'rar-corrupt-header':
    case 'sevenzip-nested-archive':
    case 'sevenzip-unsupported':
    case 'sevenzip-encrypted':
    case 'rar-iso-image':
    case 'rar-disc-structure':
    case 'rar-insufficient-data':
    case 'rar-inconsistent-parts':
      blockers.add(status);
      break;
    case 'stat-missing':
    case 'body-missing':
      blockers.add('missing-articles');
      break;
    case 'archive-not-found':
    case 'archive-no-segments':
    case 'rar-header-not-found':
    case 'sevenzip-insufficient-data':
    case 'io-error':
    case 'stat-error':
    case 'body-error':
    case 'decode-error':
    case 'missing-filename':
      warnings.add(status);
      break;
    case 'sevenzip-untested':
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

  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    return inspectZip(buffer);
  }

  return { status: 'rar-header-not-found' };
}

function inspectRar4(buffer) {
  let offset = RAR4_SIGNATURE.length;
  let storedDetails = null;
  let nestedArchiveCount = 0;
  let playableEntryFound = false;
  const sampleEntries = [];

  while (offset + 7 <= buffer.length) {
    const headerCRC = buffer.readUInt16LE(offset);
    const headerType = buffer[offset + 2];
    const headerFlags = buffer.readUInt16LE(offset + 3);
    const headerSize = buffer.readUInt16LE(offset + 5);

    // Block type outside the valid RAR4 range (0x72-0x7B): stop parsing.
    // This handles zero-filled buffer tails, alignment padding, and unknown sub-blocks
    // that can appear between entries in multi-volume Blu-ray or large RAR archives.
    if (headerType < 0x72 || headerType > 0x7B) {
      break;
    }

    if (headerSize < 7) return { status: 'rar-corrupt-header' };
    if (offset + headerSize > buffer.length) return { status: 'rar-insufficient-data' };

    let addSize = 0;

    // ADD_SIZE / LONG_BLOCK flag (0x8000): header has additional data after the header body
    // This applies to ALL block types, not just file headers
    if ((headerFlags & 0x8000) && headerType !== 0x74) {
      if (offset + 7 + 4 <= buffer.length) {
        addSize = buffer.readUInt32LE(offset + 7);
      }
    }

    if (headerType === 0x74) {
      let pos = offset + 7;
      if (pos + 11 > buffer.length) return { status: 'rar-insufficient-data' };
      
      const packSize = buffer.readUInt32LE(pos); 
      addSize = packSize;
      
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
      if (headerFlags & 0x0100) {
        if (pos + 8 > buffer.length) return { status: 'rar-insufficient-data' };
        const highPackSize = buffer.readUInt32LE(pos);
        addSize += highPackSize * 4294967296;
        pos += 8; // high pack size (4) + high unpack size (4)
      }
      // if (headerFlags & 0x0200) pos += 4; // REMOVED: 0x0200 is UNICODE, not size
      if (pos + nameSize > buffer.length) return { status: 'rar-insufficient-data' };
      const name = buffer.slice(pos, pos + nameSize).toString('utf8').replace(/\0/g, '');
      recordSampleEntry(sampleEntries, name);
      if (isIsoFileName(name)) {
        return { status: 'rar-iso-image', details: { name, sampleEntries } };
      }
      const encrypted = Boolean(headerFlags & 0x0004);
      const solid = Boolean(headerFlags & 0x0010);

      // console.log(`[RAR4] Found entry: "${name}" (method: ${methodByte}, encrypted: ${encrypted}, solid: ${solid})`);

      if (encrypted) return { status: 'rar-encrypted', details: { name, sampleEntries } };
      if (solid) return { status: 'rar-solid', details: { name, sampleEntries } };
      if (methodByte !== 0x30) {
        return { status: 'rar-compressed', details: { name, method: methodByte, sampleEntries } };
      }

      if (!storedDetails) {
        storedDetails = { name, method: methodByte };
      }
      if (isVideoFileName(name)) {
        playableEntryFound = true;
      } else if (isArchiveEntryName(name)) {
        nestedArchiveCount += 1;
      }
      if (isDiscStructurePath(name)) {
        return { status: 'rar-disc-structure', details: { name, sampleEntries } };
      }
    }

    offset += headerSize + addSize;
  }

  if (storedDetails) {
    if (nestedArchiveCount > 0 && !playableEntryFound) {
      return {
        status: 'rar-nested-archive',
        details: { nestedEntries: nestedArchiveCount, sampleEntries },
      };
    }
    return { status: 'rar-stored', details: { ...storedDetails, sampleEntries } };
  }

  return { status: 'rar-header-not-found' };
}

function inspectRar5(buffer) {
  let offset = RAR5_SIGNATURE.length;
  let nestedArchiveCount = 0;
  let playableEntryFound = false;
  let storedDetails = null;
  const sampleEntries = [];

  while (offset < buffer.length) {
    if (offset + 7 > buffer.length) break;

    // const crc = buffer.readUInt32LE(offset);
    let pos = offset + 4;

    const sizeRes = readRar5Vint(buffer, pos);
    if (!sizeRes) break;
    const headerSize = sizeRes.value;
    pos += sizeRes.bytes;

    const typeRes = readRar5Vint(buffer, pos);
    if (!typeRes) break;
    const headerType = typeRes.value;
    pos += typeRes.bytes;

    const flagsRes = readRar5Vint(buffer, pos);
    if (!flagsRes) break;
    const headerFlags = flagsRes.value;
    pos += flagsRes.bytes;

    let extraAreaSize = 0;
    let dataSize = 0;

    if (headerType === 0x02 || headerType === 0x03) {
      const hasExtraArea = (headerFlags & 0x0001) !== 0;
      const hasData = (headerFlags & 0x0002) !== 0;

      if (hasExtraArea) {
        const extraRes = readRar5Vint(buffer, pos);
        if (!extraRes) break;
        extraAreaSize = extraRes.value;
        pos += extraRes.bytes;
      }

      if (hasData) {
        const dataRes = readRar5Vint(buffer, pos);
        if (!dataRes) break;
        dataSize = dataRes.value;
        pos += dataRes.bytes;
      }
    }

    // Correct offset calculation:
    // Block = CRC(4) + Size(VINT) + HeaderData(headerSize) + Data(dataSize)
    // We already advanced 'pos' past CRC and Size(VINT) to read the Type.
    // Actually, 'headerSize' includes the Type, Flags, etc.
    // So the block ends at: (offset + 4 + sizeRes.bytes) + headerSize + dataSize
    const nextBlockOffset = offset + 4 + sizeRes.bytes + headerSize + dataSize;
    
    // console.log(`[RAR5] Block type: ${headerType}, size: ${headerSize}, data: ${dataSize}, next: ${nextBlockOffset}`);

    if (headerType === 0x02) { // File Header
      const fileFlagsRes = readRar5Vint(buffer, pos);
      if (fileFlagsRes) {
        pos += fileFlagsRes.bytes;
        const fileFlags = fileFlagsRes.value;

        const unpackSizeRes = readRar5Vint(buffer, pos);
        if (unpackSizeRes) {
          pos += unpackSizeRes.bytes;

          const attrRes = readRar5Vint(buffer, pos);
          if (attrRes) {
            pos += attrRes.bytes;

            if (fileFlags & 0x0002) pos += 4; // MTime
            if (fileFlags & 0x0004) pos += 4; // CRC

            const compInfoRes = readRar5Vint(buffer, pos);
            if (compInfoRes) {
              const compInfo = compInfoRes.value;
              const methodCode = compInfo & 0x3F;
              if (methodCode !== 0) {
                return {
                  status: 'rar-compressed',
                  details: { method: methodCode, compInfo, format: 'rar5', sampleEntries },
                };
              }
              pos += compInfoRes.bytes;

              const hostOsRes = readRar5Vint(buffer, pos);
              if (hostOsRes) {
                pos += hostOsRes.bytes;

                const nameLenRes = readRar5Vint(buffer, pos);
                if (nameLenRes) {
                  pos += nameLenRes.bytes;
                  const nameLen = nameLenRes.value;

                  if (pos + nameLen <= buffer.length) {
                    const name = buffer.slice(pos, pos + nameLen).toString('utf8');
                    // console.log(`[RAR5] Found entry: "${name}"`);

                    if (!storedDetails) storedDetails = { name };
                    recordSampleEntry(sampleEntries, name);
                    if (isIsoFileName(name)) {
                      return { status: 'rar-iso-image', details: { name, sampleEntries } };
                    }

                    if (isVideoFileName(name)) {
                      playableEntryFound = true;
                    } else if (isArchiveEntryName(name)) {
                      nestedArchiveCount += 1;
                    }
                    if (isDiscStructurePath(name)) {
                      return { status: 'rar-disc-structure', details: { name, sampleEntries } };
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    offset = nextBlockOffset;
  }

  if (storedDetails) {
    if (nestedArchiveCount > 0 && !playableEntryFound) {
      // console.log('[NZB TRIAGE] Detected nested archive (RAR5)', {
      //   nestedEntries: nestedArchiveCount,
      //   sample: storedDetails?.name,
      // });
      return {
        status: 'rar-nested-archive',
        details: { nestedEntries: nestedArchiveCount, sampleEntries },
      };
    }
    // console.log('[NZB TRIAGE] RAR5 archive marked stored', {
    //   playableEntryFound,
    //   nestedEntries: nestedArchiveCount,
    //   sample: storedDetails?.name,
    // });
    return { status: 'rar-stored', details: { ...storedDetails, sampleEntries } };
  }

  return { status: 'rar-stored', details: { note: 'rar5-header-assumed-stored', sampleEntries } };
}

function readRar5Vint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let bytes = 0;
  while (offset + bytes < buffer.length) {
    const b = buffer[offset + bytes];
    bytes += 1;
    result += (b & 0x7F) * Math.pow(2, shift);
    shift += 7;
    if ((b & 0x80) === 0) {
      return { value: result, bytes };
    }
    if (shift > 50) break;
  }
  return null;
}

function inspectZip(buffer) {
  let offset = 0;
  let nestedArchiveCount = 0;
  let playableEntryFound = false;
  let storedDetails = null;
  const sampleEntries = [];

  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);

    if (signature === ZIP_CENTRAL_DIRECTORY_SIGNATURE || signature === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }

    if (signature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      break;
    }

    if (offset + 30 > buffer.length) return { status: 'rar-insufficient-data' };

    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    const headerEnd = offset + 30 + nameLength + extraLength;
    if (headerEnd > buffer.length) return { status: 'rar-insufficient-data' };

    const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8').replace(/\0/g, '');
    recordSampleEntry(sampleEntries, name);

    if (!storedDetails) {
      storedDetails = { name, method, format: 'zip' };
    }

    if (isIsoFileName(name)) {
      return { status: 'rar-iso-image', details: { name, sampleEntries } };
    }

    if ((flags & 0x0001) !== 0) {
      return { status: 'rar-encrypted', details: { name, format: 'zip', sampleEntries } };
    }

    if (method !== 0) {
      return { status: 'rar-compressed', details: { name, method, format: 'zip', sampleEntries } };
    }

    if (isVideoFileName(name)) {
      playableEntryFound = true;
    } else if (isArchiveEntryName(name)) {
      nestedArchiveCount += 1;
    }
    if (isDiscStructurePath(name)) {
      return { status: 'rar-disc-structure', details: { name, sampleEntries } };
    }

    if (compressedSize === 0xFFFFFFFF) return { status: 'rar-insufficient-data' };

    const nextOffset = headerEnd + compressedSize;
    if (nextOffset <= offset) return { status: 'rar-insufficient-data' };
    if (nextOffset > buffer.length) return { status: 'rar-insufficient-data' };
    offset = nextOffset;
  }

  if (storedDetails) {
    if (nestedArchiveCount > 0 && !playableEntryFound) {
      return {
        status: 'rar-nested-archive',
        details: { nestedEntries: nestedArchiveCount, sampleEntries },
      };
    }
    return { status: 'rar-stored', details: { ...storedDetails, sampleEntries } };
  }

  return { status: 'rar-header-not-found' };
}

// Simple 7z signature check (used as fallback by inspectArchiveBuffer)
function inspectSevenZip(buffer) {
  if (buffer.length < 6
    || buffer[0] !== 0x37
    || buffer[1] !== 0x7A
    || buffer[2] !== 0xBC
    || buffer[3] !== 0xAF
    || buffer[4] !== 0x27
    || buffer[5] !== 0x1C) {
    return { status: 'sevenzip-insufficient-data', details: 'invalid or missing 7z signature' };
  }
  return { status: 'sevenzip-signature-ok' };
}

// ---------------------------------------------------------------------------
// 7z deep inspection: fetch start header (first segment of first part) and
// footer (last segment of last part), then parse the metadata header in pure
// JS to determine if all coders are copy-only (stored).
// ---------------------------------------------------------------------------

const SEVENZIP_SIGNATURE = Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]);

function findSevenZipParts(files, targetFile) {
  const targetName = targetFile.filename || guessFilenameFromSubject(targetFile.subject);
  if (!targetName) return [targetFile];
  const match = targetName.match(/^(.+)\.7z(?:\.\d{3})?$/i);
  if (!match) return [targetFile];
  const baseName = match[1].toLowerCase();
  const parts = files.filter((f) => {
    const name = f.filename || guessFilenameFromSubject(f.subject);
    if (!name) return false;
    const m = name.match(/^(.+)\.7z(?:\.\d{3})?$/i);
    return m && m[1].toLowerCase() === baseName;
  });
  parts.sort((a, b) => {
    const nameA = (a.filename || guessFilenameFromSubject(a.subject) || '').toLowerCase();
    const nameB = (b.filename || guessFilenameFromSubject(b.subject) || '').toLowerCase();
    const mA = nameA.match(/\.7z\.(\d{3})$/);
    const mB = nameB.match(/\.7z\.(\d{3})$/);
    const pA = mA ? parseInt(mA[1], 10) : 0; // .7z alone = part 0
    const pB = mB ? parseInt(mB[1], 10) : 0;
    return pA - pB;
  });
  return parts.length > 0 ? parts : [targetFile];
}

async function inspectSevenZipDeep(file, ctx, allFiles, client, nzbPassword) {
  const parts = findSevenZipParts(allFiles, file);
  const firstPart = parts[0];
  const lastPart = parts[parts.length - 1];

  // --- Fetch first segment of first part (contains 7z start header) ---
  const firstSegments = firstPart.segments ?? [];
  if (firstSegments.length === 0) {
    return { status: 'sevenzip-signature-ok', details: { reason: 'no-first-segments' } };
  }
  const firstSegId = firstSegments[0]?.id;
  if (!firstSegId) {
    return { status: 'sevenzip-signature-ok', details: { reason: 'no-first-segment-id' } };
  }

  const headerBody = await fetchSegmentBodyWithClient(client, firstSegId);
  const headerBuf = decodeYencBuffer(headerBody, 2 * 1024 * 1024);

  // Verify signature
  if (headerBuf.length < 32 || !headerBuf.subarray(0, 6).equals(SEVENZIP_SIGNATURE)) {
    return { status: 'sevenzip-insufficient-data', details: { reason: 'invalid-signature' } };
  }

  const nextHeaderOffset = Number(headerBuf.readBigUInt64LE(12));
  const nextHeaderSize = Number(headerBuf.readBigUInt64LE(20));

  if (nextHeaderSize <= 0 || nextHeaderSize > 10 * 1024 * 1024) {
    // Metadata > 10MB is unreasonable; bail out
    return { status: 'sevenzip-signature-ok', details: { reason: 'metadata-too-large', nextHeaderSize } };
  }

  // --- Fetch last segment of last part (contains 7z metadata footer) ---
  const lastSegments = lastPart.segments ?? [];
  if (lastSegments.length === 0) {
    return { status: 'sevenzip-signature-ok', details: { reason: 'no-last-segments' } };
  }
  const lastSegId = lastSegments[lastSegments.length - 1]?.id;
  if (!lastSegId) {
    return { status: 'sevenzip-signature-ok', details: { reason: 'no-last-segment-id' } };
  }

  const footerBody = await fetchSegmentBodyWithClient(client, lastSegId);
  const footerBuf = decodeYencBuffer(footerBody, 2 * 1024 * 1024);

  // The metadata header lives at the very end of the archive.
  // footerBuf is the decoded last segment, so the metadata should be
  // in the last nextHeaderSize bytes of footerBuf.
  if (footerBuf.length < nextHeaderSize) {
    return { status: 'sevenzip-signature-ok', details: { reason: 'footer-too-small', footerLen: footerBuf.length, needed: nextHeaderSize } };
  }

  // Try parsing from the expected position first, then scan backwards
  // in case the archive doesn't fill the segment to the exact end.
  const attempts = [];
  // Attempt 1: metadata at very end
  attempts.push(footerBuf.subarray(footerBuf.length - nextHeaderSize));
  // Attempt 2: scan for kHeader (0x01) or kEncodedHeader (0x17) within last region
  for (let offset = footerBuf.length - nextHeaderSize; offset >= Math.max(0, footerBuf.length - nextHeaderSize - 256); offset--) {
    const byte = footerBuf[offset];
    if ((byte === 0x01 || byte === 0x17) && offset !== footerBuf.length - nextHeaderSize) {
      attempts.push(footerBuf.subarray(offset));
      break;
    }
  }

  let lastError = null;
  for (const metadataSlice of attempts) {
    const parseResult = parseSevenZipMetadata(metadataSlice);
    if (parseResult.error) {
      lastError = { error: parseResult.error, sliceLen: metadataSlice.length, firstBytes: metadataSlice.subarray(0, Math.min(8, metadataSlice.length)).toString('hex') };
      continue;
    }

    // If encoded header, try to decompress the real header from footerBuf
    if (parseResult.encodedHeader && parseResult.encodedInfo) {
      try {
        const realHeader = await decompressEncodedHeader(parseResult.encodedInfo, footerBuf, nextHeaderSize);
        if (realHeader) {
          const innerResult = parseSevenZipMetadata(realHeader);
          if (!innerResult.error && !innerResult.encodedHeader) {
            const fnames = innerResult.filenames || [];
            const nestedArchive = sz_detectNestedArchive(fnames);
            if (innerResult.compressed) {
              return { status: 'sevenzip-unsupported', details: { reason: 'compressed-coder-detected', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, debug: innerResult.debug, filenames: fnames } };
            }
            if (nestedArchive) {
              return { status: 'sevenzip-nested-archive', details: { reason: 'nested-archive-detected', nestedType: nestedArchive, nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, filenames: fnames } };
            }
            if (sz_hasDiscStructure(fnames)) {
              return { status: 'sevenzip-unsupported', details: { reason: 'disc-structure-detected', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, filenames: fnames } };
            }
            const innerStatus = sz_hasPlayableVideo(fnames) ? 'sevenzip-stored' : 'sevenzip-signature-ok';
            return { status: innerStatus, details: { reason: 'copy-only-confirmed', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, debug: innerResult.debug, filenames: fnames } };
          }
          // Inner parse failed
          return { status: 'sevenzip-signature-ok', details: { reason: 'encoded-header-inner-parse-failed', nextHeaderSize, footerLen: footerBuf.length, innerError: innerResult.error, realHeaderLen: realHeader.length, realHeaderFirst8: realHeader.subarray(0, Math.min(8, realHeader.length)).toString('hex') } };
        }
        // realHeader was null — check if the encoded header is encrypted (AES)
        const method = parseResult.encodedInfo?.coderMethod || '';
        if (method.startsWith('06f107')) {
          // If we have a password from NZB metadata, try to decrypt the encoded header
          if (nzbPassword && parseResult.encodedInfo.coders?.length >= 2) {
            try {
              const decryptedHeader = await decryptEncodedHeader(parseResult.encodedInfo, footerBuf, nextHeaderSize, nzbPassword);
              if (decryptedHeader) {
                const innerResult = parseSevenZipMetadata(decryptedHeader);
                if (!innerResult.error && !innerResult.encodedHeader) {
                  const fnames = innerResult.filenames || [];
                  const nestedArchive = sz_detectNestedArchive(fnames);
                  if (innerResult.compressed) {
                    return { status: 'sevenzip-unsupported', details: { reason: 'encrypted-compressed-coder', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, encrypted: true, debug: innerResult.debug, filenames: fnames } };
                  }
                  if (nestedArchive) {
                    return { status: 'sevenzip-nested-archive', details: { reason: 'encrypted-nested-archive', nestedType: nestedArchive, nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, encrypted: true, filenames: fnames } };
                  }
                  if (sz_hasDiscStructure(fnames)) {
                    return { status: 'sevenzip-unsupported', details: { reason: 'encrypted-disc-structure', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, encrypted: true, filenames: fnames } };
                  }
                  const innerStatus = sz_hasPlayableVideo(fnames) ? 'sevenzip-stored' : 'sevenzip-signature-ok';
                  return { status: innerStatus, details: { reason: 'encrypted-copy-confirmed', nextHeaderSize, footerLen: footerBuf.length, encodedHeader: true, encrypted: true, debug: innerResult.debug, filenames: fnames } };
                }
              }
            } catch (decryptErr) {
              // Decryption failed — fall through to sevenzip-encrypted
            }
          }
          return { status: 'sevenzip-encrypted', details: { reason: 'aes-encrypted-header', nextHeaderSize, footerLen: footerBuf.length, encodedInfo: parseResult.encodedInfo } };
        }
        return { status: 'sevenzip-signature-ok', details: { reason: 'encoded-header-decompress-null', nextHeaderSize, footerLen: footerBuf.length, encodedInfo: parseResult.encodedInfo } };
      } catch (decompErr) {
        return { status: 'sevenzip-signature-ok', details: { reason: 'encoded-header-decompress-error', nextHeaderSize, footerLen: footerBuf.length, decompError: decompErr?.message, encodedInfo: parseResult.encodedInfo } };
      }
    } else if (parseResult.encodedHeader) {
      return { status: 'sevenzip-signature-ok', details: { reason: 'encoded-header-no-info', nextHeaderSize, footerLen: footerBuf.length, debug: parseResult.debug } };
    }

    if (parseResult.compressed) {
      return { status: 'sevenzip-unsupported', details: { reason: 'compressed-coder-detected', nextHeaderSize, footerLen: footerBuf.length, debug: parseResult.debug, filenames: parseResult.filenames || [] } };
    }
    const fnames = parseResult.filenames || [];
    const nestedArchive = sz_detectNestedArchive(fnames);
    if (nestedArchive) {
      return { status: 'sevenzip-nested-archive', details: { reason: 'nested-archive-detected', nestedType: nestedArchive, nextHeaderSize, footerLen: footerBuf.length, filenames: fnames } };
    }
    if (sz_hasDiscStructure(fnames)) {
      return { status: 'sevenzip-unsupported', details: { reason: 'disc-structure-detected', nextHeaderSize, footerLen: footerBuf.length, filenames: fnames } };
    }
    const finalStatus = sz_hasPlayableVideo(fnames) ? 'sevenzip-stored' : 'sevenzip-signature-ok';
    return { status: finalStatus, details: { reason: 'copy-only-confirmed', nextHeaderSize, footerLen: footerBuf.length, debug: parseResult.debug, filenames: fnames } };
  }

  // All attempts failed
  return { status: 'sevenzip-signature-ok', details: {
    reason: 'metadata-parse-error',
    message: lastError?.error || '7z-eof',
    nextHeaderSize,
    footerLen: footerBuf.length,
    sliceLen: lastError?.sliceLen,
    firstBytes: lastError?.firstBytes,
  } };
}

// ---------------------------------------------------------------------------
// Pure-JS 7z metadata header parser — reads just enough to determine if all
// coder methods are copy (0x00) or compressed.
// ---------------------------------------------------------------------------

function parseSevenZipMetadata(buffer) {
  const reader = { buf: buffer, pos: 0 };
  try {
    const rootId = sz_readByte(reader);
    // 0x17 = kEncodedHeader — the metadata header itself is LZMA-compressed.
    // Parse the mini StreamsInfo to extract compression details so the caller
    // can decompress the real header from the archive start.
    if (rootId === 0x17) {
      try {
        const info = sz_parseEncodedHeaderInfo(reader);
        return { compressed: false, encodedHeader: true, encodedInfo: info, debug: { rootId: '0x17-encoded', ...info } };
      } catch (err) {
        return { compressed: false, encodedHeader: true, debug: { rootId: '0x17-encoded', parseError: err?.message } };
      }
    }
    // 0x01 = kHeader (uncompressed metadata — we can parse coders)
    if (rootId !== 0x01) return { error: 'unexpected-root-id' };

    let streamsResult = null;
    let filenames = null;
    while (true) {
      const sectionId = sz_readByte(reader);
      if (sectionId === 0x00) break; // kEnd
      if (sectionId === 0x04) { // kMainStreamsInfo
        streamsResult = sz_parseStreamsInfo(reader);
      } else if (sectionId === 0x02) { // kArchiveProperties
        sz_skipPropertyBlock(reader);
      } else if (sectionId === 0x03) { // kAdditionalStreamsInfo
        return { error: 'additional-streams-before-main' };
      } else if (sectionId === 0x05) { // kFilesInfo
        filenames = sz_parseFilesInfo(reader);
      } else {
        return { error: `unsupported-section-${sectionId}` };
      }
    }
    const compressed = streamsResult ? streamsResult.compressed : false;
    return { compressed, debug: streamsResult?.debug, filenames: filenames || [] };
  } catch (err) {
    return { error: err?.message || 'parse-exception' };
  }
}

function sz_parseStreamsInfo(reader) {
  let copyOnly = false;
  let sawUnpack = false;
  let debug = null;
  let numFolders = 0;
  let folders = [];
  while (true) {
    const id = sz_readByte(reader);
    if (id === 0x00) break; // kEnd
    if (id === 0x06) { // kPackInfo
      sz_skipPackInfo(reader);
    } else if (id === 0x07) { // kUnpackInfo
      const result = sz_parseUnpackInfo(reader);
      copyOnly = result.copyOnly;
      debug = result.debug;
      numFolders = result.numFolders;
      folders = result.folders;
      sawUnpack = true;
    } else if (id === 0x08) { // kSubStreamsInfo
      sz_skipSubStreamsInfo(reader, numFolders, folders);
    } else {
      throw new Error(`unsupported-streams-block-${id}`);
    }
  }
  return { copyOnly: sawUnpack ? copyOnly : false, compressed: sawUnpack ? !copyOnly : false, debug };
}

function sz_parseUnpackInfo(reader) {
  if (sz_readByte(reader) !== 0x0B) throw new Error('expected-kFolder'); // kFolder
  const numFolders = sz_readNumber(reader);
  if (sz_readByte(reader) !== 0) throw new Error('external-folders-unsupported');

  let allCopy = true;
  const folders = [];
  const coderDebug = [];
  for (let i = 0; i < numFolders; i++) {
    const folder = sz_parseFolder(reader);
    folders.push(folder);
    if (!folder.copyOnly) allCopy = false;
    coderDebug.push(folder.coderInfo);
  }

  if (sz_readByte(reader) !== 0x0C) throw new Error('expected-kCodersUnpackSize');
  for (const folder of folders) {
    for (let i = 0; i < folder.totalOutStreams; i++) sz_readNumber(reader);
  }

  const nextId = sz_readByte(reader);
  if (nextId === 0x0A) { // kCRC
    sz_skipBoolVector(reader, numFolders, true);
    if (sz_readByte(reader) !== 0x00) throw new Error('expected-kEnd-after-crc');
  } else if (nextId !== 0x00) {
    throw new Error('unexpected-after-unpack');
  }

  return { copyOnly: allCopy, numFolders, folders, debug: { numFolders, coderDebug } };
}

function sz_parseFolder(reader) {
  const numCoders = sz_readNumber(reader);
  if (numCoders <= 0 || numCoders > 32) throw new Error('bad-coder-count');
  let totalIn = 0;
  let totalOut = 0;
  let copyOnly = true;
  const coderInfo = [];
  for (let i = 0; i < numCoders; i++) {
    const mainByte = sz_readByte(reader);
    const idSize = mainByte & 0x0F; // CodecIdSize (0 = Copy method)
    const isSimple = (mainByte & 0x10) === 0;
    const hasAttributes = (mainByte & 0x20) !== 0;
    const methodId = idSize > 0 ? sz_readBytes(reader, idSize) : Buffer.alloc(0);
    let inStreams = isSimple ? 1 : sz_readNumber(reader);
    let outStreams = isSimple ? 1 : sz_readNumber(reader);
    if (hasAttributes) {
      const attrSize = sz_readNumber(reader);
      sz_skip(reader, attrSize);
    }
    totalIn += inStreams;
    totalOut += outStreams;
    // Copy/Store method: codec ID is a single byte 0x00
    // AES encryption (06f107xx) is treated as transparent — not a compression method
    const methodHex = Buffer.from(methodId).toString('hex');
    const isCopy = (idSize === 1 && methodId[0] === 0x00) || idSize === 0;
    const isAES = methodHex.startsWith('06f107');
    if (!isCopy && !isAES) copyOnly = false;
    coderInfo.push({ mainByte: '0x' + mainByte.toString(16), idSize, methodHex, isCopy });
  }
  const numBindPairs = totalOut > 0 ? totalOut - 1 : 0;
  for (let i = 0; i < numBindPairs; i++) { sz_readNumber(reader); sz_readNumber(reader); }
  const numPacked = totalIn - numBindPairs;
  if (numPacked > 1) { for (let i = 0; i < numPacked; i++) sz_readNumber(reader); }
  return { copyOnly, totalOutStreams: totalOut, coderInfo };
}

function sz_skipPackInfo(reader) {
  sz_readNumber(reader); // packPos
  const numPackStreams = sz_readNumber(reader);
  while (true) {
    const id = sz_readByte(reader);
    if (id === 0x00) break; // kEnd
    if (id === 0x09) { // kSize
      for (let i = 0; i < numPackStreams; i++) sz_readNumber(reader);
    } else if (id === 0x0A) { // kCRC
      sz_skipBoolVector(reader, numPackStreams, true);
    } else {
      // Unknown sub-block in PackInfo; skip by reading size + data
      const size = sz_readNumber(reader);
      sz_skip(reader, size);
    }
  }
}

function sz_skipPropertyBlock(reader) {
  while (true) {
    const id = sz_readByte(reader);
    if (id === 0x00) break;
    const size = sz_readNumber(reader);
    sz_skip(reader, size);
  }
}

// Skip SubStreamsInfo (0x08). Requires folder info from UnpackInfo.
// Format: kNumUnPackStream? (0x0D), kSize? (0x09), kCRC? (0x0A), kEnd (0x00)
function sz_skipSubStreamsInfo(reader, numFolders, folders) {
  let numSubStreams = new Array(numFolders).fill(1); // default 1 per folder
  let totalSubStreams = numFolders;
  while (true) {
    const id = sz_readByte(reader);
    if (id === 0x00) break; // kEnd
    if (id === 0x0D) { // kNumUnPackStream
      totalSubStreams = 0;
      for (let i = 0; i < numFolders; i++) {
        numSubStreams[i] = sz_readNumber(reader);
        totalSubStreams += numSubStreams[i];
      }
    } else if (id === 0x09) { // kSize
      for (let i = 0; i < numFolders; i++) {
        // Read (numSubStreams[i] - 1) sizes per folder; last size is implicit
        for (let j = 0; j < numSubStreams[i] - 1; j++) sz_readNumber(reader);
      }
    } else if (id === 0x0A) { // kCRC
      // Count streams that need CRC: those in folders with >1 sub-stream,
      // or those without CRC defined in UnpackInfo
      sz_skipBoolVector(reader, totalSubStreams, true);
    } else {
      // Unknown sub-block — try to skip by reading size
      const size = sz_readNumber(reader);
      sz_skip(reader, size);
    }
  }
}

// Detect nested archive files inside a 7z. Returns the type string or null.
const NESTED_ARCHIVE_RE = /\.(rar|r\d{2,3}|zip|7z|iso)$/i;
function sz_detectNestedArchive(filenames) {
  for (const name of filenames) {
    const match = NESTED_ARCHIVE_RE.exec(name);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function sz_hasDiscStructure(filenames) {
  for (const name of filenames) {
    if (isDiscStructurePath(name)) return true;
  }
  return false;
}

// Check if any filename is a playable video (not inside Sample/Proof folders, not .iso).
const SAMPLE_PROOF_FOLDER_RE = /[\\/](sample|proof)[\\/]/i;
function sz_hasPlayableVideo(filenames) {
  for (const name of filenames) {
    if (!name) continue;
    // Skip files inside Sample or Proof subdirectories
    if (SAMPLE_PROOF_FOLDER_RE.test(name)) continue;
    // Check if it's a video file extension
    if (isVideoFileName(name)) return true;
  }
  return false;
}

function sz_parseFilesInfo(reader) {
  const numFiles = sz_readNumber(reader);
  if (numFiles < 0 || numFiles > 100000) throw new Error('bad-file-count');
  const filenames = [];
  while (true) {
    const propType = sz_readByte(reader);
    if (propType === 0x00) break; // kEnd
    const size = sz_readNumber(reader);
    if (propType === 0x11) { // kName
      // First byte: 0 = inline, 1 = external
      const external = sz_readByte(reader);
      if (external !== 0) {
        sz_skip(reader, size - 1);
      } else {
        // Names are stored as UTF-16LE NUL-terminated strings, concatenated
        const namesData = sz_readBytes(reader, size - 1);
        let start = 0;
        for (let i = 0; i < numFiles; i++) {
          // Find the double-NUL (0x00 0x00) terminator for UTF-16LE
          let end = start;
          while (end + 1 < namesData.length) {
            if (namesData[end] === 0 && namesData[end + 1] === 0) break;
            end += 2;
          }
          const nameSlice = namesData.subarray(start, end);
          try {
            filenames.push(nameSlice.swap16 ? Buffer.from(nameSlice).toString('utf16le') : new TextDecoder('utf-16le').decode(nameSlice));
          } catch { filenames.push(''); }
          start = end + 2; // skip past NUL terminator
        }
      }
    } else {
      sz_skip(reader, size);
    }
  }
  return filenames;
}

function sz_skipBoolVector(reader, count, readCrcs) {
  const allDefined = sz_readByte(reader);
  let definedCount = count;
  if (allDefined === 0) {
    definedCount = 0;
    let mask = 0;
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (mask === 0) { value = sz_readByte(reader); mask = 0x80; }
      if (value & mask) definedCount++;
      mask >>= 1;
    }
  }
  if (readCrcs) {
    for (let i = 0; i < definedCount; i++) sz_skip(reader, 4); // uint32 CRC
  }
  return definedCount;
}

// ---------------------------------------------------------------------------
// Parse the mini StreamsInfo inside a kEncodedHeader (0x17) to extract
// compression method, pack position/size, and unpack size.
// ---------------------------------------------------------------------------
function sz_parseEncodedHeaderInfo(reader) {
  let packPos = 0;
  let packSizes = [];
  let coderMethod = null;
  let coderProperties = null;
  let unpackSize = 0;
  let numFolders = 0;
  const folderOutStreams = []; // track totalOut per folder for kCodersUnpackSize
  const allCoders = []; // all coders for multi-coder chains (e.g. AES + LZMA)
  const allUnpackSizes = []; // all unpack sizes (one per output stream)

  while (true) {
    const id = sz_readByte(reader);
    if (id === 0x00) break; // kEnd
    if (id === 0x06) { // kPackInfo
      packPos = sz_readNumber(reader);
      const numPackStreams = sz_readNumber(reader);
      while (true) {
        const subId = sz_readByte(reader);
        if (subId === 0x00) break;
        if (subId === 0x09) { // kSize
          for (let i = 0; i < numPackStreams; i++) packSizes.push(sz_readNumber(reader));
        } else if (subId === 0x0A) { // kCRC
          sz_skipBoolVector(reader, numPackStreams, true);
        } else {
          const size = sz_readNumber(reader);
          sz_skip(reader, size);
        }
      }
    } else if (id === 0x07) { // kUnpackInfo
      if (sz_readByte(reader) !== 0x0B) throw new Error('expected-kFolder');
      numFolders = sz_readNumber(reader);
      if (sz_readByte(reader) !== 0) throw new Error('external-folders-unsupported');
      // Parse the single folder to get coder info
      for (let fi = 0; fi < numFolders; fi++) {
        const numCoders = sz_readNumber(reader);
        let totalIn = 0, totalOut = 0;
        for (let ci = 0; ci < numCoders; ci++) {
          const mainByte = sz_readByte(reader);
          const idSize = mainByte & 0x0F;
          const isSimple = (mainByte & 0x10) === 0;
          const hasAttributes = (mainByte & 0x20) !== 0;
          const methodId = idSize > 0 ? sz_readBytes(reader, idSize) : Buffer.alloc(0);
          if (fi === 0 && ci === 0) coderMethod = Buffer.from(methodId);
          const inS = isSimple ? 1 : sz_readNumber(reader);
          const outS = isSimple ? 1 : sz_readNumber(reader);
          if (hasAttributes) {
            const attrSize = sz_readNumber(reader);
            const attrs = sz_readBytes(reader, attrSize);
            if (fi === 0 && ci === 0) coderProperties = Buffer.from(attrs);
            if (fi === 0) allCoders.push({ method: Buffer.from(methodId).toString('hex'), properties: Buffer.from(attrs) });
          } else {
            if (fi === 0) allCoders.push({ method: Buffer.from(methodId).toString('hex'), properties: null });
          }
          totalIn += inS;
          totalOut += outS;
        }
        folderOutStreams.push(totalOut);
        const numBindPairs = totalOut > 0 ? totalOut - 1 : 0;
        for (let i = 0; i < numBindPairs; i++) { sz_readNumber(reader); sz_readNumber(reader); }
        const numPacked = totalIn - numBindPairs;
        if (numPacked > 1) { for (let i = 0; i < numPacked; i++) sz_readNumber(reader); }
      }
      // kCodersUnpackSize — read totalOutStreams sizes per folder
      if (sz_readByte(reader) !== 0x0C) throw new Error('expected-kCodersUnpackSize');
      for (let fi = 0; fi < numFolders; fi++) {
        const numOut = folderOutStreams[fi] || 1;
        for (let i = 0; i < numOut; i++) {
          const s = sz_readNumber(reader);
          if (fi === 0) {
            allUnpackSizes.push(s);
            if (i === 0) unpackSize = s;
          }
        }
      }
      // Skip remaining (CRC, kEnd)
      while (true) {
        const subId = sz_readByte(reader);
        if (subId === 0x00) break;
        if (subId === 0x0A) { sz_skipBoolVector(reader, numFolders, true); }
        else { const size = sz_readNumber(reader); sz_skip(reader, size); }
      }
    } else if (id === 0x08) { // kSubStreamsInfo
      sz_skipSubStreamsInfo(reader, numFolders, []);
    } else {
      throw new Error(`unknown-encoded-section-${id}`);
    }
  }

  return {
    packPos,
    packSize: packSizes[0] || 0,
    unpackSize,
    coderMethod: coderMethod ? coderMethod.toString('hex') : null,
    coderProperties: coderProperties || null,
    coders: allCoders,
    unpackSizes: allUnpackSizes,
  };
}

// ---------------------------------------------------------------------------
// 7z AES-256-SHA-256 decryption for encrypted encoded headers.
// Implements the 7zAES key derivation (SHA-256 iterated over salt+password+counter)
// and AES-256-CBC decryption.
// ---------------------------------------------------------------------------
function parse7zAESProperties(properties) {
  if (!properties || properties.length === 0) return null;
  const firstByte = properties[0];
  const numCyclesPower = firstByte & 0x3F;

  let pos = 1;
  let saltSize = 0;
  let ivSize = 0;

  if (firstByte & 0xC0) {
    if (pos >= properties.length) return null;
    const secondByte = properties[pos++];
    // py7zr-verified encoding: bit 7 = salt base, bit 6 = IV base
    // secondByte high nibble added to salt, low nibble added to IV
    saltSize = ((firstByte >> 7) & 1) + ((secondByte >> 4) & 0x0F);
    ivSize = ((firstByte >> 6) & 1) + (secondByte & 0x0F);
  }

  const salt = saltSize > 0 ? Buffer.from(properties.subarray(pos, pos + saltSize)) : Buffer.alloc(0);
  pos += saltSize;
  const iv = Buffer.alloc(16, 0); // AES block size = 16
  if (ivSize > 0) {
    const ivBytes = Math.min(ivSize, 16);
    properties.copy(iv, 0, pos, pos + ivBytes);
  }

  return { numCyclesPower, salt, iv };
}

function derive7zAESKey(password, salt, numCyclesPower) {
  const passwordBuf = Buffer.from(password, 'utf16le');
  const numRounds = 1 << numCyclesPower;
  const hash = crypto.createHash('sha256');

  // Batch iterations to reduce JS→C++ call overhead
  const iterPrefix = Buffer.concat([salt, passwordBuf]);
  const batchSize = Math.min(4096, numRounds);
  const iterSize = iterPrefix.length + 8;
  const batch = Buffer.alloc(batchSize * iterSize);

  for (let start = 0; start < numRounds; start += batchSize) {
    const end = Math.min(start + batchSize, numRounds);
    let offset = 0;
    for (let i = start; i < end; i++) {
      iterPrefix.copy(batch, offset);
      offset += iterPrefix.length;
      batch.writeUInt32LE(i & 0xFFFFFFFF, offset);
      batch.writeUInt32LE(Math.floor(i / 0x100000000), offset + 4);
      offset += 8;
    }
    hash.update(batch.subarray(0, offset));
  }

  return hash.digest(); // 32 bytes = AES-256 key
}

function decrypt7zAES(encryptedData, password, aesProperties) {
  const params = parse7zAESProperties(aesProperties);
  if (!params) return null;

  const key = derive7zAESKey(password, params.salt, params.numCyclesPower);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, params.iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Decompress the real header from the archive data using lzma-native.
// The compressed header data sits RIGHT BEFORE the metadata footer in the
// archive. Since both are at the end, both live in footerBuf.
//   footerBuf layout: [...other data...][packed header data][metadata footer]
// ---------------------------------------------------------------------------
async function decompressEncodedHeader(info, footerBuf, metaSize) {
  if (!info || !info.packSize || !info.unpackSize) return null;
  if (!metaSize || metaSize <= 0) return null;

  // Packed data ends where metadata starts (right before footerBuf's last metaSize bytes)
  const packedEnd = footerBuf.length - metaSize;
  const packedStart = packedEnd - info.packSize;
  if (packedStart < 0 || packedEnd > footerBuf.length) return null;

  const compressedData = footerBuf.subarray(packedStart, packedEnd);
  return await decompressLzmaBuffer(info, compressedData);
}

// ---------------------------------------------------------------------------
// Decrypt + decompress an AES-encrypted encoded header using a password.
// Multi-coder pipeline: AES decrypt → LZMA decompress → raw header.
// ---------------------------------------------------------------------------
async function decryptEncodedHeader(info, footerBuf, metaSize, password) {
  if (!info || !info.packSize || !password) return null;
  if (!metaSize || metaSize <= 0) return null;

  const packedEnd = footerBuf.length - metaSize;
  const packedStart = packedEnd - info.packSize;
  if (packedStart < 0 || packedEnd > footerBuf.length) return null;

  const packedData = footerBuf.subarray(packedStart, packedEnd);
  const coders = info.coders || [];
  const unpackSizes = info.unpackSizes || [];

  // Find the AES coder and the LZMA coder in the chain
  const aesCoder = coders.find((c) => c.method.startsWith('06f107'));
  const lzmaCoder = coders.find((c) => c.method === '030101' || c.method === '21');
  if (!aesCoder) return null;

  try {
    // Step 1: AES decrypt the packed data
    const decrypted = decrypt7zAES(packedData, password, aesCoder.properties);
    if (!decrypted) return null;

    // Step 2: If there's also a LZMA coder, decompress the decrypted data
    if (lzmaCoder) {
      const lzmaUnpackSize = unpackSizes[unpackSizes.length - 1] || info.unpackSize;
      const lzmaInfo = {
        coderMethod: lzmaCoder.method,
        coderProperties: lzmaCoder.properties,
        unpackSize: lzmaUnpackSize,
      };
      const trimSize = unpackSizes[0] || decrypted.length;
      const lzmaInput = decrypted.subarray(0, trimSize);

      const result = await decompressLzmaBuffer(lzmaInfo, lzmaInput);
      if (result && Buffer.isBuffer(result) && result.length > 0) {
        return result;
      }
    } else {
      // No LZMA — trim AES padding and return
      const trimSize = unpackSizes[0] || decrypted.length;
      return decrypted.subarray(0, trimSize);
    }
  } catch (e) {
    // AES decryption or LZMA decompression failed
  }

  return null;
}

function lzma2DictSize(byte) {
  if (byte > 40) return 0xFFFFFFFF;
  if (byte === 40) return 0xFFFFFFFF;
  const base = (2 | (byte & 1)) << ((byte >> 1) + 11);
  return base;
}

async function decompressLzmaBuffer(info, compressedData) {
  const methodHex = info.coderMethod;
  // 0x21 = LZMA2, 0x030101 = LZMA1
  if (methodHex === '21') {
    // LZMA2: use .xz-style rawDecoder
    const dictByte = info.coderProperties?.[0] ?? 24;
    return new Promise((resolve, reject) => {
      const decompressor = lzma.createStream('rawDecoder', {
        filters: [{ id: lzma.FILTER_LZMA2, options: { dictSize: lzma2DictSize(dictByte) } }],
      });
      const chunks = [];
      decompressor.on('data', (chunk) => chunks.push(chunk));
      decompressor.on('end', () => resolve(Buffer.concat(chunks)));
      decompressor.on('error', (err) => reject(err));
      decompressor.end(compressedData);
    });
  } else if (methodHex === '030101') {
    // LZMA1: wrap as .lzma format (5 prop bytes + 8 byte uncompressed size LE + data)
    const props = info.coderProperties;
    if (!props || props.length < 5) return null;
    const dictSize = Buffer.from(props).readUInt32LE(1);
    const lzmaHeader = Buffer.alloc(13);
    lzmaHeader[0] = props[0]; // LZMA properties byte
    lzmaHeader.writeUInt32LE(dictSize, 1);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(info.unpackSize));
    sizeBuf.copy(lzmaHeader, 5);
    const lzmaStream = Buffer.concat([lzmaHeader, compressedData]);
    return new Promise((resolve, reject) => {
      lzma.decompress(lzmaStream, {}, (result) => {
        if (Buffer.isBuffer(result)) resolve(result);
        else reject(new Error('lzma-decompress-non-buffer'));
      }, (err) => reject(err instanceof Error ? err : new Error(String(err))));
    });
  } else if (methodHex === '00' || !methodHex) {
    return compressedData;
  }
  return null;
}

// --- 7z reader primitives ---
function sz_readByte(reader) {
  if (reader.pos >= reader.buf.length) throw new Error('7z-eof');
  return reader.buf[reader.pos++];
}
function sz_readBytes(reader, n) {
  if (reader.pos + n > reader.buf.length) throw new Error('7z-eof');
  const slice = reader.buf.subarray(reader.pos, reader.pos + n);
  reader.pos += n;
  return slice;
}
function sz_skip(reader, n) {
  if (reader.pos + n > reader.buf.length) throw new Error('7z-eof');
  reader.pos += n;
}
// 7z variable-length integer: count leading ONE bits in first byte to
// determine how many extra bytes follow (matching the 7zip C reference).
function sz_readNumber(reader) {
  const b = sz_readByte(reader);
  // 0xxxxxxx: single byte, value 0-127
  if ((b & 0x80) === 0) return b;

  // At least one extra byte
  let value = BigInt(sz_readByte(reader));

  for (let i = 1; i < 8; i++) {
    const mask = 0x80 >>> i;
    if ((b & mask) === 0) {
      // Remaining value bits from first byte go to the highest position
      const high = BigInt(b & (mask - 1));
      value |= (high << BigInt(i * 8));
      return Number(value);
    }
    // Read next byte in little-endian order
    value |= (BigInt(sz_readByte(reader)) << BigInt(i * 8));
  }
  // 0xFF: 8 extra bytes already read
  return Number(value);
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

async function evictStaleSharedNntpPool(reason = 'stale-timeout') {
  if (!sharedNntpPoolRecord?.pool) return false;
  if (!isSharedPoolStale()) return false;
  await closeSharedNntpPool(reason);
  return true;
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
  evictStaleSharedNntpPool,
};

