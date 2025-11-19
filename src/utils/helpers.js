// Helper utilities for sorting, filtering, and processing results
const { parseReleaseMetadata } = require('../services/metadata/releaseParser');
const { normalizeReleaseTitle } = require('./parsers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function annotateNzbResult(result, sortIndex = 0) {
  if (!result || typeof result !== 'object') return result;
  const metadata = parseReleaseMetadata(result.title || '');
  return {
    ...result,
    ...metadata,
    sortIndex,
    normalizedTitle: normalizeReleaseTitle(result.title),
  };
}

function applyMaxSizeFilter(results, maxSizeBytes) {
  if (!Array.isArray(results) || !Number.isFinite(maxSizeBytes) || maxSizeBytes <= 0) {
    return results;
  }
  return results.filter((result) => {
    const size = result?.size;
    return !Number.isFinite(size) || size <= maxSizeBytes;
  });
}

function resultMatchesPreferredLanguage(result, preferredLanguage) {
  if (!preferredLanguage || !result) return false;
  const normalized = preferredLanguage.toLowerCase();
  if (result.language && result.language.toLowerCase() === normalized) {
    return true;
  }
  if (Array.isArray(result.languages)) {
    return result.languages.some((lang) => lang && lang.toLowerCase() === normalized);
  }
  return false;
}

function compareQualityThenSize(a, b) {
  if (a.qualityRank !== b.qualityRank) {
    return b.qualityRank - a.qualityRank;
  }
  const aSize = Number.isFinite(a.size) ? a.size : 0;
  const bSize = Number.isFinite(b.size) ? b.size : 0;
  return bSize - aSize;
}

function sortAnnotatedResults(results, sortMode, preferredLanguage) {
  if (!Array.isArray(results) || results.length === 0) return results;

  if (sortMode === 'language_quality_size' && preferredLanguage) {
    const preferred = [];
    const others = [];
    for (const result of results) {
      if (resultMatchesPreferredLanguage(result, preferredLanguage)) {
        preferred.push(result);
      } else {
        others.push(result);
      }
    }
    preferred.sort(compareQualityThenSize);
    others.sort(compareQualityThenSize);
    return preferred.concat(others);
  }

  results.sort(compareQualityThenSize);
  return results;
}

function prepareSortedResults(results, options = {}) {
  const { maxSizeBytes, sortMode, preferredLanguage } = options;
  let working = applyMaxSizeFilter(results, maxSizeBytes);
  working = sortAnnotatedResults(working, sortMode, preferredLanguage);
  return working;
}

function triageStatusRank(status) {
  switch (status) {
    case 'blocked':
    case 'fetch-error':
    case 'error':
      return 4;
    case 'verified':
      return 3;
    case 'unverified':
      return 2;
    case 'pending':
    case 'skipped':
      return 1;
    default:
      return 0;
  }
}

function buildTriageTitleMap(decisions) {
  const titleMap = new Map();
  if (!(decisions instanceof Map)) return titleMap;

  decisions.forEach((decision, downloadUrl) => {
    if (!decision) return;
    const status = decision.status;
    if (!status || status === 'pending' || status === 'skipped') return;
    const normalizedTitle = decision.normalizedTitle || normalizeReleaseTitle(decision.title);
    if (!normalizedTitle) return;
    const existing = titleMap.get(normalizedTitle);
    if (!existing || triageStatusRank(status) >= triageStatusRank(existing.status)) {
      titleMap.set(normalizedTitle, {
        status,
        blockers: Array.isArray(decision.blockers) ? decision.blockers.slice() : [],
        warnings: Array.isArray(decision.warnings) ? decision.warnings.slice() : [],
        archiveFindings: Array.isArray(decision.archiveFindings) ? decision.archiveFindings.slice() : [],
        fileCount: decision.fileCount ?? null,
        normalizedTitle,
        title: decision.title || null,
        sourceDownloadUrl: downloadUrl,
        publishDateMs: decision.publishDateMs ?? null,
        ageDays: decision.ageDays ?? null,
      });
    }
  });

  return titleMap;
}

function prioritizeTriageCandidates(results, maxCandidates) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const seenTitles = new Set();
  const selected = [];
  for (const result of results) {
    if (!result) continue;
    const normalizedTitle = result.normalizedTitle || normalizeReleaseTitle(result.title) || result.downloadUrl;
    if (seenTitles.has(normalizedTitle)) continue;
    seenTitles.add(normalizedTitle);
    selected.push(result);
    if (selected.length >= Math.max(1, maxCandidates)) break;
  }
  return selected;
}

function triageDecisionsMatchStatuses(decisionMap, candidates, allowedStatuses) {
  if (!decisionMap || !candidates || candidates.length === 0) return false;
  for (const candidate of candidates) {
    const decision = decisionMap.get(candidate.downloadUrl);
    if (!decision || !allowedStatuses.has(decision.status)) {
      return false;
    }
  }
  return true;
}

function sanitizeDecisionForCache(decision) {
  if (!decision) return null;
  return {
    status: decision.status || 'unknown',
    blockers: Array.isArray(decision.blockers) ? decision.blockers : [],
    warnings: Array.isArray(decision.warnings) ? decision.warnings : [],
    fileCount: decision.fileCount ?? null,
    nzbIndex: decision.nzbIndex ?? null,
    archiveFindings: Array.isArray(decision.archiveFindings) ? decision.archiveFindings : [],
    title: decision.title || null,
    normalizedTitle: decision.normalizedTitle || null,
    indexerId: decision.indexerId || null,
    indexerName: decision.indexerName || null,
    publishDateMs: decision.publishDateMs ?? null,
    publishDateIso: decision.publishDateIso || null,
    ageDays: decision.ageDays ?? null,
  };
}

function serializeFinalNzbResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((result) => {
    if (!result || typeof result !== 'object') return result;
    const serialized = { ...result };
    if (result._triageDecision) {
      serialized._triageDecision = sanitizeDecisionForCache(result._triageDecision);
    }
    return serialized;
  });
}

function restoreFinalNzbResults(serialized) {
  if (!Array.isArray(serialized)) return [];
  return serialized;
}

async function safeStat(filePath) {
  const fs = require('fs');
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    return null;
  }
}

module.exports = {
  sleep,
  annotateNzbResult,
  applyMaxSizeFilter,
  resultMatchesPreferredLanguage,
  compareQualityThenSize,
  sortAnnotatedResults,
  prepareSortedResults,
  triageStatusRank,
  buildTriageTitleMap,
  prioritizeTriageCandidates,
  triageDecisionsMatchStatuses,
  sanitizeDecisionForCache,
  serializeFinalNzbResults,
  restoreFinalNzbResults,
  safeStat,
};
