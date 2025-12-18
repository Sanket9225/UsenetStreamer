const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const path = require('path');
const { isVideoFileName, cleanSpecialSearchTitle } = require('../../utils/parsers');
const NNTPModule = require('nntp/lib/nntp');
const NNTP = typeof NNTPModule === 'function' ? NNTPModule : NNTPModule?.NNTP;
function timingLog(event, details) {
  const payload = details ? { ...details, ts: new Date().toISOString() } : { ts: new Date().toISOString() };
  // console.log(`[NZB TRIAGE][TIMING] ${event}`, payload);
}

const ARCHIVE_EXTENSIONS = new Set(['.rar', '.r00', '.r01', '.r02', '.7z', '.zip']);
const VIDEO_FILE_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.avi', '.ts', '.m4v', '.mpg', '.mpeg', '.wmv', '.flv', '.webm'];
const ARCHIVE_ONLY_MIN_PARTS = 10;
const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);

const TRIAGE_ACTIVITY_TTL_MS = 5 * 60 * 1000; // 5 mins window for keep-alives
let lastTriageActivityTs = 0;

const DEFAULT_OPTIONS = {
  archiveDirs: [],
  nntpConfig: null,
  healthCheckTimeoutMs: 35000,
  maxDecodedBytes: 256 * 1024,
  nntpMaxConnections: 60,
  reuseNntpPool: true,
  nntpKeepAliveMs: 120000,
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

  // Check for unsupported ISO files
  const hasIso = files.some((file) => {
    const name = file.filename || guessFilenameFromSubject(file.subject) || '';
    return name.toLowerCase().endsWith('.iso');
  });
  if (hasIso) {
    blockers.add('unsupported-iso');
  }
  const warnings = new Set();
  const archiveFindings = [];
  const archiveFiles = files.filter(isArchiveFile);
  const archiveCandidates = dedupeArchiveCandidates(archiveFiles);
  const checkedSegments = new Set();
  let primaryArchive = null;

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
    const archiveWithSegments = selectArchiveForInspection(archiveCandidates);
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

  if (blockers.size === 0) {
    const nzbTitle = extractTitle(parsed);
    // Perform Content Validation: check if the found video content actually matches the NZB title
    let candidateName = null;

    if (storedArchiveFound) {
      // Find the inner filename from the successful archive inspection
      const successfulFinding = archiveFindings.find((f) =>
        (f.status === 'rar-stored' || f.status === 'sevenzip-stored') && f.details?.name
      );
      if (successfulFinding) {
        candidateName = successfulFinding.details.name;
      }
    } else if (hasPlayableVideo) {
      // If no archive but we have a raw video file, pick the largest one or first one
      const videoFiles = files.filter((f) => isPlayableVideoName(f.filename || guessFilenameFromSubject(f.subject)));
      if (videoFiles.length > 0) {
        // Sort by size (segments * bytes) if available, or just pick first
        // Simplified: just pick the first one for now as a heuristic
        candidateName = videoFiles[0].filename || guessFilenameFromSubject(videoFiles[0].subject);
      }
    }

    if (candidateName && nzbTitle) {
      const normalizedTitle = cleanSpecialSearchTitle(nzbTitle).toLowerCase();
      const normalizedFile = cleanSpecialSearchTitle(candidateName).toLowerCase();

      // Heuristic: Check for token overlap
      // We require at least one significant token from the NZB title to be present in the filename
      // UNLESS the title is extremely short/generic.

      const titleTokens = normalizedTitle.split(' ').filter((t) => t.length > 2);
      const fileTokens = new Set(normalizedFile.split(' '));

      let matchFound = false;
      if (titleTokens.length === 0) {
        matchFound = true; // Title is too short/stateless to validate (e.g. "1917" or "X")
      } else {
        matchFound = titleTokens.some((token) => fileTokens.has(token));
      }

      if (!matchFound) {
        // console.log('[NZB TRIAGE] Content Mismatch Rejected', {
        //   nzbTitle,
        //   candidateName,
        //   normalizedTitle,
        //   normalizedFile
        // });
        blockers.add('content-mismatch');
        archiveFindings.push({
          source: 'content-validation',
          filename: candidateName,
          status: 'filename-mismatch',
          details: { nzbTitle, normalizedTitle, normalizedFile }
        });
      }
    }
  }

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

function isArchiveEntryName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return /\.r\d{2}(?:\b|$)/.test(lower)
    || /\.part\d+\.rar/.test(lower)
    || lower.endsWith('.rar')
    || lower.endsWith('.7z')
    || lower.endsWith('.zip');
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
    return { nested: 0, playable: 0, samples: [] };
  }
  const ascii = buffer.toString('latin1');
  const filenameRegex = /[A-Za-z0-9_\-()\[\]\s]{3,120}\.[A-Za-z0-9]{2,5}(?:\.[A-Za-z0-9]{2,5})?/g;
  const matches = ascii.match(filenameRegex) || [];
  let nested = 0;
  let playable = 0;
  const samples = [];
  matches.forEach((raw) => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;
    samples.push(normalized);
    if (VIDEO_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext))) {
      playable += 1;
      return;
    }
    if (isArchiveEntryName(normalized)) {
      nested += 1;
    }
  });
  return { nested, playable, samples };
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

function canonicalArchiveKey(name) {
  if (!name) return null;
  let key = name.toLowerCase();
  key = key.replace(/\.part\d+\.rar$/i, '.rar');
  key = key.replace(/\.r\d{2}$/i, '.rar');
  return key;
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

async function inspectArchiveViaNntp(file, ctx) {
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

    if (isSevenZip) {
      // console.log('[NZB TRIAGE] Skipping 7z archive inspection (STAT passed, body skipped)', {
      //   filename: file.filename,
      //   subject: file.subject,
      //   segmentId,
      // });
      return {
        status: 'sevenzip-untested',
        details: { reason: '7z-skip-body', filename: effectiveFilename },
        segmentId,
      };
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
      return true;
    case 'sevenzip-stored':
      return true;
    case 'rar-compressed':
    case 'rar-encrypted':
    case 'rar-solid':
    case 'rar5-unsupported':
    case 'rar-nested-archive':
    case 'sevenzip-nested-archive':
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

  return { status: 'rar-header-not-found' };
}

function inspectRar4(buffer) {
  let offset = RAR4_SIGNATURE.length;
  let storedDetails = null;
  let nestedArchiveCount = 0;
  let playableEntryFound = false;

  while (offset + 7 <= buffer.length) {
    const headerType = buffer[offset + 2];
    const headerFlags = buffer.readUInt16LE(offset + 3);
    const headerSize = buffer.readUInt16LE(offset + 5);

    // console.log(`[RAR4] Type: ${headerType}, Size: ${headerSize}, Offset: ${offset}`);

    if (headerSize < 7) return { status: 'rar-corrupt-header' };
    if (offset + headerSize > buffer.length) return { status: 'rar-insufficient-data' };

    let addSize = 0;

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
      const encrypted = Boolean(headerFlags & 0x0004);
      const solid = Boolean(headerFlags & 0x0010);

      // console.log(`[RAR4] Found entry: "${name}" (method: ${methodByte}, encrypted: ${encrypted}, solid: ${solid})`);

      if (encrypted) return { status: 'rar-encrypted', details: { name } };
      if (solid) return { status: 'rar-solid', details: { name } };
      if (methodByte !== 0x30) {
        // return { status: 'rar-compressed', details: { name, method: methodByte } };
        // Don't return early! We need to scan all files to check for nested archives.
        // But if we find a video file, we can stop and accept.
      }

      if (!storedDetails) {
        storedDetails = { name, method: methodByte };
      }
      if (isVideoFileName(name)) {
        playableEntryFound = true;
      } else if (isArchiveEntryName(name)) {
        nestedArchiveCount += 1;
      }
    }

    offset += headerSize + addSize;
  }

  if (storedDetails) {
    if (nestedArchiveCount > 0 && !playableEntryFound) {
      // console.log('[NZB TRIAGE] Detected nested archive (RAR4)', {
      //   nestedEntries: nestedArchiveCount,
      //   sample: storedDetails?.name,
      // });
      return {
        status: 'rar-nested-archive',
        details: { nestedEntries: nestedArchiveCount },
      };
    }
    // console.log('[NZB TRIAGE] RAR4 archive marked stored', {
    //   playableEntryFound,
    //   nestedEntries: nestedArchiveCount,
    //   sample: storedDetails?.name,
    // });
    return { status: 'rar-stored', details: storedDetails };
  }

  return { status: 'rar-header-not-found' };
}

function inspectRar5(buffer) {
  let offset = RAR5_SIGNATURE.length;
  let nestedArchiveCount = 0;
  let playableEntryFound = false;
  let storedDetails = null;

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

                    if (isVideoFileName(name)) {
                      playableEntryFound = true;
                    } else if (isArchiveEntryName(name)) {
                      nestedArchiveCount += 1;
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
        details: { nestedEntries: nestedArchiveCount },
      };
    }
    // console.log('[NZB TRIAGE] RAR5 archive marked stored', {
    //   playableEntryFound,
    //   nestedEntries: nestedArchiveCount,
    //   sample: storedDetails?.name,
    // });
    return { status: 'rar-stored', details: storedDetails };
  }

  return { status: 'rar-stored', details: { note: 'rar5-header-assumed-stored' } };
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

function inspectSevenZip(buffer) {
  try {
    const analyzer = new SevenZipAnalyzer(buffer);
    const outcome = analyzer.evaluate();
    return outcome.copyOnly
      ? { status: 'sevenzip-stored' }
      : { status: 'sevenzip-unsupported', details: outcome.reason };
  } catch (error) {
    if (error?.code === 'SEVENZIP_INSUFFICIENT_DATA') {
      return { status: 'sevenzip-insufficient-data', details: error.message };
    }
    return { status: 'sevenzip-unsupported', details: error?.message || 'Unknown 7z error' };
  }
}

function buildDecision(decision, blockers, warnings, meta) {
  return {
    decision,
    blockers: Array.from(blockers),
    warnings: Array.from(warnings),
    ...meta,
  };
}

class SevenZipAnalyzer {
  constructor(buffer) {
    this.buffer = buffer;
  }

  evaluate() {
    if (!SevenZipAnalyzer.hasSignature(this.buffer)) {
      throw Object.assign(new Error('Missing 7z signature'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }
    if (this.buffer.length < 32) {
      throw Object.assign(new Error('Incomplete 7z start header'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }

    const nextHeaderOffset = Number(this.buffer.readBigUInt64LE(12));
    const nextHeaderSize = Number(this.buffer.readBigUInt64LE(20));
    const headerStart = 32 + nextHeaderOffset;
    const headerEnd = headerStart + nextHeaderSize;
    if (headerStart < 32 || headerEnd > this.buffer.length) {
      throw Object.assign(new Error('7z next header outside buffered range'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }

    const headerSlice = this.buffer.slice(headerStart, headerEnd);
    const parser = new SevenZipHeaderParser(headerSlice);
    return parser.parse();
  }

  static hasSignature(buffer) {
    return buffer.length >= 6
      && buffer[0] === 0x37
      && buffer[1] === 0x7A
      && buffer[2] === 0xBC
      && buffer[3] === 0xAF
      && buffer[4] === 0x27
      && buffer[5] === 0x1C;
  }
}

class SevenZipHeaderParser {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }

  parse() {
    const rootId = this.readByte();
    if (rootId === SEVEN_ZIP_IDS.kEncodedHeader) {
      throw new Error('Encoded 7z headers are not supported');
    }
    if (rootId !== SEVEN_ZIP_IDS.kHeader) {
      throw new Error('Unexpected 7z header identifier');
    }

    let copyOnly = false;
    while (true) {
      const sectionId = this.readByte();
      if (sectionId === SEVEN_ZIP_IDS.kEnd) break;
      switch (sectionId) {
        case SEVEN_ZIP_IDS.kArchiveProperties:
          this.skipPropertyBlock();
          break;
        case SEVEN_ZIP_IDS.kAdditionalStreamsInfo:
          this.skipStreamsInfo();
          break;
        case SEVEN_ZIP_IDS.kMainStreamsInfo:
          copyOnly = this.parseStreamsInfo();
          break;
        case SEVEN_ZIP_IDS.kFilesInfo:
          this.skipFilesInfo();
          break;
        default:
          throw new Error(`Unsupported 7z header section: ${sectionId}`);
      }
    }

    return {
      copyOnly,
      reason: copyOnly ? undefined : 'compressed-coder-detected',
    };
  }

  parseStreamsInfo() {
    let copyOnly = false;
    let sawUnpackInfo = false;
    while (true) {
      const id = this.readByte();
      if (id === SEVEN_ZIP_IDS.kEnd) break;
      if (id === SEVEN_ZIP_IDS.kPackInfo) {
        this.skipPackInfo();
      } else if (id === SEVEN_ZIP_IDS.kUnpackInfo) {
        const folderResult = this.parseUnpackInfo();
        copyOnly = folderResult;
        sawUnpackInfo = true;
      } else if (id === SEVEN_ZIP_IDS.kSubStreamsInfo) {
        this.skipSubStreamsInfo();
      } else {
        throw new Error(`Unsupported StreamsInfo block id ${id}`);
      }
    }
    return sawUnpackInfo ? copyOnly : false;
  }

  parseUnpackInfo() {
    if (this.readByte() !== SEVEN_ZIP_IDS.kFolder) {
      throw new Error('Expected Folder block in UnpackInfo');
    }
    const numFolders = this.readNumber();
    if (this.readByte() !== 0) {
      throw new Error('External Folder references are not supported');
    }

    const folders = [];
    let copyOnly = true;
    for (let i = 0; i < numFolders; i += 1) {
      const folder = this.parseFolder();
      folders.push(folder);
      copyOnly = copyOnly && folder.copyOnly;
    }

    if (this.readByte() !== SEVEN_ZIP_IDS.kCodersUnpackSize) {
      throw new Error('Expected CodersUnpackSize block');
    }
    folders.forEach((folder) => {
      for (let i = 0; i < folder.totalOutStreams; i += 1) {
        this.readNumber();
      }
    });

    const nextId = this.readByte();
    if (nextId === SEVEN_ZIP_IDS.kCRC) {
      const definedCount = this.skipBoolVector(folders.length);
      for (let i = 0; i < definedCount; i += 1) {
        this.readUInt32();
      }
      this.expectByte(SEVEN_ZIP_IDS.kEnd);
    } else if (nextId !== SEVEN_ZIP_IDS.kEnd) {
      throw new Error('Unexpected identifier after CodersUnpackSize');
    }

    return copyOnly;
  }

  parseFolder() {
    const numCoders = this.readNumber();
    if (numCoders <= 0 || numCoders > 32) {
      throw new Error('Invalid coder count in folder');
    }
    let totalInStreams = 0;
    let totalOutStreams = 0;
    let copyOnly = true;

    for (let i = 0; i < numCoders; i += 1) {
      const coder = this.parseCoder();
      totalInStreams += coder.inStreams;
      totalOutStreams += coder.outStreams;
      copyOnly = copyOnly && coder.isCopyMethod;
    }

    const numBindPairs = totalOutStreams > 0 ? totalOutStreams - 1 : 0;
    for (let i = 0; i < numBindPairs; i += 1) {
      this.readNumber();
      this.readNumber();
    }

    const numPackedStreams = totalInStreams - numBindPairs;
    if (numPackedStreams < 0) {
      throw new Error('Invalid packed stream count');
    }
    if (numPackedStreams > 1) {
      for (let i = 0; i < numPackedStreams; i += 1) {
        this.readNumber();
      }
    }

    return { copyOnly, totalOutStreams };
  }

  parseCoder() {
    const mainByte = this.readByte();
    const idSize = (mainByte & 0x0F) + 1;
    const isSimple = (mainByte & 0x10) === 0;
    const hasAttributes = (mainByte & 0x20) !== 0;
    const hasAltInStreams = (mainByte & 0x40) !== 0;
    const hasAltOutStreams = (mainByte & 0x80) !== 0;

    const methodId = this.readBytes(idSize);
    let inStreams = isSimple ? 1 : this.readNumber();
    let outStreams = isSimple ? 1 : this.readNumber();
    if (hasAltInStreams) inStreams = this.readNumber();
    if (hasAltOutStreams) outStreams = this.readNumber();
    if (hasAttributes) {
      const attrSize = this.readNumber();
      this.skip(attrSize);
    }

    const isCopyMethod = methodId.length === 1 && methodId[0] === 0x00;
    return { isCopyMethod, inStreams, outStreams };
  }

  skipPropertyBlock() {
    while (true) {
      const id = this.readByte();
      if (id === SEVEN_ZIP_IDS.kEnd) break;
      const size = this.readNumber();
      this.skip(size);
    }
  }

  skipStreamsInfo() {
    this.parseStreamsInfo();
  }

  skipPackInfo() {
    this.readNumber();
    const numPackStreams = this.readNumber();
    let id = this.readByte();
    if (id === SEVEN_ZIP_IDS.kSize) {
      for (let i = 0; i < numPackStreams; i += 1) {
        this.readNumber();
      }
      id = this.readByte();
    }
    if (id === SEVEN_ZIP_IDS.kCRC) {
      const defined = this.skipBoolVector(numPackStreams);
      for (let i = 0; i < defined; i += 1) {
        this.readUInt32();
      }
      id = this.readByte();
    }
    if (id !== SEVEN_ZIP_IDS.kEnd) {
      throw new Error('Malformed PackInfo block');
    }
  }

  skipSubStreamsInfo() {
    while (true) {
      const id = this.readByte();
      if (id === SEVEN_ZIP_IDS.kEnd) break;
      const size = this.readNumber();
      this.skip(size);
    }
  }

  skipFilesInfo() {
    const numFiles = this.readNumber();
    if (numFiles < 0) {
      throw new Error('Invalid file count in FilesInfo');
    }
    while (true) {
      const propertyType = this.readByte();
      if (propertyType === SEVEN_ZIP_IDS.kEnd) break;
      const size = this.readNumber();
      this.skip(size);
    }
  }

  skipBoolVector(count) {
    const allDefined = this.readByte();
    if (allDefined !== 0) {
      return count;
    }
    let mask = 0;
    let value = 0;
    let defined = 0;
    for (let i = 0; i < count; i += 1) {
      if (mask === 0) {
        value = this.readByte();
        mask = 0x01;
      }
      if (value & mask) defined += 1;
      mask <<= 1;
      if (mask > 0x80) mask = 0;
    }
    return defined;
  }

  expectByte(expected) {
    const actual = this.readByte();
    if (actual !== expected) {
      throw new Error(`Expected token ${expected} but received ${actual}`);
    }
  }

  readUInt32() {
    if (this.pos + 4 > this.buffer.length) {
      throw Object.assign(new Error('Unexpected end of buffer'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }
    const value = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  readBytes(length) {
    if (this.pos + length > this.buffer.length) {
      throw Object.assign(new Error('Unexpected end of buffer'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }
    const slice = this.buffer.slice(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  readByte() {
    if (this.pos >= this.buffer.length) {
      throw Object.assign(new Error('Unexpected end of buffer'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }
    const value = this.buffer[this.pos];
    this.pos += 1;
    return value;
  }

  readNumber() {
    const firstByte = this.readByte();
    let mask = 0x80;
    let additional = 0;
    while (additional < 8 && (firstByte & mask) === 0) {
      mask >>= 1;
      additional += 1;
    }
    if (mask === 0) {
      let value = 0n;
      for (let i = 0; i < 8; i += 1) {
        value = (value << 8n) | BigInt(this.readByte());
      }
      return Number(value);
    }
    let value = BigInt(firstByte & (mask - 1));
    for (let i = 0; i < additional; i += 1) {
      value = (value << 8n) | BigInt(this.readByte());
    }
    return Number(value);
  }

  skip(length) {
    if (this.pos + length > this.buffer.length) {
      throw Object.assign(new Error('Unexpected end of buffer during skip'), { code: 'SEVENZIP_INSUFFICIENT_DATA' });
    }
    this.pos += length;
  }
}

const SEVEN_ZIP_IDS = {
  kEnd: 0x00,
  kHeader: 0x01,
  kArchiveProperties: 0x02,
  kAdditionalStreamsInfo: 0x03,
  kMainStreamsInfo: 0x04,
  kFilesInfo: 0x05,
  kPackInfo: 0x06,
  kUnpackInfo: 0x07,
  kSubStreamsInfo: 0x08,
  kSize: 0x09,
  kCRC: 0x0A,
  kFolder: 0x0B,
  kCodersUnpackSize: 0x0C,
  kNumUnpackStream: 0x0D,
  kEmptyStream: 0x0E,
  kEmptyFile: 0x0F,
  kAnti: 0x10,
  kName: 0x11,
  kCTime: 0x12,
  kATime: 0x13,
  kMTime: 0x14,
  kWinAttributes: 0x15,
  kComment: 0x16,
  kEncodedHeader: 0x17,
};

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
    } catch (_) { }
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
    } catch (_) { }
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
      } catch (_) { }
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
      } catch (_) { }
      resolve();
    });
    // This error handler is for connection phase failures (DNS, TLS handshake, auth)
    // It will be removed and replaced with persistent handlers after 'ready'
    client.once('error', (err) => {
      reject(err);
    });

    // Intercept socket creation to attach error handlers immediately
    const originalConnect = client.connect;
    client.connect = function (...args) {
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
        } catch (_) { }
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
