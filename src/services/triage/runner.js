const axios = require('axios');
const { triageNzbs } = require('./index');
const { getRandomUserAgent } = require('../../utils/userAgent');

const DEFAULT_TIME_BUDGET_MS = 40000;
const DEFAULT_MAX_CANDIDATES = 25;
const DEFAULT_DOWNLOAD_CONCURRENCY = 8;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000;
const TIMEOUT_ERROR_CODE = 'TRIAGE_TIMEOUT';

function normalizeTitle(title) {
  if (title === undefined || title === null) return '';
  const raw = title.toString().trim();
  if (!raw) return '';

  let working = raw.replace(/\.(nzb|zip)$/i, '');
  working = working
    .replace(/[._-]+/g, ' ')
    .replace(/['"`]+/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

  return working;
}

function logEvent(logger, level, message, context) {
  if (!logger) return;
  const payload = context && Object.keys(context).length > 0 ? context : undefined;
  if (typeof logger === 'function') {
    logger(level, message, payload);
    return;
  }
  const fn = typeof logger[level] === 'function' ? logger[level].bind(logger) : null;
  if (fn) fn(message, payload);
}

function normalizeIndexerToken(value) {
  if (value === undefined || value === null) return null;
  const token = String(value).trim().toLowerCase();
  return token.length > 0 ? token : null;
}

function normalizeIndexerSet(indexers) {
  if (!Array.isArray(indexers)) return new Set();
  return new Set(indexers.map((entry) => normalizeIndexerToken(entry)).filter(Boolean));
}

function candidateMatchesIndexerSet(candidate, tokenSet) {
  if (!tokenSet || tokenSet.size === 0) return true;
  const idToken = normalizeIndexerToken(candidate?.indexerId);
  if (idToken && tokenSet.has(idToken)) return true;
  const nameToken = normalizeIndexerToken(candidate?.indexerName);
  if (nameToken && tokenSet.has(nameToken)) return true;
  return false;
}

function buildCandidates(nzbResults) {
  const seen = new Set();
  const candidates = [];
  nzbResults.forEach((result, index) => {
    const downloadUrl = result?.downloadUrl;
    if (!downloadUrl || seen.has(downloadUrl)) {
      return;
    }
    seen.add(downloadUrl);
    const size = Number(result?.size ?? 0);
    const title = typeof result?.title === 'string' ? result.title : null;
    candidates.push({
      result,
      index,
      size: Number.isFinite(size) ? size : 0,
      indexerId: result?.indexerId !== undefined ? String(result.indexerId) : null,
      indexerName: typeof result?.indexer === 'string' ? result.indexer : null,
      downloadUrl,
      title,
      normalizedTitle: normalizeTitle(title),
    });
  });
  return candidates;
}

function rankCandidates(candidates, preferredSizeBytes) {
  // Simple ranking by size preference only (no indexer-based priority)
  const comparator = Number.isFinite(preferredSizeBytes)
    ? (a, b) => {
        const deltaA = Math.abs((a.size || 0) - preferredSizeBytes);
        const deltaB = Math.abs((b.size || 0) - preferredSizeBytes);
        if (deltaA !== deltaB) return deltaA - deltaB;
        return (b.size || 0) - (a.size || 0);
      }
    : (a, b) => (b.size || 0) - (a.size || 0);

  return candidates.slice().sort(comparator);
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Triage timed out');
      error.code = TIMEOUT_ERROR_CODE;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function summarizeDecision(decision) {
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers : [];
  const warnings = Array.isArray(decision?.warnings) ? decision.warnings : [];
  const archiveFindings = Array.isArray(decision?.archiveFindings) ? decision.archiveFindings : [];

  const hasAssumedStoredWithoutParsedEntries = archiveFindings.some((finding) => {
    const label = String(finding?.status || '').toLowerCase();
    if (label !== 'rar-stored') return false;
    const note = String(finding?.details?.note || '').toLowerCase();
    if (note !== 'rar5-header-assumed-stored') return false;
    const hasName = Boolean(finding?.details?.name);
    const hasSamples = Array.isArray(finding?.details?.sampleEntries)
      && finding.details.sampleEntries.some((entry) => Boolean(entry));
    return !hasName && !hasSamples;
  });

  // Check if we have a 7z that couldn't be verified (untested compression)
  const hasSevenZipUntested = archiveFindings.some((finding) => {
    const label = String(finding?.status || '').toLowerCase();
    return label === 'sevenzip-untested';
  }) || warnings.some((warning) => String(warning || '').toLowerCase().includes('sevenzip-untested'));

  let status = 'blocked';
  if (decision?.decision === 'accept' && blockers.length === 0) {
    // For 7z-untested, always mark as unverified_7z regardless of segment-ok findings
    if (hasSevenZipUntested) {
      status = 'unverified_7z';
    } else if (hasAssumedStoredWithoutParsedEntries) {
      status = 'blocked';
    } else {
      const positiveFinding = archiveFindings.some((finding) => {
        const label = String(finding?.status || '').toLowerCase();
        return label === 'rar-stored' || label === 'sevenzip-stored' || label === 'segment-ok';
      });
      if (positiveFinding) {
        status = 'verified';
      } else {
        status = 'unverified';
      }
    }
  }

  // Flag other unverified outcomes that are 7z-only so downstream caching can treat them as complete
  if (status === 'unverified') {
    const sevenZipFlag = archiveFindings.some((finding) => {
      const label = String(finding?.status || '').toLowerCase();
      return label.startsWith('sevenzip');
    }) || warnings.some((warning) => String(warning || '').toLowerCase().startsWith('sevenzip'));
    if (sevenZipFlag) {
      status = 'unverified_7z';
    }
  }

  return {
    status,
    blockers,
    warnings,
    nzbIndex: decision?.nzbIndex ?? null,
    fileCount: decision?.fileCount ?? null,
    archiveFindings,
  };
}

async function triageAndRank(nzbResults, options = {}) {
  const startTs = Date.now();
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const preferredSizeBytes = Number.isFinite(options.preferredSizeBytes) ? options.preferredSizeBytes : null;
  const preferredIndexerSet = normalizeIndexerSet(options.preferredIndexerIds);
  const serializedIndexerSet = normalizeIndexerSet(options.serializedIndexerIds);
  const allowedIndexerSet = normalizeIndexerSet(options.allowedIndexerIds);
  const maxCandidates = Math.max(1, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const logger = options.logger;
  const triageOptions = { ...(options.triageOptions || {}) };
  const captureNzbPayloads = Boolean(options.captureNzbPayloads);

  const builtCandidates = buildCandidates(nzbResults);
  const constrainedCandidates = allowedIndexerSet.size > 0
    ? builtCandidates.filter((candidate) => candidateMatchesIndexerSet(candidate, allowedIndexerSet))
    : builtCandidates;
  const candidates = rankCandidates(constrainedCandidates, preferredSizeBytes, preferredIndexerSet);
  const uniqueCandidates = [];
  const seenTitles = new Set();
  candidates.forEach((candidate) => {
    const titleKey = candidate.normalizedTitle;
    if (titleKey) {
      if (seenTitles.has(titleKey)) return;
      seenTitles.add(titleKey);
    }
    uniqueCandidates.push(candidate);
  });

  const selectedCandidates = uniqueCandidates.slice(0, Math.min(maxCandidates, uniqueCandidates.length));
  if (selectedCandidates.length === 0) {
    return {
      decisions: new Map(),
      elapsedMs: Date.now() - startTs,
      timedOut: false,
      candidatesConsidered: 0,
      evaluatedCount: 0,
      fetchFailures: 0,
      summary: null,
    };
  }

  const candidateByUrl = new Map();
  selectedCandidates.forEach((candidate) => {
    candidateByUrl.set(candidate.downloadUrl, candidate);
  });

  const decisionMap = new Map();

  const attachMetadata = (url, decision) => {
    const candidateInfo = candidateByUrl.get(url);
    if (candidateInfo) {
      decision.title = candidateInfo.title || null;
      decision.normalizedTitle = candidateInfo.normalizedTitle || null;
      decision.indexerId = candidateInfo.indexerId || null;
      decision.indexerName = candidateInfo.indexerName || null;
      if (candidateInfo.result) {
        decision.publishDateMs = candidateInfo.result.publishDateMs ?? decision.publishDateMs ?? null;
        decision.publishDateIso = candidateInfo.result.publishDateIso ?? decision.publishDateIso ?? null;
        decision.ageDays = candidateInfo.result.ageDays ?? decision.ageDays ?? null;
      }
    } else {
      decision.title = decision.title ?? null;
      decision.normalizedTitle = decision.normalizedTitle ?? null;
    }
    return decision;
  };
  const downloadConcurrency = Math.max(
    1,
    Math.min(options.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY, selectedCandidates.length),
  );
  const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const triageConfig = { ...triageOptions, reuseNntpPool: true };
  const serializedChains = new Map();

  const runWithSerializedIndexer = async (indexerKey, task) => {
    if (!indexerKey || !serializedIndexerSet.has(indexerKey)) {
      return task();
    }
    const previous = serializedChains.get(indexerKey) || Promise.resolve();
    let releaseCurrent;
    const currentGate = new Promise((resolve) => {
      releaseCurrent = resolve;
    });
    const chained = previous.then(() => currentGate);
    serializedChains.set(indexerKey, chained);
    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent();
      if (serializedChains.get(indexerKey) === chained) {
        serializedChains.delete(indexerKey);
      }
    }
  };

  let cursor = 0;
  let timedOut = false;
  let evaluatedCount = 0;
  let fetchFailures = 0;

  const makeTimeoutDecision = (url) => attachMetadata(url, {
    status: 'error',
    blockers: ['triage-error'],
    warnings: ['Triage timed out'],
    archiveFindings: [],
    nzbIndex: null,
    fileCount: null,
  });

  const workers = Array.from({ length: downloadConcurrency }, async () => {
    while (true) {
      if (timedOut) return;
      const index = cursor;
      if (index >= selectedCandidates.length) return;
      cursor += 1;

      const candidate = selectedCandidates[index];
      const { downloadUrl } = candidate;

      if (decisionMap.has(downloadUrl)) continue;

      const indexerKey = normalizeIndexerToken(candidate.indexerId)
        || normalizeIndexerToken(candidate.indexerName);

      if (Date.now() - startTs >= timeBudgetMs) {
        timedOut = true;
        decisionMap.set(downloadUrl, makeTimeoutDecision(downloadUrl));
        continue;
      }

      const downloadStart = Date.now();
      // logEvent(logger, 'info', 'NZB download:start', {
      //   downloadUrl,
      //   indexerId: candidate.indexerId,
      //   indexerName: candidate.indexerName,
      //   title: candidate.title,
      // });

      let nzbPayload;
      try {
        const abortController = new AbortController();
        const hardTimeoutTimer = setTimeout(() => {
          abortController.abort();
        }, downloadTimeoutMs);

        const response = await axios.get(downloadUrl, {
          responseType: 'text',
          timeout: downloadTimeoutMs,
          signal: abortController.signal,
          headers: {
            Accept: 'application/x-nzb,text/xml;q=0.9,*/*;q=0.8',
            'User-Agent': getRandomUserAgent(),
          },
          transitional: { silentJSONParsing: true, forcedJSONParsing: false },
        }).finally(() => {
          clearTimeout(hardTimeoutTimer);
        });
        if (typeof response.data !== 'string' || response.data.length === 0) {
          throw new Error('Empty NZB payload');
        }
        nzbPayload = response.data;
        const elapsed = Date.now() - downloadStart;
        logEvent(logger, 'info', 'NZB download:success', {
          downloadUrl,
          indexerId: candidate.indexerId,
          indexerName: candidate.indexerName,
          title: candidate.title,
          durationMs: elapsed,
          bytes: typeof nzbPayload === 'string' ? nzbPayload.length : null,
        });
      } catch (err) {
        fetchFailures += 1;
        const elapsed = Date.now() - downloadStart;
        decisionMap.set(downloadUrl, attachMetadata(downloadUrl, {
          status: 'fetch-error',
          error: err?.code === 'ERR_CANCELED' || err?.message === 'canceled'
            ? 'NZB download exceeded timeout'
            : err?.message || 'Failed to fetch NZB payload',
          blockers: ['fetch-error'],
          warnings: [],
          archiveFindings: [],
          nzbIndex: null,
          fileCount: null,
        }));
        logEvent(logger, 'warn', 'NZB download:failed', {
          downloadUrl,
          message: err?.code === 'ERR_CANCELED' || err?.message === 'canceled'
            ? 'NZB download exceeded timeout'
            : err?.message,
          indexerId: candidate.indexerId,
          indexerName: candidate.indexerName,
          title: candidate.title,
          durationMs: elapsed,
        });
        continue;
      }

      if (!nzbPayload) {
        continue;
      }

      const triageTask = async () => {
        const remaining = timeBudgetMs - (Date.now() - startTs);
        if (remaining <= 0) {
          const timeoutError = new Error('Triage timed out');
          timeoutError.code = TIMEOUT_ERROR_CODE;
          throw timeoutError;
        }
        return withTimeout(triageNzbs([nzbPayload], triageConfig), remaining);
      };

      try {
        const summary = await triageTask();
        const firstDecision = summary?.decisions?.[0];
        if (firstDecision) {
          const summarized = summarizeDecision(firstDecision);
          if (captureNzbPayloads && summarized.status === 'verified') {
            summarized.nzbPayload = nzbPayload;
          }
          decisionMap.set(downloadUrl, attachMetadata(downloadUrl, summarized));
          evaluatedCount += 1;
        } else {
          decisionMap.set(downloadUrl, attachMetadata(downloadUrl, {
            status: 'error',
            blockers: ['triage-error'],
            warnings: ['No decision returned'],
            archiveFindings: [],
            nzbIndex: null,
            fileCount: null,
          }));
        }
      } catch (err) {
        if (err?.code === TIMEOUT_ERROR_CODE) {
          timedOut = true;
          decisionMap.set(downloadUrl, makeTimeoutDecision(downloadUrl));
        } else {
          decisionMap.set(downloadUrl, attachMetadata(downloadUrl, {
            status: 'error',
            blockers: ['triage-error'],
            warnings: err?.message ? [err.message] : [],
            archiveFindings: [],
            nzbIndex: null,
            fileCount: null,
          }));
        }
        logEvent(logger, 'warn', 'NZB triage failed', { message: err?.message });
      }
    }
  });

  await Promise.all(workers);

  selectedCandidates.forEach((candidate) => {
    if (!decisionMap.has(candidate.downloadUrl)) {
      decisionMap.set(candidate.downloadUrl, attachMetadata(candidate.downloadUrl, {
        status: timedOut ? 'pending' : 'skipped',
        blockers: [],
        warnings: [],
        archiveFindings: [],
        nzbIndex: null,
        fileCount: null,
      }));
    }
  });

  return {
    decisions: decisionMap,
    elapsedMs: Date.now() - startTs,
    timedOut,
    candidatesConsidered: selectedCandidates.length,
    evaluatedCount,
    fetchFailures,
    summary: null,
  };
}

module.exports = {
  triageAndRank,
};
