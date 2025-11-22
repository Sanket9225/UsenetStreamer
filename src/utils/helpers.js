// Helper utilities for sorting, filtering, and processing results
const { parseReleaseMetadata } = require('../services/metadata/releaseParser');
const { normalizeReleaseTitle } = require('./parsers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function annotateNzbResult(result, sortIndex = 0) {
  if (!result || typeof result !== 'object') return result;
  const metadata = parseReleaseMetadata(result.title || '');
  const normalizedTitle = normalizeReleaseTitle(result.title);
  const primaryLanguage = result.language || (Array.isArray(metadata.languages) && metadata.languages.length > 0 ? metadata.languages[0] : null);
  const annotated = {
    ...result,
    ...metadata,
    sortIndex,
    normalizedTitle,
  };
  if (primaryLanguage) {
    annotated.language = primaryLanguage;
  }
  return annotated;
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

function filterByAllowedResolutions(results, allowedResolutions) {
  if (!Array.isArray(results) || !allowedResolutions || allowedResolutions.length === 0) {
    return results;
  }
  const normalizedTokens = allowedResolutions
    .map((value) => (value === undefined || value === null ? null : String(value).trim().toLowerCase()))
    .filter((token) => token && token.length > 0);
  if (normalizedTokens.length === 0) {
    return results;
  }
  const allowUnknown = normalizedTokens.includes('unknown');
  const allowedSet = new Set(normalizedTokens.filter((token) => token !== 'unknown'));
  return results.filter((result) => {
    const resolutionToken = result?.resolution ? String(result.resolution).trim().toLowerCase() : null;
    if (!resolutionToken || resolutionToken === 'unknown') {
      return allowUnknown;
    }
    if (allowedSet.size === 0) {
      return false;
    }
    return allowedSet.has(resolutionToken);
  });
}

function normalizePreferredLanguageList(preferredLanguages) {
  if (!preferredLanguages) return [];
  const list = Array.isArray(preferredLanguages)
    ? preferredLanguages
    : typeof preferredLanguages === 'string'
      ? preferredLanguages.split(',')
      : [];
  const normalized = [];
  const seen = new Set();
  list.forEach((entry) => {
    const value = entry === undefined || entry === null ? '' : String(entry).trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }
  });
  return normalized;
}

function gatherResultLanguages(result) {
  if (!result) return [];
  const collection = [];
  if (result.language) collection.push(result.language);
  if (Array.isArray(result.languages)) collection.push(...result.languages);
  return collection
    .map((lang) => (lang === undefined || lang === null ? '' : String(lang).trim()))
    .filter((lang) => lang.length > 0);
}

function getPreferredLanguageMatches(result, preferredLanguages) {
  const preferences = normalizePreferredLanguageList(preferredLanguages).map((lang) => lang.toLowerCase());
  if (!result || preferences.length === 0) return [];
  const resultLanguages = gatherResultLanguages(result).map((lang) => ({
    raw: lang,
    normalized: lang.toLowerCase(),
  }));
  if (resultLanguages.length === 0) return [];
  const matches = [];
  for (const pref of preferences) {
    const match = resultLanguages.find((lang) => lang.normalized === pref);
    if (match) {
      matches.push(match.raw);
    }
  }
  return matches;
}

function getPreferredLanguageMatch(result, preferredLanguages) {
  const matches = getPreferredLanguageMatches(result, preferredLanguages);
  return matches.length > 0 ? matches[0] : null;
}

function resultMatchesPreferredLanguage(result, preferredLanguages) {
  return getPreferredLanguageMatches(result, preferredLanguages).length > 0;
}

function compareQualityThenSize(a, b) {
  if (a.qualityRank !== b.qualityRank) {
    return b.qualityRank - a.qualityRank;
  }
  const aSize = Number.isFinite(a.size) ? a.size : 0;
  const bSize = Number.isFinite(b.size) ? b.size : 0;
  return bSize - aSize;
}

function sortAnnotatedResults(results, sortMode, preferredLanguages) {
  if (!Array.isArray(results) || results.length === 0) return results;

  const normalizedPreferences = normalizePreferredLanguageList(preferredLanguages);
  if (sortMode === 'language_quality_size' && normalizedPreferences.length > 0) {
    const preferred = [];
    const others = [];
    for (const result of results) {
      if (resultMatchesPreferredLanguage(result, normalizedPreferences)) {
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
  const { maxSizeBytes, sortMode, preferredLanguages, allowedResolutions } = options;
  let working = Array.isArray(results) ? results.slice() : [];
  working = filterByAllowedResolutions(working, allowedResolutions);
  working = applyMaxSizeFilter(working, maxSizeBytes);
  working = sortAnnotatedResults(working, sortMode, preferredLanguages);
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
  filterByAllowedResolutions,
  resultMatchesPreferredLanguage,
  getPreferredLanguageMatches,
  getPreferredLanguageMatch,
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
