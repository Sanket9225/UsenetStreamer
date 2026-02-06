// Helper utilities for sorting, filtering, and processing results
const { parseReleaseMetadata } = require('../services/metadata/releaseParser');
const { normalizeReleaseTitle } = require('./parsers');
const { resolveLanguageLabel } = require('./config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function annotateNzbResult(result, sortIndex = 0) {
  if (!result || typeof result !== 'object') return result;
  const metadata = parseReleaseMetadata(result.title || '');
  const normalizedTitle = normalizeReleaseTitle(result.title);
  const primaryLanguage = result.language || (Array.isArray(metadata.languages) && metadata.languages.length > 0 ? metadata.languages[0] : null);
  const derivedQualityRank = Number.isFinite(metadata.qualityScore) ? metadata.qualityScore : 0;
  const annotated = {
    ...result,
    ...metadata,
    sortIndex,
    normalizedTitle,
    qualityRank: derivedQualityRank,
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

function filterByReleaseExclusions(results, exclusionTokens) {
  if (!Array.isArray(results) || !exclusionTokens || exclusionTokens.length === 0) {
    return results;
  }
  const normalizedTokens = exclusionTokens
    .map((value) => (value === undefined || value === null ? null : String(value).trim().toLowerCase()))
    .filter((token) => token && token.length > 0);

  if (normalizedTokens.length === 0) {
    return results;
  }

  const matchesToken = (value, token) => {
    if (!value) return false;
    return String(value).toLowerCase().includes(token);
  };

  return results.filter((result) => {
    const fieldsToCheck = [
      result.resolution,
      result.qualityLabel,
      result.codec,
      result.source,
      result.audio,
      result.group,
      result.container,
      result.threeD,
      result.bitDepth,
    ];

    if (Array.isArray(result.hdrList)) fieldsToCheck.push(...result.hdrList);
    if (Array.isArray(result.audioList)) fieldsToCheck.push(...result.audioList);
    if (Array.isArray(result.visualTags)) fieldsToCheck.push(...result.visualTags);

    // Check flags explicitly
    if (result.hardcoded) fieldsToCheck.push('hardcoded');
    if (result.proper) fieldsToCheck.push('proper');
    if (result.repack) fieldsToCheck.push('repack');
    if (result.hdr) fieldsToCheck.push('hdr');
    if (result.extended) fieldsToCheck.push('extended');
    if (result.remastered) fieldsToCheck.push('remastered');
    if (result.unrated) fieldsToCheck.push('unrated');
    if (result.remux) fieldsToCheck.push('remux');
    if (result.retail) fieldsToCheck.push('retail');
    if (result.upscaled) fieldsToCheck.push('upscaled');
    if (result.convert) fieldsToCheck.push('convert');
    if (result.documentary) fieldsToCheck.push('documentary');
    if (result.dubbed) fieldsToCheck.push('dubbed');
    if (result.subbed) fieldsToCheck.push('subbed');
    if (result.edition) fieldsToCheck.push(result.edition);
    if (Array.isArray(result.releaseTypes)) fieldsToCheck.push(...result.releaseTypes);

    for (const token of normalizedTokens) {
      for (const field of fieldsToCheck) {
        if (field && matchesToken(field, token)) return false;
      }
    }
    return true;
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

function applyResolutionLimits(results, perQualityLimit) {
  if (!Array.isArray(results) || !Number.isFinite(perQualityLimit) || perQualityLimit <= 0) {
    return results;
  }
  const counters = new Map();
  return results.filter((result) => {
    const resolutionLabel = result?.resolution || result?.release?.resolution || null;
    const token = resolutionLabel ? String(resolutionLabel).trim().toLowerCase() : null;
    const normalized = token || 'unknown';
    const current = counters.get(normalized) || 0;
    if (current >= perQualityLimit) {
      return false;
    }
    counters.set(normalized, current + 1);
    return true;
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
    .map((lang) => resolveLanguageLabel(lang))
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
  const aRank = Number.isFinite(a?.qualityRank) ? a.qualityRank : 0;
  const bRank = Number.isFinite(b?.qualityRank) ? b.qualityRank : 0;
  if (aRank !== bRank) {
    return bRank - aRank;
  }
  const aSize = Number.isFinite(a?.size) ? a.size : 0;
  const bSize = Number.isFinite(b?.size) ? b.size : 0;
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
  const {
    maxSizeBytes,
    sortMode,
    preferredLanguages,
    resolutionLimitPerQuality,
    allowedResolutions,
    releaseExclusions,
  } = options;
  let working = Array.isArray(results) ? results.slice() : [];
  working = filterByAllowedResolutions(working, allowedResolutions);
  working = filterByReleaseExclusions(working, releaseExclusions);
  working = applyMaxSizeFilter(working, maxSizeBytes);
  working = sortAnnotatedResults(working, sortMode, preferredLanguages);
  working = applyResolutionLimits(working, resolutionLimitPerQuality);
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
    case 'unverified_7z':
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

function prioritizeTriageCandidates(results, maxCandidates, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const seenTitles = new Set();
  const perIndexerLimitMap = options.perIndexerLimitMap instanceof Map ? options.perIndexerLimitMap : null;
  const getIndexerKey = typeof options.getIndexerKey === 'function' ? options.getIndexerKey : null;
  const perIndexerCounts = new Map();
  const selected = [];
  const shouldInclude = typeof options.shouldInclude === 'function' ? options.shouldInclude : null;
  for (const result of results) {
    if (!result) continue;
    const normalizedTitle = result.normalizedTitle || normalizeReleaseTitle(result.title) || result.downloadUrl;
    if (seenTitles.has(normalizedTitle)) continue;
    if (shouldInclude && !shouldInclude(result)) {
      continue;
    }
    if (perIndexerLimitMap && getIndexerKey) {
      const key = getIndexerKey(result);
      if (key && perIndexerLimitMap.has(key)) {
        const current = perIndexerCounts.get(key) || 0;
        const limit = perIndexerLimitMap.get(key);
        if (Number.isFinite(limit) && current >= limit) {
          continue;
        }
        perIndexerCounts.set(key, current + 1);
      }
    }
    seenTitles.add(normalizedTitle);
    selected.push(result);
    if (selected.length >= Math.max(1, maxCandidates)) break;
  }
  return selected;
}

function triageDecisionsMatchStatuses(decisionMap, candidates, allowedStatuses) {
  if (!decisionMap || !candidates || candidates.length === 0 || !allowedStatuses || allowedStatuses.size === 0) {
    return false;
  }
  for (const candidate of candidates) {
    const decision = decisionMap.get(candidate.downloadUrl);
    const status = decision?.status ? String(decision.status).toLowerCase() : null;
    if (!status || !allowedStatuses.has(status)) {
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
  filterByReleaseExclusions,
  applyResolutionLimits,
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
  formatStreamTitle,
};

const TemplateEngine = require('./templateEngine');

function formatStreamTitle(pattern, data, defaultPattern = '{title}') {
  let effectivePattern = (pattern && typeof pattern === 'string' && pattern.trim().length > 0)
    ? pattern
    : defaultPattern;

  const engine = new TemplateEngine(data);
  return engine.render(effectivePattern);
}
