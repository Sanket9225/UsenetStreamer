require('dotenv').config();

const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const fs = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
// webdav is an ES module; we'll import it lazily when first needed
const path = require('path');
const runtimeEnv = require('./config/runtimeEnv');

// Apply runtime environment BEFORE loading any services
runtimeEnv.applyRuntimeEnv();

const {
  testIndexerConnection,
  testNzbdavConnection,
  testUsenetConnection,
  testNewznabConnection,
  testNewznabSearch,
  testTmdbConnection,
} = require('./src/utils/connectionTests');
const { triageAndRank } = require('./src/services/triage/runner');
const { preWarmNntpPool, evictStaleSharedNntpPool } = require('./src/services/triage');
const {
  getPublishMetadataFromResult,
  areReleasesWithinDays,
} = require('./src/utils/publishInfo');
const { parseReleaseMetadata, LANGUAGE_FILTERS, LANGUAGE_SYNONYMS, QUALITY_FEATURE_PATTERNS } = require('./src/services/metadata/releaseParser');
const cache = require('./src/cache');
const { ensureSharedSecret } = require('./src/middleware/auth');
const newznabService = require('./src/services/newznab');
const easynewsService = require('./src/services/easynews');
const { toFiniteNumber, toPositiveInt, toBoolean, parseCommaList, parsePathList, normalizeSortMode, resolvePreferredLanguages, resolveLanguageLabel, resolveLanguageLabels, toSizeBytesFromGb, collectConfigValues, computeManifestUrl, stripTrailingSlashes, decodeBase64Value } = require('./src/utils/config');
const { normalizeReleaseTitle, parseRequestedEpisode, isVideoFileName, fileMatchesEpisode, normalizeNzbdavPath, inferMimeType, normalizeIndexerToken, nzbMatchesIndexer, cleanSpecialSearchTitle, parseFilterList, normalizeResolutionToken } = require('./src/utils/parsers');
const { sleep, annotateNzbResult, applyMaxSizeFilter, prepareSortedResults, getPreferredLanguageMatch, getPreferredLanguageMatches, triageStatusRank, buildTriageTitleMap, prioritizeTriageCandidates, triageDecisionsMatchStatuses, sanitizeDecisionForCache, serializeFinalNzbResults, restoreFinalNzbResults, safeStat, formatStreamTitle } = require('./src/utils/helpers');
const indexerService = require('./src/services/indexer');
const nzbdavService = require('./src/services/nzbdav');
const specialMetadata = require('./src/services/specialMetadata');
const tmdbService = require('./src/services/tmdb');
const tvdbService = require('./src/services/tvdb');

const app = express();
let currentPort = Number(process.env.PORT || 7000);
const ADDON_VERSION = '1.7.1';
const DEFAULT_ADDON_NAME = 'UsenetStreamer';
let serverInstance = null;
const SERVER_HOST = '0.0.0.0';
const DEDUPE_MAX_PUBLISH_DIFF_DAYS = 14;
let PAID_INDEXER_TOKENS = new Set();


// Blocklist patterns for unplayable/unwanted release types
// Matches standalone tokens: .iso, -iso-, (iso), space-delimited, etc.
const RELEASE_BLOCKLIST_REGEX = /(?:^|[\s.\-_(\[])(?:iso|img|bin|cue|exe)(?:[\s.\-_\)\]]|$)/i;

const PREFETCH_NZBDAV_JOB_TTL_MS = 60 * 60 * 1000;
const prefetchedNzbdavJobs = new Map();
const TRIAGE_FINAL_STATUSES = new Set(['verified', 'blocked', 'unverified_7z']);

function isTriageFinalStatus(status) {
  if (!status) return false;
  return TRIAGE_FINAL_STATUSES.has(String(status).toLowerCase());
}

function prunePrefetchedNzbdavJobs() {
  if (prefetchedNzbdavJobs.size === 0) return;
  const cutoff = Date.now() - PREFETCH_NZBDAV_JOB_TTL_MS;
  for (const [key, entry] of prefetchedNzbdavJobs.entries()) {
    if (entry?.createdAt && entry.createdAt < cutoff) {
      prefetchedNzbdavJobs.delete(key);
    }
  }
}

async function resolvePrefetchedNzbdavJob(downloadUrl) {
  prunePrefetchedNzbdavJobs();
  const entry = prefetchedNzbdavJobs.get(downloadUrl);
  if (!entry) return null;
  if (entry.promise) {
    try {
      const resolved = await entry.promise;
      const merged = { ...resolved, createdAt: resolved.createdAt || Date.now() };
      const latest = prefetchedNzbdavJobs.get(downloadUrl);
      if (latest && latest.promise === entry.promise) {
        prefetchedNzbdavJobs.set(downloadUrl, merged);
      }
      return merged;
    } catch (error) {
      const latest = prefetchedNzbdavJobs.get(downloadUrl);
      if (latest && latest.promise === entry.promise) {
        prefetchedNzbdavJobs.delete(downloadUrl);
      }
      console.warn('[NZBDAV] Prefetch job failed before reuse:', error.message || error);
      return null;
    }
  }
  return entry;
}

function formatResolutionBadge(resolution) {
  if (!resolution) return null;
  const normalized = resolution.toLowerCase();

  if (normalized === '8k' || normalized === '4320p') return '8K';
  if (normalized === '4k' || normalized === '2160p' || normalized === 'uhd') return '4K';

  if (normalized.endsWith('p')) return normalized.toUpperCase();
  return resolution;
}

function extractQualityFeatureBadges(title) {
  if (!title) return [];
  const badges = [];
  QUALITY_FEATURE_PATTERNS.forEach(({ label, regex }) => {
    if (regex.test(title)) {
      badges.push(label);
    }
  });
  return badges;
}

app.use(cors());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const adminApiRouter = express.Router();
adminApiRouter.use(express.json({ limit: '1mb' }));
const adminStatic = express.static(path.join(__dirname, 'admin'));

adminApiRouter.get('/config', (req, res) => {
  const values = collectConfigValues(ADMIN_CONFIG_KEYS);
  if (!values.NZB_MAX_RESULT_SIZE_GB) {
    values.NZB_MAX_RESULT_SIZE_GB = String(DEFAULT_MAX_RESULT_SIZE_GB);
  }
  if (!values.TMDB_SEARCH_MODE) {
    values.TMDB_SEARCH_MODE = 'english_only';
  }
  res.json({
    values,
    manifestUrl: computeManifestUrl(),
    runtimeEnvPath: runtimeEnv.RUNTIME_ENV_FILE,
    debugNewznabSearch: isNewznabDebugEnabled(),
    newznabPresets: newznabService.getAvailableNewznabPresets(),
    addonVersion: ADDON_VERSION,
  });
});

adminApiRouter.post('/config', async (req, res) => {
  const payload = req.body || {};
  const incoming = payload.values;
  if (!incoming || typeof incoming !== 'object') {
    res.status(400).json({ error: 'Invalid payload: expected "values" object' });
    return;
  }

  // Debug: log TMDb related keys
  console.log('[ADMIN] Received TMDb config:', {
    TMDB_ENABLED: incoming.TMDB_ENABLED,
    TMDB_API_KEY: incoming.TMDB_API_KEY ? `(${incoming.TMDB_API_KEY.length} chars)` : '(empty)',
    TMDB_SEARCH_LANGUAGES: incoming.TMDB_SEARCH_LANGUAGES,
    TMDB_SEARCH_MODE: incoming.TMDB_SEARCH_MODE,
  });

  const updates = {};
  const numberedKeySet = new Set(NEWZNAB_NUMBERED_KEYS);
  NEWZNAB_NUMBERED_KEYS.forEach((key) => {
    updates[key] = null;
  });

  // Debug: ensure ADMIN_CONFIG_KEYS contains TMDb keys
  if (!ADMIN_CONFIG_KEYS.includes('TMDB_API_KEY')) {
    console.error('[ADMIN] TMDB_API_KEY missing from ADMIN_CONFIG_KEYS');
  }
  if (!ADMIN_CONFIG_KEYS.includes('TMDB_ENABLED')) {
    console.error('[ADMIN] TMDB_ENABLED missing from ADMIN_CONFIG_KEYS');
  }
  if (!ADMIN_CONFIG_KEYS.includes('TMDB_SEARCH_LANGUAGES')) {
    console.error('[ADMIN] TMDB_SEARCH_LANGUAGES missing from ADMIN_CONFIG_KEYS');
  }
  if (!ADMIN_CONFIG_KEYS.includes('TMDB_SEARCH_MODE')) {
    console.error('[ADMIN] TMDB_SEARCH_MODE missing from ADMIN_CONFIG_KEYS');
  }
  const tmdbKeysInAdminConfig = ADMIN_CONFIG_KEYS.filter((k) => k.startsWith('TMDB_'));
  console.log('[ADMIN] TMDb keys in ADMIN_CONFIG_KEYS:', tmdbKeysInAdminConfig);
  console.log('[ADMIN] ADMIN_CONFIG_KEYS length:', ADMIN_CONFIG_KEYS.length);

  ADMIN_CONFIG_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      const value = incoming[key];
      if (numberedKeySet.has(key)) {
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (trimmed === '' || trimmed === null || trimmed === undefined) {
          updates[key] = null;
        } else if (typeof value === 'boolean') {
          updates[key] = value ? 'true' : 'false';
        } else {
          updates[key] = String(value);
        }
        return;
      }
      if (value === null || value === undefined) {
        updates[key] = '';
      } else if (typeof value === 'boolean') {
        updates[key] = value ? 'true' : 'false';
      } else {
        updates[key] = String(value);
      }
    }
  });

  // Safety: explicitly persist TMDb keys even if ADMIN_CONFIG_KEYS filtering breaks
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_API_KEY')) {
    updates.TMDB_API_KEY = incoming.TMDB_API_KEY ? String(incoming.TMDB_API_KEY) : '';
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_ENABLED')) {
    updates.TMDB_ENABLED = incoming.TMDB_ENABLED ? String(incoming.TMDB_ENABLED) : 'false';
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_SEARCH_LANGUAGES')) {
    updates.TMDB_SEARCH_LANGUAGES = incoming.TMDB_SEARCH_LANGUAGES ? String(incoming.TMDB_SEARCH_LANGUAGES) : '';
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_SEARCH_MODE')) {
    updates.TMDB_SEARCH_MODE = incoming.TMDB_SEARCH_MODE ? String(incoming.TMDB_SEARCH_MODE) : '';
  }

  // Debug: log what we're about to save
  console.log('[ADMIN] TMDb updates to save:', {
    TMDB_ENABLED: updates.TMDB_ENABLED,
    TMDB_API_KEY: updates.TMDB_API_KEY ? `(${updates.TMDB_API_KEY.length} chars)` : '(not in updates)',
    TMDB_SEARCH_LANGUAGES: updates.TMDB_SEARCH_LANGUAGES,
    TMDB_SEARCH_MODE: updates.TMDB_SEARCH_MODE,
  });

  try {
    runtimeEnv.updateRuntimeEnv(updates);
    runtimeEnv.applyRuntimeEnv();

    const newznabConfigsForCaps = newznabService.getNewznabConfigsFromValues(incoming, { includeEmpty: false });
    try {
      const capsCache = await newznabService.refreshCapsCache(newznabConfigsForCaps, { timeoutMs: 12000 });
      console.log('[NEWZNAB][CAPS] Saved caps cache', capsCache);
      runtimeEnv.updateRuntimeEnv({
        NEWZNAB_CAPS_CACHE: Object.keys(capsCache).length > 0 ? JSON.stringify(capsCache) : ''
      });
      runtimeEnv.applyRuntimeEnv();
    } catch (capsError) {
      console.warn('[NEWZNAB][CAPS] Failed to refresh caps cache (config saved anyway)', capsError?.message || capsError);
    }

    // Debug: check process.env after apply
    console.log('[ADMIN] process.env.TMDB_API_KEY after apply:', process.env.TMDB_API_KEY ? `(${process.env.TMDB_API_KEY.length} chars)` : '(empty)');

    indexerService.reloadConfig();
    nzbdavService.reloadConfig();
    tmdbService.reloadConfig();
    tvdbService.reloadConfig();
    if (typeof cache.reloadNzbdavCacheConfig === 'function') {
      cache.reloadNzbdavCacheConfig();
    }
    cache.clearAllCaches('admin-config-save');
    const { portChanged } = rebuildRuntimeConfig();
    if (portChanged) {
      await restartHttpServer();
    } else {
      startHttpServer();
    }
    res.json({ success: true, manifestUrl: computeManifestUrl(), hotReloaded: true, portChanged });
  } catch (error) {
    console.error('[ADMIN] Failed to update configuration', error);
    res.status(500).json({ error: 'Failed to persist configuration changes' });
  }
});

adminApiRouter.post('/test-connections', async (req, res) => {
  const payload = req.body || {};
  const { type, values } = payload;
  if (!type || typeof values !== 'object') {
    res.status(400).json({ error: 'Invalid payload: expected "type" and "values"' });
    return;
  }

  try {
    let message;
    switch (type) {
      case 'indexer':
        message = await testIndexerConnection(values);
        break;
      case 'nzbdav':
        message = await testNzbdavConnection(values);
        break;
      case 'usenet':
        message = await testUsenetConnection(values);
        break;
      case 'newznab':
        message = await testNewznabConnection(values);
        break;
      case 'newznab-search':
        message = await testNewznabSearch(values);
        break;
      case 'easynews': {
        const username = values?.EASYNEWS_USERNAME || '';
        const password = values?.EASYNEWS_PASSWORD || '';
        message = await easynewsService.testEasynewsCredentials({ username, password });
        break;
      }
      case 'tmdb':
        message = await testTmdbConnection(values);
        break;
      case 'tvdb':
        message = await tvdbService.testTvdbConnection({
          apiKey: values?.TVDB_API_KEY,
          enabled: values?.TVDB_ENABLED,
        });
        break;
      default:
        res.status(400).json({ error: `Unknown test type: ${type}` });
        return;
    }
    res.json({ status: 'ok', message });
  } catch (error) {
    const reason = error?.message || 'Connection test failed';
    res.json({ status: 'error', message: reason });
  }
});

app.use('/admin/api', (req, res, next) => ensureSharedSecret(req, res, next), adminApiRouter);
app.use('/admin', adminStatic);
app.use('/:token/admin', (req, res, next) => {
  ensureSharedSecret(req, res, (err) => {
    if (err) return;
    adminStatic(req, res, next);
  });
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Serve shared utilities to frontend
app.get('/utils/templateEngine.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/utils/templateEngine.js'));
});

app.use((req, res, next) => {
  if (req.path.startsWith('/assets/')) return next();
  if (req.path.startsWith('/admin') && !req.path.startsWith('/admin/api')) return next();
  if (/^\/[^/]+\/admin/.test(req.path) && !/^\/[^/]+\/admin\/api/.test(req.path)) return next();
  return ensureSharedSecret(req, res, next);
});

// Additional authentication middleware is registered after admin routes are defined

// Streaming mode: 'nzbdav' (default) or 'native' (Windows Stremio v5 only)
let STREAMING_MODE = (process.env.STREAMING_MODE || 'nzbdav').trim().toLowerCase();
if (!['nzbdav', 'native'].includes(STREAMING_MODE)) STREAMING_MODE = 'nzbdav';

// Configure indexer manager (Prowlarr or NZBHydra)
// Note: In native streaming mode, manager is forced to 'none'
let INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'none').trim().toLowerCase();
if (STREAMING_MODE === 'native') INDEXER_MANAGER = 'none'; // Force newznab-only in native mode
let INDEXER_MANAGER_URL = (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || '').trim();
let INDEXER_MANAGER_API_KEY = (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || '').trim();
let INDEXER_MANAGER_LABEL = INDEXER_MANAGER === 'nzbhydra'
  ? 'NZBHydra'
  : INDEXER_MANAGER === 'none'
    ? 'Disabled'
    : 'Prowlarr';
let INDEXER_MANAGER_STRICT_ID_MATCH = toBoolean(process.env.INDEXER_MANAGER_STRICT_ID_MATCH || process.env.PROWLARR_STRICT_ID_MATCH, false);
let INDEXER_MANAGER_INDEXERS = (() => {
  const raw = process.env.INDEXER_MANAGER_INDEXERS || process.env.PROWLARR_INDEXERS || '';
  if (!raw.trim()) return null;
  if (raw.trim() === '-1') return -1;
  return parseCommaList(raw);
})();
let INDEXER_LOG_PREFIX = '';
let INDEXER_MANAGER_CACHE_MINUTES = (() => {
  const raw = Number(process.env.INDEXER_MANAGER_CACHE_MINUTES || process.env.NZBHYDRA_CACHE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : (INDEXER_MANAGER === 'nzbhydra' ? 10 : null);
})();
let INDEXER_MANAGER_BASE_URL = INDEXER_MANAGER_URL.replace(/\/+$/, '');
let ADDON_BASE_URL = (process.env.ADDON_BASE_URL || '').trim();
let ADDON_SHARED_SECRET = (process.env.ADDON_SHARED_SECRET || '').trim();
let ADDON_NAME = (process.env.ADDON_NAME || DEFAULT_ADDON_NAME).trim() || DEFAULT_ADDON_NAME;
const DEFAULT_MAX_RESULT_SIZE_GB = 30;
let NZBDAV_HISTORY_CATALOG_LIMIT = (() => {
  const raw = toFiniteNumber(process.env.NZBDAV_HISTORY_CATALOG_LIMIT, 100);
  if (!Number.isFinite(raw) || raw < 0) return 100;
  return Math.floor(raw);
})();
let INDEXER_MANAGER_BACKOFF_ENABLED = toBoolean(process.env.INDEXER_MANAGER_BACKOFF_ENABLED, true);
let INDEXER_MANAGER_BACKOFF_SECONDS = toPositiveInt(process.env.INDEXER_MANAGER_BACKOFF_SECONDS, 120);
let indexerManagerUnavailableUntil = 0;

let NEWZNAB_ENABLED = toBoolean(process.env.NEWZNAB_ENABLED, false);
let NEWZNAB_FILTER_NZB_ONLY = toBoolean(process.env.NEWZNAB_FILTER_NZB_ONLY, true);
let DEBUG_NEWZNAB_SEARCH = toBoolean(process.env.DEBUG_NEWZNAB_SEARCH, false);
let DEBUG_NEWZNAB_TEST = toBoolean(process.env.DEBUG_NEWZNAB_TEST, false);
let DEBUG_NEWZNAB_ENDPOINTS = toBoolean(process.env.DEBUG_NEWZNAB_ENDPOINTS, false);
let NEWZNAB_CONFIGS = newznabService.getEnvNewznabConfigs({ includeEmpty: false });
let ACTIVE_NEWZNAB_CONFIGS = newznabService.filterUsableConfigs(NEWZNAB_CONFIGS, { requireEnabled: true, requireApiKey: true });
const NEWZNAB_LOG_PREFIX = '[NEWZNAB]';

function getPaidDirectIndexerTokens(configs = ACTIVE_NEWZNAB_CONFIGS) {
  return configs
    .filter((config) => config && config.isPaid && !config.zyclopsEnabled)
    .map((config) => normalizeIndexerToken(config.slug || config.dedupeKey || config.displayName || config.id))
    .filter(Boolean);
}

function buildPaidIndexerLimitMap(configs = ACTIVE_NEWZNAB_CONFIGS) {
  const limitMap = new Map();
  (configs || []).forEach((config) => {
    if (!config || !config.isPaid || config.zyclopsEnabled) return;
    const limit = Number.isFinite(config.paidLimit) ? config.paidLimit : 6;
    const tokens = [
      config.slug,
      config.dedupeKey,
      config.displayName,
      config.name,
      config.id,
    ].map((token) => normalizeIndexerToken(token)).filter(Boolean);
    tokens.forEach((token) => {
      const existing = limitMap.get(token);
      if (!existing || limit < existing) {
        limitMap.set(token, limit);
      }
    });
  });
  return limitMap;
}

function buildManagerIndexerLimitMap() {
  if (INDEXER_MANAGER === 'none') {
    return new Map();
  }
  const limitMap = new Map();
  const indexers = TRIAGE_PRIORITY_INDEXERS || [];
  const limits = TRIAGE_PRIORITY_INDEXER_LIMITS || [];
  indexers.forEach((indexer, idx) => {
    const token = normalizeIndexerToken(indexer);
    if (!token) return;
    const rawLimit = limits[idx];
    const parsed = rawLimit !== undefined ? Number(String(rawLimit).trim()) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
    const existing = limitMap.get(token);
    if (!existing || limit < existing) {
      limitMap.set(token, limit);
    }
  });
  return limitMap;
}

function buildCombinedLimitMap(configs = ACTIVE_NEWZNAB_CONFIGS) {
  const newznabMap = buildPaidIndexerLimitMap(configs);
  const managerMap = buildManagerIndexerLimitMap();
  const combined = new Map(newznabMap);
  managerMap.forEach((limit, token) => {
    const existing = combined.get(token);
    if (!existing || limit < existing) {
      combined.set(token, limit);
    }
  });
  return combined;
}

function buildSearchLogPrefix({ manager = INDEXER_MANAGER, managerLabel = INDEXER_MANAGER_LABEL, newznabEnabled = NEWZNAB_ENABLED } = {}) {
  const managerSegment = manager === 'none'
    ? 'mgr=OFF'
    : `mgr=${managerLabel.toUpperCase()}`;
  const directSegment = newznabEnabled ? 'direct=ON' : 'direct=OFF';
  return `[SEARCH ${managerSegment} ${directSegment}]`;
}

INDEXER_LOG_PREFIX = buildSearchLogPrefix();

function isNewznabDebugEnabled() {
  return Boolean(DEBUG_NEWZNAB_SEARCH || DEBUG_NEWZNAB_TEST || DEBUG_NEWZNAB_ENDPOINTS);
}

function isNewznabEndpointLoggingEnabled() {
  return Boolean(DEBUG_NEWZNAB_ENDPOINTS);
}

function summarizeNewznabPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  return {
    type: plan.type || null,
    query: plan.rawQuery || plan.query || null,
    tokens: Array.isArray(plan.tokens) ? plan.tokens.filter(Boolean) : [],
  };
}

function logNewznabDebug(message, context = null) {
  if (!isNewznabDebugEnabled()) {
    return;
  }
  if (context && Object.keys(context).length > 0) {
    console.log(`${NEWZNAB_LOG_PREFIX}[DEBUG] ${message}`, context);
  } else {
    console.log(`${NEWZNAB_LOG_PREFIX}[DEBUG] ${message}`);
  }
}



function parseAllowedResolutionList(rawValue) {
  const entries = parseCommaList(rawValue);
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries
    .map((entry) => normalizeResolutionToken(entry))
    .filter(Boolean);
}

function parseResolutionLimitValue(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  const normalized = String(rawValue).trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function refreshPaidIndexerTokens() {
  const paidTokens = new Set();
  (TRIAGE_PRIORITY_INDEXERS || []).forEach((token) => {
    const normalized = normalizeIndexerToken(token);
    if (normalized) paidTokens.add(normalized);
  });
  getPaidDirectIndexerTokens(ACTIVE_NEWZNAB_CONFIGS).forEach((token) => {
    if (token) paidTokens.add(token);
  });
  PAID_INDEXER_TOKENS = paidTokens;
}

function isResultFromPaidIndexer(result) {
  if (!result || PAID_INDEXER_TOKENS.size === 0) return false;
  const tokens = [
    normalizeIndexerToken(result.indexerId || result.IndexerId),
    normalizeIndexerToken(result.indexer || result.Indexer),
  ].filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => PAID_INDEXER_TOKENS.has(token));
}

function dedupeResultsByTitle(results) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const buckets = new Map();
  const deduped = [];
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const normalizedTitle = normalizeReleaseTitle(result.title);
    const publishMeta = getPublishMetadataFromResult(result);
    if (publishMeta.publishDateMs && !result.publishDateMs) {
      result.publishDateMs = publishMeta.publishDateMs;
    }
    if (publishMeta.publishDateIso && !result.publishDateIso) {
      result.publishDateIso = publishMeta.publishDateIso;
    }
    if ((publishMeta.ageDays ?? null) !== null && (result.ageDays === undefined || result.ageDays === null)) {
      result.ageDays = publishMeta.ageDays;
    }
    if (!normalizedTitle) {
      deduped.push(result);
      continue;
    }
    let bucket = buckets.get(normalizedTitle);
    if (!bucket) {
      bucket = [];
      buckets.set(normalizedTitle, bucket);
    }
    const candidatePublish = publishMeta.publishDateMs ?? null;
    const candidateIsPaid = isResultFromPaidIndexer(result);
    let matchedEntry = null;
    for (const entry of bucket) {
      if (areReleasesWithinDays(entry.publishDateMs ?? null, candidatePublish ?? null, DEDUPE_MAX_PUBLISH_DIFF_DAYS)) {
        matchedEntry = entry;
        break;
      }
    }
    if (!matchedEntry) {
      const entry = {
        publishDateMs: candidatePublish,
        isPaid: candidateIsPaid,
        result,
        listIndex: deduped.length,
      };
      bucket.push(entry);
      deduped.push(result);
      continue;
    }

    if (candidateIsPaid && !matchedEntry.isPaid) {
      matchedEntry.isPaid = true;
      matchedEntry.publishDateMs = candidatePublish;
      matchedEntry.result = result;
      deduped[matchedEntry.listIndex] = result;
      continue;
    }

    if (candidateIsPaid === matchedEntry.isPaid) {
      const existingPublish = matchedEntry.publishDateMs;
      if (candidatePublish !== null && (existingPublish === null || candidatePublish > existingPublish)) {
        matchedEntry.publishDateMs = candidatePublish;
        matchedEntry.result = result;
        deduped[matchedEntry.listIndex] = result;
      }
      continue;
    }
    // If we reach here, existing is paid and candidate is not — skip candidate
  }
  return deduped;
}

function buildTriageNntpConfig() {
  const host = (process.env.NZB_TRIAGE_NNTP_HOST || '').trim();
  if (!host) return null;
  return {
    host,
    port: toPositiveInt(process.env.NZB_TRIAGE_NNTP_PORT, 119),
    user: (process.env.NZB_TRIAGE_NNTP_USER || '').trim() || undefined,
    pass: (process.env.NZB_TRIAGE_NNTP_PASS || '').trim() || undefined,
    useTLS: toBoolean(process.env.NZB_TRIAGE_NNTP_TLS, false),
  };
}

/**
 * Build NNTP servers array for native Stremio v5 streaming.
 * Format: nntps://{user}:{pass}@{host}:{port}/{connections}
 * or nntp:// for non-TLS connections
 */
function buildNntpServersArray() {
  const host = (process.env.NZB_TRIAGE_NNTP_HOST || '').trim();
  if (!host) return [];

  const port = toPositiveInt(process.env.NZB_TRIAGE_NNTP_PORT, 119);
  const user = (process.env.NZB_TRIAGE_NNTP_USER || '').trim();
  const pass = (process.env.NZB_TRIAGE_NNTP_PASS || '').trim();
  const useTLS = toBoolean(process.env.NZB_TRIAGE_NNTP_TLS, false);
  const connections = toPositiveInt(process.env.NZB_TRIAGE_NNTP_MAX_CONNECTIONS, 12);

  const protocol = useTLS ? 'nntps' : 'nntp';
  const auth = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  const serverUrl = `${protocol}://${auth}${host}:${port}/${connections}`;

  return [serverUrl];
}

let INDEXER_SORT_MODE = normalizeSortMode(process.env.NZB_SORT_MODE, 'quality_then_size');
let INDEXER_SORT_ORDER = parseCommaList(process.env.NZB_SORT_ORDER);
let INDEXER_PREFERRED_LANGUAGES = resolvePreferredLanguages(process.env.NZB_PREFERRED_LANGUAGE, []);
let INDEXER_PREFERRED_QUALITIES = parseCommaList(process.env.NZB_PREFERRED_QUALITIES);
let INDEXER_PREFERRED_ENCODES = parseCommaList(process.env.NZB_PREFERRED_ENCODES);
let INDEXER_PREFERRED_RELEASE_GROUPS = parseCommaList(process.env.NZB_PREFERRED_RELEASE_GROUPS);
let INDEXER_PREFERRED_VISUAL_TAGS = parseCommaList(process.env.NZB_PREFERRED_VISUAL_TAGS);
let INDEXER_PREFERRED_AUDIO_TAGS = parseCommaList(process.env.NZB_PREFERRED_AUDIO_TAGS);
let INDEXER_PREFERRED_KEYWORDS = parseCommaList(process.env.NZB_PREFERRED_KEYWORDS);
let INDEXER_DEDUP_ENABLED = toBoolean(process.env.NZB_DEDUP_ENABLED, true);
let INDEXER_HIDE_BLOCKED_RESULTS = toBoolean(process.env.NZB_HIDE_BLOCKED_RESULTS, false);
let INDEXER_MAX_RESULT_SIZE_BYTES = toSizeBytesFromGb(
  process.env.NZB_MAX_RESULT_SIZE_GB && process.env.NZB_MAX_RESULT_SIZE_GB !== ''
    ? process.env.NZB_MAX_RESULT_SIZE_GB
    : DEFAULT_MAX_RESULT_SIZE_GB
);
let ALLOWED_RESOLUTIONS = parseAllowedResolutionList(process.env.NZB_ALLOWED_RESOLUTIONS);
let RELEASE_EXCLUSIONS = parseCommaList(process.env.NZB_RELEASE_EXCLUSIONS);
let NZB_NAMING_PATTERN = process.env.NZB_NAMING_PATTERN || '';
let NZB_DISPLAY_NAME_PATTERN = process.env.NZB_DISPLAY_NAME_PATTERN || '';
let RESOLUTION_LIMIT_PER_QUALITY = parseResolutionLimitValue(process.env.NZB_RESOLUTION_LIMIT_PER_QUALITY);
let TRIAGE_ENABLED = toBoolean(process.env.NZB_TRIAGE_ENABLED, false);
let TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 35000);
let TRIAGE_MAX_CANDIDATES = toPositiveInt(process.env.NZB_TRIAGE_MAX_CANDIDATES, 25);
let TRIAGE_DOWNLOAD_CONCURRENCY = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_CONCURRENCY, 8);
let TRIAGE_PRIORITY_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXERS);
let TRIAGE_PRIORITY_INDEXER_LIMITS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXER_LIMITS);
let TRIAGE_HEALTH_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_HEALTH_INDEXERS);
let TRIAGE_SERIALIZED_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_SERIALIZED_INDEXERS);
let TRIAGE_NNTP_CONFIG = buildTriageNntpConfig();
let TRIAGE_MAX_DECODED_BYTES = toPositiveInt(process.env.NZB_TRIAGE_MAX_DECODED_BYTES, 32 * 1024);
let TRIAGE_NNTP_MAX_CONNECTIONS = toPositiveInt(process.env.NZB_TRIAGE_MAX_CONNECTIONS, 12);
let TRIAGE_MAX_PARALLEL_NZBS = toPositiveInt(process.env.NZB_TRIAGE_MAX_PARALLEL_NZBS, 16);
let TRIAGE_STAT_SAMPLE_COUNT = 0;
let TRIAGE_ARCHIVE_SAMPLE_COUNT = 1;
let TRIAGE_REUSE_POOL = toBoolean(process.env.NZB_TRIAGE_REUSE_POOL, true);
let TRIAGE_NNTP_KEEP_ALIVE_MS = toPositiveInt(process.env.NZB_TRIAGE_NNTP_KEEP_ALIVE_MS, 0);
let TRIAGE_PREFETCH_FIRST_VERIFIED = toBoolean(process.env.NZB_TRIAGE_PREFETCH_FIRST_VERIFIED, true);

let TRIAGE_BASE_OPTIONS = {
  maxDecodedBytes: TRIAGE_MAX_DECODED_BYTES,
  nntpMaxConnections: TRIAGE_NNTP_MAX_CONNECTIONS,
  maxParallelNzbs: TRIAGE_MAX_PARALLEL_NZBS,
  statSampleCount: TRIAGE_STAT_SAMPLE_COUNT,
  archiveSampleCount: TRIAGE_ARCHIVE_SAMPLE_COUNT,
  reuseNntpPool: TRIAGE_REUSE_POOL,
  nntpKeepAliveMs: TRIAGE_NNTP_KEEP_ALIVE_MS,
  healthCheckTimeoutMs: TRIAGE_TIME_BUDGET_MS,
};
let sharedPoolMonitorTimer = null;

function buildSharedPoolOptions() {
  if (!TRIAGE_NNTP_CONFIG) return null;
  return {
    nntpConfig: { ...TRIAGE_NNTP_CONFIG },
    nntpMaxConnections: TRIAGE_NNTP_MAX_CONNECTIONS,
    reuseNntpPool: TRIAGE_REUSE_POOL,
    nntpKeepAliveMs: TRIAGE_NNTP_KEEP_ALIVE_MS,
  };
}

const MAX_NEWZNAB_INDEXERS = newznabService.MAX_NEWZNAB_INDEXERS;
const NEWZNAB_NUMBERED_KEYS = newznabService.NEWZNAB_NUMBERED_KEYS;

function maybePrewarmSharedNntpPool() {
  if (!TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
    return;
  }
  const options = buildSharedPoolOptions();
  if (!options) return;
  preWarmNntpPool(options)
    .then(() => {
      console.log('[NZB TRIAGE] Pre-warmed NNTP pool with shared configuration');
    })
    .catch((err) => {
      console.warn('[NZB TRIAGE] Unable to pre-warm NNTP pool', err?.message || err);
    });
}

function triggerRequestTriagePrewarm(reason = 'request') {
  if (!TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
    return null;
  }
  const options = buildSharedPoolOptions();
  if (!options) return null;
  return preWarmNntpPool(options).catch((err) => {
    console.warn(`[NZB TRIAGE] Unable to pre-warm NNTP pool (${reason})`, err?.message || err);
  });
}

function restartSharedPoolMonitor() {
  if (sharedPoolMonitorTimer) {
    clearInterval(sharedPoolMonitorTimer);
    sharedPoolMonitorTimer = null;
  }
  if (!TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
    return;
  }
  const intervalMs = Math.max(30000, TRIAGE_NNTP_KEEP_ALIVE_MS || 120000);
  sharedPoolMonitorTimer = setInterval(() => {
    evictStaleSharedNntpPool().catch((err) => {
      console.warn('[NZB TRIAGE] Failed to evict stale NNTP pool', err?.message || err);
    });
  }, intervalMs);
  if (typeof sharedPoolMonitorTimer.unref === 'function') {
    sharedPoolMonitorTimer.unref();
  }
}

function rebuildRuntimeConfig({ log = true } = {}) {
  const previousPort = currentPort;
  currentPort = Number(process.env.PORT || 7000);
  const previousBaseUrl = ADDON_BASE_URL;
  const previousSharedSecret = ADDON_SHARED_SECRET;

  // Streaming mode: 'nzbdav' (default) or 'native' (Windows Stremio v5 only)
  STREAMING_MODE = (process.env.STREAMING_MODE || 'nzbdav').trim().toLowerCase();
  if (!['nzbdav', 'native'].includes(STREAMING_MODE)) STREAMING_MODE = 'nzbdav';

  ADDON_BASE_URL = (process.env.ADDON_BASE_URL || '').trim();
  ADDON_SHARED_SECRET = (process.env.ADDON_SHARED_SECRET || '').trim();
  ADDON_NAME = (process.env.ADDON_NAME || DEFAULT_ADDON_NAME).trim() || DEFAULT_ADDON_NAME;

  INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'none').trim().toLowerCase();
  // Force newznab-only in native streaming mode
  if (STREAMING_MODE === 'native') INDEXER_MANAGER = 'none';
  INDEXER_MANAGER_URL = (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || '').trim();
  INDEXER_MANAGER_API_KEY = (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || '').trim();
  INDEXER_MANAGER_LABEL = INDEXER_MANAGER === 'nzbhydra'
    ? 'NZBHydra'
    : INDEXER_MANAGER === 'none'
      ? 'Disabled'
      : 'Prowlarr';
  INDEXER_MANAGER_STRICT_ID_MATCH = toBoolean(process.env.INDEXER_MANAGER_STRICT_ID_MATCH || process.env.PROWLARR_STRICT_ID_MATCH, false);
  INDEXER_MANAGER_INDEXERS = (() => {
    const raw = process.env.INDEXER_MANAGER_INDEXERS || process.env.PROWLARR_INDEXERS || '';
    if (!raw.trim()) return null;
    if (raw.trim() === '-1') return -1;
    return parseCommaList(raw);
  })();
  INDEXER_MANAGER_CACHE_MINUTES = (() => {
    const raw = Number(process.env.INDEXER_MANAGER_CACHE_MINUTES || process.env.NZBHYDRA_CACHE_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? raw : (INDEXER_MANAGER === 'nzbhydra' ? 10 : null);
  })();
  INDEXER_MANAGER_BASE_URL = INDEXER_MANAGER_URL.replace(/\/+$/, '');
  INDEXER_MANAGER_BACKOFF_ENABLED = toBoolean(process.env.INDEXER_MANAGER_BACKOFF_ENABLED, true);
  INDEXER_MANAGER_BACKOFF_SECONDS = toPositiveInt(process.env.INDEXER_MANAGER_BACKOFF_SECONDS, 120);
  NZBDAV_HISTORY_CATALOG_LIMIT = (() => {
    const raw = toFiniteNumber(process.env.NZBDAV_HISTORY_CATALOG_LIMIT, 100);
    if (!Number.isFinite(raw) || raw < 0) return 100;
    return Math.floor(raw);
  })();
  indexerManagerUnavailableUntil = 0;

  NEWZNAB_ENABLED = toBoolean(process.env.NEWZNAB_ENABLED, false);
  NEWZNAB_FILTER_NZB_ONLY = toBoolean(process.env.NEWZNAB_FILTER_NZB_ONLY, true);
  DEBUG_NEWZNAB_SEARCH = toBoolean(process.env.DEBUG_NEWZNAB_SEARCH, false);
  DEBUG_NEWZNAB_TEST = toBoolean(process.env.DEBUG_NEWZNAB_TEST, false);
  DEBUG_NEWZNAB_ENDPOINTS = toBoolean(process.env.DEBUG_NEWZNAB_ENDPOINTS, false);
  NEWZNAB_CONFIGS = newznabService.getEnvNewznabConfigs({ includeEmpty: false });
  ACTIVE_NEWZNAB_CONFIGS = newznabService.filterUsableConfigs(NEWZNAB_CONFIGS, { requireEnabled: true, requireApiKey: true });
  INDEXER_LOG_PREFIX = buildSearchLogPrefix({
    manager: INDEXER_MANAGER,
    managerLabel: INDEXER_MANAGER_LABEL,
    newznabEnabled: NEWZNAB_ENABLED,
  });

  INDEXER_SORT_MODE = normalizeSortMode(process.env.NZB_SORT_MODE, 'quality_then_size');
  INDEXER_SORT_ORDER = parseCommaList(process.env.NZB_SORT_ORDER);
  INDEXER_PREFERRED_LANGUAGES = resolvePreferredLanguages(process.env.NZB_PREFERRED_LANGUAGE, []);
  INDEXER_PREFERRED_QUALITIES = parseCommaList(process.env.NZB_PREFERRED_QUALITIES);
  INDEXER_PREFERRED_ENCODES = parseCommaList(process.env.NZB_PREFERRED_ENCODES);
  INDEXER_PREFERRED_RELEASE_GROUPS = parseCommaList(process.env.NZB_PREFERRED_RELEASE_GROUPS);
  INDEXER_PREFERRED_VISUAL_TAGS = parseCommaList(process.env.NZB_PREFERRED_VISUAL_TAGS);
  INDEXER_PREFERRED_AUDIO_TAGS = parseCommaList(process.env.NZB_PREFERRED_AUDIO_TAGS);
  INDEXER_PREFERRED_KEYWORDS = parseCommaList(process.env.NZB_PREFERRED_KEYWORDS);
  INDEXER_DEDUP_ENABLED = toBoolean(process.env.NZB_DEDUP_ENABLED, true);
  INDEXER_HIDE_BLOCKED_RESULTS = toBoolean(process.env.NZB_HIDE_BLOCKED_RESULTS, false);
  INDEXER_MAX_RESULT_SIZE_BYTES = toSizeBytesFromGb(
    process.env.NZB_MAX_RESULT_SIZE_GB && process.env.NZB_MAX_RESULT_SIZE_GB !== ''
      ? process.env.NZB_MAX_RESULT_SIZE_GB
      : DEFAULT_MAX_RESULT_SIZE_GB
  );
  ALLOWED_RESOLUTIONS = parseAllowedResolutionList(process.env.NZB_ALLOWED_RESOLUTIONS);
  RELEASE_EXCLUSIONS = parseCommaList(process.env.NZB_RELEASE_EXCLUSIONS);
  NZB_NAMING_PATTERN = process.env.NZB_NAMING_PATTERN || '';
  NZB_DISPLAY_NAME_PATTERN = process.env.NZB_DISPLAY_NAME_PATTERN || '';
  RESOLUTION_LIMIT_PER_QUALITY = parseResolutionLimitValue(process.env.NZB_RESOLUTION_LIMIT_PER_QUALITY);

  TRIAGE_ENABLED = toBoolean(process.env.NZB_TRIAGE_ENABLED, false);
  TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 35000);
  TRIAGE_MAX_CANDIDATES = toPositiveInt(process.env.NZB_TRIAGE_MAX_CANDIDATES, 25);
  TRIAGE_DOWNLOAD_CONCURRENCY = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_CONCURRENCY, 8);
  TRIAGE_PRIORITY_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXERS);
  TRIAGE_PRIORITY_INDEXER_LIMITS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXER_LIMITS);
  TRIAGE_HEALTH_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_HEALTH_INDEXERS);
  TRIAGE_SERIALIZED_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_SERIALIZED_INDEXERS);
  refreshPaidIndexerTokens();
  TRIAGE_NNTP_CONFIG = buildTriageNntpConfig();
  TRIAGE_MAX_DECODED_BYTES = toPositiveInt(process.env.NZB_TRIAGE_MAX_DECODED_BYTES, 32 * 1024);
  TRIAGE_NNTP_MAX_CONNECTIONS = toPositiveInt(process.env.NZB_TRIAGE_MAX_CONNECTIONS, 60);
  TRIAGE_MAX_PARALLEL_NZBS = toPositiveInt(process.env.NZB_TRIAGE_MAX_PARALLEL_NZBS, 16);
  TRIAGE_REUSE_POOL = toBoolean(process.env.NZB_TRIAGE_REUSE_POOL, true);
  TRIAGE_NNTP_KEEP_ALIVE_MS = toPositiveInt(process.env.NZB_TRIAGE_NNTP_KEEP_ALIVE_MS, 0);
  TRIAGE_BASE_OPTIONS = {
    maxDecodedBytes: TRIAGE_MAX_DECODED_BYTES,
    nntpMaxConnections: TRIAGE_NNTP_MAX_CONNECTIONS,
    maxParallelNzbs: TRIAGE_MAX_PARALLEL_NZBS,
    statSampleCount: TRIAGE_STAT_SAMPLE_COUNT,
    archiveSampleCount: TRIAGE_ARCHIVE_SAMPLE_COUNT,
    reuseNntpPool: TRIAGE_REUSE_POOL,
    nntpKeepAliveMs: TRIAGE_NNTP_KEEP_ALIVE_MS,
    healthCheckTimeoutMs: TRIAGE_TIME_BUDGET_MS,
  };

  maybePrewarmSharedNntpPool();
  restartSharedPoolMonitor();
  const resolvedAddonBase = ADDON_BASE_URL || `http://${SERVER_HOST}:${currentPort}`;
  easynewsService.reloadConfig({ addonBaseUrl: resolvedAddonBase, sharedSecret: ADDON_SHARED_SECRET });

  const portChanged = previousPort !== undefined && previousPort !== currentPort;
  if (log) {
    console.log('[CONFIG] Runtime configuration refreshed', {
      port: currentPort,
      portChanged,
      baseUrlChanged: previousBaseUrl !== undefined && previousBaseUrl !== ADDON_BASE_URL,
      sharedSecretChanged: previousSharedSecret !== undefined && previousSharedSecret !== ADDON_SHARED_SECRET,
      addonName: ADDON_NAME,
      indexerManager: INDEXER_MANAGER,
      newznabEnabled: NEWZNAB_ENABLED,
      triageEnabled: TRIAGE_ENABLED,
      allowedResolutions: ALLOWED_RESOLUTIONS,
      resolutionLimitPerQuality: RESOLUTION_LIMIT_PER_QUALITY,
    });
  }

  return { portChanged };
}

rebuildRuntimeConfig({ log: false });

const ADMIN_CONFIG_KEYS = [
  'PORT',
  'STREAMING_MODE',
  'ADDON_BASE_URL',
  'ADDON_NAME',
  'ADDON_SHARED_SECRET',
  'INDEXER_MANAGER',
  'INDEXER_MANAGER_URL',
  'INDEXER_MANAGER_API_KEY',
  'INDEXER_MANAGER_STRICT_ID_MATCH',
  'INDEXER_MANAGER_INDEXERS',
  'INDEXER_MANAGER_CACHE_MINUTES',
  'NZB_SORT_MODE',
  'NZB_SORT_ORDER',
  'NZB_PREFERRED_LANGUAGE',
  'NZB_PREFERRED_QUALITIES',
  'NZB_PREFERRED_ENCODES',
  'NZB_PREFERRED_RELEASE_GROUPS',
  'NZB_PREFERRED_VISUAL_TAGS',
  'NZB_PREFERRED_AUDIO_TAGS',
  'NZB_PREFERRED_KEYWORDS',
  'NZB_MAX_RESULT_SIZE_GB',
  'NZB_DEDUP_ENABLED',
  'NZB_HIDE_BLOCKED_RESULTS',
  'NZB_ALLOWED_RESOLUTIONS',
  'NZB_RESOLUTION_LIMIT_PER_QUALITY',
  'NZB_RELEASE_EXCLUSIONS',
  'NZB_NAMING_PATTERN',
  'NZB_DISPLAY_NAME_PATTERN',
  'NZBDAV_URL',
  'NZBDAV_API_KEY',
  'NZBDAV_WEBDAV_URL',
  'NZBDAV_WEBDAV_USER',
  'NZBDAV_WEBDAV_PASS',
  'NZBDAV_CATEGORY',
  'NZBDAV_CATEGORY_MOVIES',
  'NZBDAV_CATEGORY_SERIES',
  'NZBDAV_HISTORY_CATALOG_LIMIT',
  'NZB_TRIAGE_HEALTH_INDEXERS',
  'SPECIAL_PROVIDER_ID',
  'SPECIAL_PROVIDER_URL',
  'SPECIAL_PROVIDER_SECRET',
  'NZB_TRIAGE_ENABLED',
  'NZB_TRIAGE_TIME_BUDGET_MS',
  'NZB_TRIAGE_MAX_CANDIDATES',
  'NZB_TRIAGE_PRIORITY_INDEXERS',
  'NZB_TRIAGE_PRIORITY_INDEXER_LIMITS',
  'NZB_TRIAGE_SERIALIZED_INDEXERS',
  'NZB_TRIAGE_DOWNLOAD_CONCURRENCY',
  'NZB_TRIAGE_MAX_CONNECTIONS',
  'NZB_TRIAGE_PREFETCH_FIRST_VERIFIED',
  'NZB_TRIAGE_MAX_PARALLEL_NZBS',
  'NZB_TRIAGE_STAT_SAMPLE_COUNT',
  'NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT',
  'NZB_TRIAGE_MAX_DECODED_BYTES',
  'NZB_TRIAGE_NNTP_HOST',
  'NZB_TRIAGE_NNTP_PORT',
  'NZB_TRIAGE_NNTP_TLS',
  'NZB_TRIAGE_NNTP_USER',
  'NZB_TRIAGE_NNTP_PASS',
  'NZB_TRIAGE_REUSE_POOL',
  'NZB_TRIAGE_NNTP_KEEP_ALIVE_MS',
  'EASYNEWS_ENABLED',
  'EASYNEWS_USERNAME',
  'EASYNEWS_PASSWORD',
  'EASYNEWS_TREAT_AS_INDEXER',
  'TMDB_ENABLED',
  'TMDB_API_KEY',
  'TMDB_SEARCH_LANGUAGES',
  'TMDB_SEARCH_MODE',
  'TVDB_ENABLED',
  'TVDB_API_KEY',
];

ADMIN_CONFIG_KEYS.push('NEWZNAB_ENABLED', 'NEWZNAB_FILTER_NZB_ONLY', ...NEWZNAB_NUMBERED_KEYS);

function extractTriageOverrides(query) {
  if (!query || typeof query !== 'object') return {};
  const sizeCandidate = query.maxSizeGb ?? query.max_size_gb ?? query.triageSizeGb ?? query.triage_size_gb ?? query.preferredSizeGb;
  const sizeGb = toFiniteNumber(sizeCandidate, null);
  const maxSizeBytes = Number.isFinite(sizeGb) && sizeGb > 0 ? sizeGb * 1024 * 1024 * 1024 : null;
  let indexerSource = null;
  if (typeof query.triageIndexerIds === 'string') indexerSource = query.triageIndexerIds;
  else if (Array.isArray(query.triageIndexerIds)) indexerSource = query.triageIndexerIds.join(',');
  const indexers = indexerSource ? parseCommaList(indexerSource) : null;
  const disabled = query.triageDisabled !== undefined ? toBoolean(query.triageDisabled, true) : null;
  const enabled = query.triageEnabled !== undefined ? toBoolean(query.triageEnabled, false) : null;
  const sortMode = typeof query.sortMode === 'string' ? query.sortMode : query.nzbSortMode;
  const preferredLanguageInput = query.preferredLanguages ?? query.preferredLanguage ?? query.language ?? query.lang;
  let dedupeOverride = null;
  if (query.dedupe !== undefined) {
    dedupeOverride = toBoolean(query.dedupe, true);
  } else if (query.dedupeEnabled !== undefined) {
    dedupeOverride = toBoolean(query.dedupeEnabled, true);
  } else if (query.dedupeDisabled !== undefined) {
    dedupeOverride = !toBoolean(query.dedupeDisabled, false);
  }
  return {
    maxSizeBytes,
    indexers,
    disabled,
    enabled,
    sortMode: typeof sortMode === 'string' ? sortMode : null,
    preferredLanguages: typeof preferredLanguageInput === 'string' ? preferredLanguageInput : null,
    dedupeEnabled: dedupeOverride,
  };
}

function executeManagerPlanWithBackoff(plan) {
  if (INDEXER_MANAGER === 'none') {
    return Promise.resolve({ results: [] });
  }
  if (INDEXER_MANAGER_BACKOFF_ENABLED && indexerManagerUnavailableUntil > Date.now()) {
    const remaining = Math.ceil((indexerManagerUnavailableUntil - Date.now()) / 1000);
    console.warn(`${INDEXER_LOG_PREFIX} Skipping manager search during backoff (${remaining}s remaining)`);
    return Promise.resolve({ results: [], errors: [`manager backoff (${remaining}s remaining)`] });
  }
  return indexerService.executeIndexerPlan(plan)
    .then((data) => ({ results: Array.isArray(data) ? data : [] }))
    .catch((error) => {
      if (INDEXER_MANAGER_BACKOFF_ENABLED) {
        indexerManagerUnavailableUntil = Date.now() + (INDEXER_MANAGER_BACKOFF_SECONDS * 1000);
        console.warn(`${INDEXER_LOG_PREFIX} Manager search failed; backing off for ${INDEXER_MANAGER_BACKOFF_SECONDS}s`, error?.message || error);
      }
      throw error;
    });
}

function executeNewznabPlan(plan) {
  const debugEnabled = isNewznabDebugEnabled();
  const endpointLogEnabled = isNewznabEndpointLoggingEnabled();
  const planSummary = summarizeNewznabPlan(plan);
  if (!NEWZNAB_ENABLED || ACTIVE_NEWZNAB_CONFIGS.length === 0) {
    logNewznabDebug('Skipping search plan because direct Newznab is disabled or no configs are available', {
      enabled: NEWZNAB_ENABLED,
      activeConfigs: ACTIVE_NEWZNAB_CONFIGS.length,
      plan: planSummary,
    });
    return Promise.resolve({ results: [], errors: [], endpoints: [] });
  }

  if (debugEnabled) {
    logNewznabDebug('Dispatching search plan', {
      plan: planSummary,
      indexers: ACTIVE_NEWZNAB_CONFIGS.map((config) => ({
        id: config.id,
        name: config.displayName || config.endpoint,
        endpoint: config.endpoint,
      })),
      filterNzbOnly: NEWZNAB_FILTER_NZB_ONLY,
    });
  }

  return newznabService.searchNewznabIndexers(plan, ACTIVE_NEWZNAB_CONFIGS, {
    filterNzbOnly: NEWZNAB_FILTER_NZB_ONLY,
    debug: debugEnabled,
    logEndpoints: endpointLogEnabled,
    label: NEWZNAB_LOG_PREFIX,
  }).then((result) => {
    logNewznabDebug('Search plan completed', {
      plan: planSummary,
      totalResults: Array.isArray(result?.results) ? result.results.length : 0,
      endpoints: result?.endpoints || [],
      errors: result?.errors || [],
    });
    return result;
  }).catch((error) => {
    logNewznabDebug('Search plan failed', {
      plan: planSummary,
      error: error?.message || error,
    });
    throw error;
  });
}

// Configure NZBDav
const NZBDAV_URL = (process.env.NZBDAV_URL || '').trim();
const NZBDAV_API_KEY = (process.env.NZBDAV_API_KEY || '').trim();
const NZBDAV_CATEGORY_MOVIES = process.env.NZBDAV_CATEGORY_MOVIES || 'Movies';
const NZBDAV_CATEGORY_SERIES = process.env.NZBDAV_CATEGORY_SERIES || 'Tv';
const NZBDAV_CATEGORY_DEFAULT = process.env.NZBDAV_CATEGORY_DEFAULT || 'Movies';
const NZBDAV_CATEGORY_OVERRIDE = (process.env.NZBDAV_CATEGORY || '').trim();
const NZBDAV_POLL_INTERVAL_MS = 2000;
const NZBDAV_POLL_TIMEOUT_MS = 80000;
const NZBDAV_HISTORY_FETCH_LIMIT = (() => {
  const raw = Number(process.env.NZBDAV_HISTORY_FETCH_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 400;
})();
const NZBDAV_CACHE_TTL_MINUTES = (() => {
  const raw = Number(process.env.NZBDAV_CACHE_TTL_MINUTES);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (raw === 0) {
    return 0;
  }
  return 1440; // default 24 hours
})();
const NZBDAV_CACHE_TTL_MS = NZBDAV_CACHE_TTL_MINUTES > 0 ? NZBDAV_CACHE_TTL_MINUTES * 60 * 1000 : 0;
const NZBDAV_MAX_DIRECTORY_DEPTH = 6;
const NZBDAV_WEBDAV_USER = (process.env.NZBDAV_WEBDAV_USER || '').trim();
const NZBDAV_WEBDAV_PASS = (process.env.NZBDAV_WEBDAV_PASS || '').trim();
const NZBDAV_WEBDAV_ROOT = '/';
const NZBDAV_WEBDAV_URL = (process.env.NZBDAV_WEBDAV_URL || NZBDAV_URL).trim();
const NZBDAV_API_TIMEOUT_MS = 80000;
const NZBDAV_HISTORY_TIMEOUT_MS = 60000;
const NZBDAV_STREAM_TIMEOUT_MS = 240000;
const FAILURE_VIDEO_FILENAME = 'failure_video.mp4';
const FAILURE_VIDEO_PATH = path.resolve(__dirname, 'assets', FAILURE_VIDEO_FILENAME);
const STREAM_HIGH_WATER_MARK = (() => {
  const parsed = Number(process.env.STREAM_HIGH_WATER_MARK);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4 * 1024 * 1024;
})();

const STREAM_CACHE_MAX_ENTRIES = 1000; // Max entries in stream response cache

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';
const pipelineAsync = promisify(pipeline);
const posixPath = path.posix;

// Base64url helpers for clean stream URLs (no query params)
function encodeStreamParams(params) {
  const json = JSON.stringify(Object.fromEntries(params.entries()));
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeStreamParams(encoded) {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function buildStreamCacheKey({ type, id, query = {}, requestedEpisode = null }) {
  const normalizedQuery = {};
  Object.keys(query)
    .sort()
    .forEach((key) => {
      normalizedQuery[key] = query[key];
    });
  const normalizedEpisode = requestedEpisode
    ? {
      season: Number.isFinite(requestedEpisode.season) ? requestedEpisode.season : null,
      episode: Number.isFinite(requestedEpisode.episode) ? requestedEpisode.episode : null,
    }
    : null;
  return JSON.stringify({ type, id, requestedEpisode: normalizedEpisode, query: normalizedQuery });
}

function restoreTriageDecisions(snapshot) {
  const map = new Map();
  if (!Array.isArray(snapshot)) return map;
  snapshot.forEach(([downloadUrl, decision]) => {
    if (!downloadUrl || !decision) return;
    map.set(downloadUrl, { ...decision });
  });
  return map;
}

const NZBDAV_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.ts',
  '.m2ts',
  '.mpg',
  '.mpeg'
]);
const NZBDAV_SUPPORTED_METHODS = new Set(['GET', 'HEAD']);
const VIDEO_MIME_MAP = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mov', 'video/quicktime'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t'],
  ['.m2ts', 'video/mp2t'],
  ['.mpg', 'video/mpeg'],
  ['.mpeg', 'video/mpeg']
]);

function sanitizeStrictSearchPhrase(text) {
  if (!text) return '';
  return text
    .replace(/&/g, ' and ')
    .replace(/[\.\-_:\s]+/g, ' ')
    .replace(/[^\w\sÀ-ÿ]/g, '')
    .toLowerCase()
    .trim();
}

function matchesStrictSearch(title, strictPhrase) {
  if (!strictPhrase) return true;
  const candidate = sanitizeStrictSearchPhrase(title);
  if (!candidate) return false;
  if (candidate === strictPhrase) return true;
  const candidateTokens = candidate.split(' ').filter(Boolean);
  const phraseTokens = strictPhrase.split(' ').filter(Boolean);
  if (phraseTokens.length === 0) return true;

  // Nothing before first query token, nothing after last query token, gaps allowed in between
  if (candidateTokens[0] !== phraseTokens[0]) return false;
  if (candidateTokens[candidateTokens.length - 1] !== phraseTokens[phraseTokens.length - 1]) return false;
  // Remaining tokens must appear in order, gaps allowed
  let candidateIdx = 1;
  for (let i = 1; i < phraseTokens.length; i += 1) {
    const token = phraseTokens[i];
    let found = false;
    while (candidateIdx < candidateTokens.length) {
      if (candidateTokens[candidateIdx] === token) {
        found = true;
        candidateIdx += 1;
        break;
      }
      candidateIdx += 1;
    }
    if (!found) return false;
  }
  return true;
}

function ensureAddonConfigured() {
  if (!ADDON_BASE_URL) {
    throw new Error('ADDON_BASE_URL is not configured');
  }
}

// Manifest endpoint
function manifestHandler(req, res) {
  ensureAddonConfigured();

  const description = STREAMING_MODE === 'native'
    ? 'Native Usenet streaming for Stremio v5 (Windows) - NZB sources via direct Newznab indexers'
    : 'Usenet-powered instant streams for Stremio via Prowlarr/NZBHydra and NZBDav';

  const catalogs = [];
  const resources = ['stream'];
  const idPrefixes = ['tt', 'tvdb', 'tmdb', 'pt', specialMetadata.SPECIAL_ID_PREFIX];
  if (STREAMING_MODE !== 'native' && NZBDAV_HISTORY_CATALOG_LIMIT > 0) {
    const catalogName = ADDON_NAME || DEFAULT_ADDON_NAME;
    catalogs.push(
      { type: 'movie', id: 'nzbdav_completed', name: catalogName, pageSize: 20, extra: [{ name: 'skip' }] },
      { type: 'series', id: 'nzbdav_completed', name: catalogName, pageSize: 20, extra: [{ name: 'skip' }] }
    );
    resources.push('catalog', 'meta');
    idPrefixes.push('nzbdav');
  }

  res.json({
    id: STREAMING_MODE === 'native' ? 'com.usenet.streamer.native' : 'com.usenet.streamer',
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description,
    logo: `${ADDON_BASE_URL.replace(/\/$/, '')}/assets/icon.png`,
    resources,
    types: ['movie', 'series', 'channel', 'tv'],
    catalogs,
    idPrefixes
  });
}

['/manifest.json', '/:token/manifest.json'].forEach((route) => {
  app.get(route, manifestHandler);
});

async function catalogHandler(req, res) {
  if (STREAMING_MODE === 'native' || NZBDAV_HISTORY_CATALOG_LIMIT <= 0) {
    res.status(404).json({ metas: [] });
    return;
  }

  const { type, id } = req.params;
  if (id !== 'nzbdav_completed') {
    res.status(404).json({ metas: [] });
    return;
  }

  try {
    nzbdavService.ensureNzbdavConfigured();
  } catch (error) {
    res.status(500).json({ metas: [], error: error.message });
    return;
  }

  const skip = Math.max(0, parseInt(req.query.skip || '0', 10) || 0);
  const limit = Math.max(0, Math.min(200, NZBDAV_HISTORY_CATALOG_LIMIT));
  if (limit === 0) {
    res.json({ metas: [] });
    return;
  }

  const categoryForType = nzbdavService.getNzbdavCategory(type);
  const historyMap = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType], limit + skip);
  const entries = Array.from(historyMap.values());
  const slice = entries.slice(skip, skip + limit);
  const poster = `${ADDON_BASE_URL.replace(/\/$/, '')}/assets/icon.png`;

  const metas = slice.map((entry) => {
    const name = entry.jobName || 'NZBDav Completed';
    return {
      id: `nzbdav:${entry.nzoId}`,
      type,
      name,
      poster,
    };
  });

  res.json({ metas });
}

['/catalog/:type/:id.json', '/:token/catalog/:type/:id.json'].forEach((route) => {
  app.get(route, catalogHandler);
});

async function metaHandler(req, res) {
  if (STREAMING_MODE === 'native' || NZBDAV_HISTORY_CATALOG_LIMIT <= 0) {
    res.status(404).json({ meta: null });
    return;
  }
  const { type, id } = req.params;
  if (!id || !id.startsWith('nzbdav:')) {
    res.status(404).json({ meta: null });
    return;
  }

  try {
    nzbdavService.ensureNzbdavConfigured();
  } catch (error) {
    res.status(500).json({ meta: null, error: error.message });
    return;
  }

  const nzoId = id.slice('nzbdav:'.length).trim();
  if (!nzoId) {
    res.status(404).json({ meta: null });
    return;
  }

  const categoryForType = nzbdavService.getNzbdavCategory(type);
  const historyMap = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType], Math.max(50, NZBDAV_HISTORY_CATALOG_LIMIT));
  const match = Array.from(historyMap.values()).find((entry) => String(entry.nzoId) === String(nzoId));
  if (!match) {
    res.status(404).json({ meta: null });
    return;
  }

  const poster = `${ADDON_BASE_URL.replace(/\/$/, '')}/assets/icon.png`;
  res.json({
    meta: {
      id: `nzbdav:${match.nzoId}`,
      type,
      name: match.jobName || 'NZBDav Completed',
      poster,
    }
  });
}

['/meta/:type/:id.json', '/:token/meta/:type/:id.json'].forEach((route) => {
  app.get(route, metaHandler);
});

async function streamHandler(req, res) {
  const requestStartTs = Date.now();
  const { type, id } = req.params;
  console.log(`[REQUEST] Received request for ${type} ID: ${id}`, { ts: new Date(requestStartTs).toISOString() });
  let triagePrewarmPromise = null;

  const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, '');

  let baseIdentifier = id;
  if (type === 'series' && typeof id === 'string') {
    const parts = id.split(':');
    if (parts.length >= 3) {
      const potentialEpisode = Number.parseInt(parts[parts.length - 1], 10);
      const potentialSeason = Number.parseInt(parts[parts.length - 2], 10);
      if (Number.isFinite(potentialSeason) && Number.isFinite(potentialEpisode)) {
        baseIdentifier = parts.slice(0, parts.length - 2).join(':');
      }
    }
  }

  let incomingImdbId = null;
  let incomingTvdbId = null;
  let incomingSpecialId = null;
  let incomingTmdbId = null;
  let incomingNzbdavId = null;

  if (/^tt\d+$/i.test(baseIdentifier)) {
    incomingImdbId = baseIdentifier.startsWith('tt') ? baseIdentifier : `tt${baseIdentifier}`;
    baseIdentifier = incomingImdbId;
  } else if (/^tmdb:/i.test(baseIdentifier)) {
    const tmdbMatch = baseIdentifier.match(/^tmdb:([0-9]+)(?::.*)?$/i);
    if (tmdbMatch) {
      incomingTmdbId = tmdbMatch[1];
      baseIdentifier = `tmdb:${incomingTmdbId}`;
    }
  } else if (/^tvdb:/i.test(baseIdentifier)) {
    const tvdbMatch = baseIdentifier.match(/^tvdb:([0-9]+)(?::.*)?$/i);
    if (tvdbMatch) {
      incomingTvdbId = tvdbMatch[1];
      baseIdentifier = `tvdb:${incomingTvdbId}`;
    }
  } else {
    const lowerIdentifier = baseIdentifier.toLowerCase();
    for (const prefix of specialMetadata.specialCatalogPrefixes) {
      const normalizedPrefix = prefix.toLowerCase();
      if (lowerIdentifier.startsWith(`${normalizedPrefix}:`)) {
        const remainder = baseIdentifier.slice(prefix.length + 1);
        if (remainder) {
          incomingSpecialId = remainder;
          baseIdentifier = `${prefix}:${remainder}`;
        }
        break;
      }
    }
    if (!incomingSpecialId && lowerIdentifier.startsWith('nzbdav:')) {
      const remainder = baseIdentifier.slice('nzbdav:'.length);
      if (remainder) {
        incomingNzbdavId = remainder.trim();
        baseIdentifier = `nzbdav:${incomingNzbdavId}`;
      }
    }
  }

  const isSpecialRequest = Boolean(incomingSpecialId);
  const isNzbdavRequest = Boolean(incomingNzbdavId);
  const requestLacksIdentifiers = !incomingImdbId && !incomingTvdbId && !incomingTmdbId && !isSpecialRequest && !isNzbdavRequest;

  if (requestLacksIdentifiers && !isSpecialRequest) {
    res.status(400).json({ error: `Unsupported ID prefix for indexer manager search: ${baseIdentifier}` });
    return;
  }

  try {
    ensureAddonConfigured();
    if (INDEXER_MANAGER !== 'none') {
      indexerService.ensureIndexerManagerConfigured();
    }
    // Skip NZBDav config check in native streaming mode
    if (STREAMING_MODE !== 'native') {
      nzbdavService.ensureNzbdavConfigured();
    }
    triagePrewarmPromise = triggerRequestTriagePrewarm();

    if (incomingTmdbId && !incomingImdbId && !incomingTvdbId) {
      if (!tmdbService.isConfigured()) {
        res.status(400).json({ error: 'TMDb is not configured (enable TMDB and set API key).' });
        return;
      }
      const mediaType = type === 'movie' ? 'movie' : 'series';
      const externalIds = await tmdbService.getExternalIds(incomingTmdbId, mediaType);
      if (externalIds?.imdbId) {
        incomingImdbId = externalIds.imdbId.startsWith('tt') ? externalIds.imdbId : `tt${externalIds.imdbId}`;
      }
      if (externalIds?.tvdbId) {
        incomingTvdbId = externalIds.tvdbId;
      }
      if (!incomingImdbId && !incomingTvdbId) {
        res.status(404).json({ error: 'TMDb ID has no IMDb/TVDB mapping.' });
        return;
      }
    }

    if (type === 'movie' && !incomingTmdbId && incomingImdbId && tmdbService.isConfigured()) {
      const tmdbFind = await tmdbService.findByExternalId(incomingImdbId, 'imdb_id');
      if (tmdbFind?.tmdbId && tmdbFind.mediaType === 'movie') {
        incomingTmdbId = String(tmdbFind.tmdbId);
      }
    }

    if (type === 'series' && tvdbService.isConfigured()) {
      if (incomingTvdbId && !incomingImdbId) {
        const tvdbLookup = await tvdbService.getImdbIdForSeries(incomingTvdbId);
        if (tvdbLookup?.imdbId) {
          incomingImdbId = tvdbLookup.imdbId.startsWith('tt') ? tvdbLookup.imdbId : `tt${tvdbLookup.imdbId}`;
        }
      } else if (incomingImdbId && !incomingTvdbId) {
        const tvdbLookup = await tvdbService.getTvdbIdForSeries(incomingImdbId);
        if (tvdbLookup?.tvdbId) {
          incomingTvdbId = tvdbLookup.tvdbId;
        }
      }
    }

    if (isNzbdavRequest) {
      if (STREAMING_MODE === 'native') {
        res.status(400).json({ error: 'NZBDav catalog is only available in NZBDav mode.' });
        return;
      }

      const categoryForType = nzbdavService.getNzbdavCategory(type);
      const historyMap = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType], Math.max(50, NZBDAV_HISTORY_CATALOG_LIMIT || 50));
      const match = Array.from(historyMap.values()).find((entry) => String(entry.nzoId) === String(incomingNzbdavId));
      if (!match) {
        res.status(404).json({ error: 'NZBDav history entry not found.' });
        return;
      }

      const tokenSegment = ADDON_SHARED_SECRET ? `/${ADDON_SHARED_SECRET}` : '';
      const rawFilename = (match.jobName || 'stream').toString().trim();
      const normalizedFilename = rawFilename
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const fileBase = normalizedFilename || 'stream';
      const hasVideoExt = /\.(mkv|mp4|m4v|avi|mov|wmv|mpg|mpeg|ts|webm)$/i.test(fileBase);
      const fileWithExt = hasVideoExt ? fileBase : `${fileBase}.mkv`;
      const encodedFilename = encodeURIComponent(fileWithExt);
      const baseParams = new URLSearchParams({
        type,
        id,
        historyNzoId: String(match.nzoId),
      });
      if (match.jobName) baseParams.set('historyJobName', match.jobName);
      if (match.category) baseParams.set('historyCategory', match.category);
      const streamUrl = `${addonBaseUrl}${tokenSegment}/nzb/stream/${encodeStreamParams(baseParams)}/${encodedFilename}`;

      const stream = {
        title: match.jobName || 'NZBDav Completed',
        name: match.jobName || 'NZBDav Completed',
        url: streamUrl,
        behaviorHints: {
          notWebReady: true,
          cached: true,
          cachedFromHistory: true,
          filename: match.jobName || undefined,
        }
      };

      res.json({ streams: [stream] });
      return;
    }

    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const streamCacheKey = STREAM_CACHE_MAX_ENTRIES > 0
      ? buildStreamCacheKey({ type, id, requestedEpisode, query: req.query || {} })
      : null;
    let cachedStreamEntry = null;
    let cachedSearchMeta = null;
    let cachedTriageDecisionMap = null;
    if (streamCacheKey) {
      cachedStreamEntry = cache.getStreamCacheEntry(streamCacheKey);
      if (cachedStreamEntry) {
        const cachedStreams = Array.isArray(cachedStreamEntry.payload?.streams)
          ? cachedStreamEntry.payload.streams
          : [];
        if (cachedStreams.length === 0) {
          console.log('[CACHE] Ignoring cached empty stream payload', { type, id });
          cachedStreamEntry = null;
        }
      }
      if (cachedStreamEntry) {
        const cacheMeta = cachedStreamEntry.meta;
        if (cacheMeta?.version === 1 && Array.isArray(cacheMeta.finalNzbResults)) {
          const snapshot = Array.isArray(cacheMeta.triageDecisionsSnapshot) ? cacheMeta.triageDecisionsSnapshot : [];
          cachedTriageDecisionMap = restoreTriageDecisions(snapshot);
          if (!cacheMeta.triageComplete && Array.isArray(cacheMeta.triagePendingDownloadUrls)) {
            const pendingList = cacheMeta.triagePendingDownloadUrls;
            const unresolved = pendingList.filter((downloadUrl) => {
              const decision = cachedTriageDecisionMap.get(downloadUrl);
              return !isTriageFinalStatus(decision?.status);
            });
            if (unresolved.length === 0) {
              cacheMeta.triageComplete = true;
              cacheMeta.triagePendingDownloadUrls = [];
            } else if (unresolved.length !== pendingList.length) {
              cacheMeta.triagePendingDownloadUrls = unresolved;
            }
          }
          cachedSearchMeta = cacheMeta;
          if (cacheMeta.triageComplete) {
            console.log('[CACHE] Stream cache hit (rehydrating finalized results)', {
              type,
              id,
              cachedStreams: cachedStreamEntry.payload?.streams?.length || 0,
            });
          } else {
            console.log('[CACHE] Reusing cached search results for pending triage', {
              type,
              id,
              pending: cacheMeta.triagePendingDownloadUrls?.length || 0,
            });
          }
        } else if (!cacheMeta || cacheMeta.triageComplete) {
          console.log('[CACHE] Stream cache hit (legacy payload)', { type, id });
          res.json(cachedStreamEntry.payload);
          return;
        } else {
          console.log('[CACHE] Entry missing usable metadata; ignoring context');
        }
      }
    }

    let usingCachedSearchResults = false;
    let finalNzbResults = [];
    let dedupedSearchResults = [];
    let rawSearchResults = [];
    let triageDecisions = cachedTriageDecisionMap
      || (cachedSearchMeta
        ? restoreTriageDecisions(cachedSearchMeta.triageDecisionsSnapshot)
        : new Map());
    if (cachedSearchMeta) {
      const restored = restoreFinalNzbResults(cachedSearchMeta.finalNzbResults);
      rawSearchResults = restored.slice();
      dedupedSearchResults = dedupeResultsByTitle(restored);
      finalNzbResults = dedupedSearchResults.slice();
      usingCachedSearchResults = true;
    }
    let triageTitleMap = buildTriageTitleMap(triageDecisions);
    const triageOverrides = extractTriageOverrides(req.query || {});
    const dedupeOverride = typeof triageOverrides.dedupeEnabled === 'boolean' ? triageOverrides.dedupeEnabled : null;
    const dedupeEnabled = dedupeOverride !== null ? dedupeOverride : INDEXER_DEDUP_ENABLED;

    const pickFirstDefined = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || null;
    const meta = req.query || {};

    console.log('[REQUEST] Raw query payload from Stremio', meta);

    const hasTvdbInQuery = Boolean(
      pickFirstDefined(
        meta.tvdbId,
        meta.tvdb_id,
        meta.tvdb,
        meta.tvdbSlug,
        meta.tvdbid
      )
    );

    const hasTmdbInQuery = Boolean(
      pickFirstDefined(
        meta.tmdbId,
        meta.tmdb_id,
        meta.tmdb,
        meta.tmdbSlug,
        meta.tmdbid
      )
    );

    const hasTitleInQuery = Boolean(
      pickFirstDefined(
        meta.title,
        meta.name,
        meta.originalTitle,
        meta.original_title
      )
    );

    const metaSources = [meta];
    if (incomingImdbId) {
      metaSources.push({ ids: { imdb: incomingImdbId }, imdb_id: incomingImdbId });
    }
    if (incomingTmdbId) {
      metaSources.push({ ids: { tmdb: incomingTmdbId }, tmdb_id: String(incomingTmdbId) });
    }
    if (incomingTvdbId) {
      metaSources.push({ ids: { tvdb: incomingTvdbId }, tvdb_id: incomingTvdbId });
    }
    let specialMetadataResult = null;
    if (isSpecialRequest) {
      try {
        specialMetadataResult = await specialMetadata.fetchSpecialMetadata(baseIdentifier);
        if (specialMetadataResult?.title) {
          metaSources.push({ title: specialMetadataResult.title, name: specialMetadataResult.title });
          console.log('[SPECIAL META] Resolved title for external catalog request', { title: specialMetadataResult.title });
        }
      } catch (error) {
        console.error('[SPECIAL META] Failed to resolve metadata:', error.message);
        res.status(502).json({ error: 'Failed to resolve external metadata' });
        return;
      }
    }
    let cinemetaMeta = null;

    const needsStrictSeriesTvdb = !isSpecialRequest && type === 'series' && !incomingTvdbId && Boolean(incomingImdbId);
    const needsRelaxedMetadata = !isSpecialRequest && !INDEXER_MANAGER_STRICT_ID_MATCH && (
      (!hasTitleInQuery) ||
      (type === 'series' && !hasTvdbInQuery) ||
      (type === 'movie' && !hasTmdbInQuery)
    );

    // Check if we should use TMDb as primary metadata source
    const tmdbConfig = tmdbService.getConfig();
    const shouldUseTmdb = tmdbService.isConfigured() && incomingImdbId;
    const skipMetadataFetch = Boolean(cachedSearchMeta?.triageComplete);

    let tmdbMetadata = null;
    let tmdbMetadataPromise = null;

    // Start TMDb fetch in background (don't await yet)
    if (shouldUseTmdb && !skipMetadataFetch) {
      console.log('[TMDB] Starting TMDb metadata fetch in background');
      tmdbMetadataPromise = tmdbService.getMetadataAndTitles({
        imdbId: incomingImdbId,
        type,
      }).then((result) => {
        if (result) {
          console.log('[TMDB] Retrieved metadata', {
            tmdbId: result.tmdbId,
            mediaType: result.mediaType,
            originalTitle: result.originalTitle,
            year: result.year,
            titleCount: result.titles.length,
          });
        }
        return result;
      }).catch((error) => {
        console.error('[TMDB] Failed to fetch metadata:', error.message);
        return null;
      });
    }

    const needsCinemeta = !skipMetadataFetch && !shouldUseTmdb && (
      needsStrictSeriesTvdb
      || needsRelaxedMetadata
      || easynewsService.requiresCinemetaMetadata(isSpecialRequest)
    );

    let cinemetaPromise = null;
    if (needsCinemeta) {
      const cinemetaPath = type === 'series' ? `series/${baseIdentifier}.json` : `${type}/${baseIdentifier}.json`;
      const cinemetaUrl = `${CINEMETA_URL}/${cinemetaPath}`;
      console.log(`[CINEMETA] Starting Cinemeta fetch in background from ${cinemetaUrl}`);
      cinemetaPromise = axios.get(cinemetaUrl, { timeout: 10000 })
        .then((response) => {
          const meta = response.data?.meta || null;
          if (meta) {
            console.log('[CINEMETA] Received metadata identifiers', {
              imdb: meta?.ids?.imdb || meta?.imdb_id,
              tvdb: meta?.ids?.tvdb || meta?.tvdb_id,
              tmdb: meta?.ids?.tmdb || meta?.tmdb_id
            });
            console.log('[CINEMETA] Received metadata fields', {
              title: meta?.title,
              name: meta?.name,
              originalTitle: meta?.originalTitle,
              year: meta?.year,
              released: meta?.released
            });
          } else {
            console.warn(`[CINEMETA] No metadata payload returned`);
          }
          return meta;
        })
        .catch((error) => {
          console.warn(`[CINEMETA] Failed to fetch metadata for ${baseIdentifier}: ${error.message}`);
          return null;
        });
    }

    const collectValues = (...extractors) => {
      const collected = [];
      for (const source of metaSources) {
        if (!source) continue;
        for (const extractor of extractors) {
          try {
            const value = extractor(source);
            if (value !== undefined && value !== null) {
              collected.push(value);
            }
          } catch (error) {
            // ignore extractor errors on unexpected shapes
          }
        }
      }
      return collected;
    };

    const seasonNum = requestedEpisode?.season ?? null;
    const episodeNum = requestedEpisode?.episode ?? null;

    const normalizeImdb = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      const withPrefix = trimmed.startsWith('tt') ? trimmed : `tt${trimmed}`;
      return /^tt\d+$/.test(withPrefix) ? withPrefix : null;
    };

    const normalizeNumericId = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      if (!/^\d+$/.test(trimmed)) return null;
      return trimmed;
    };

    const metaIds = {
      imdb: normalizeImdb(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.imdb_id,
            (src) => src?.imdb,
            (src) => src?.imdbId,
            (src) => src?.imdbid,
            (src) => src?.ids?.imdb,
            (src) => src?.externals?.imdb
          ),
          incomingImdbId
        )
      ),
      tmdb: normalizeNumericId(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.tmdb_id,
            (src) => src?.tmdb,
            (src) => src?.tmdbId,
            (src) => src?.ids?.tmdb,
            (src) => src?.ids?.themoviedb,
            (src) => src?.externals?.tmdb,
            (src) => src?.tmdbSlug,
            (src) => src?.tmdbid
          )
        )
      ),
      tvdb: normalizeNumericId(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.tvdb_id,
            (src) => src?.tvdb,
            (src) => src?.tvdbId,
            (src) => src?.ids?.tvdb,
            (src) => src?.externals?.tvdb,
            (src) => src?.tvdbSlug,
            (src) => src?.tvdbid
          ),
          incomingTvdbId
        )
      )
    };

    console.log('[REQUEST] Normalized identifier set', metaIds);

    const extractYear = (value) => {
      if (value === null || value === undefined) return null;
      const match = String(value).match(/\d{4}/);
      if (!match) return null;
      const parsed = Number.parseInt(match[0], 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    let movieTitle = pickFirstDefined(
      ...collectValues(
        (src) => src?.name,
        (src) => src?.title,
        (src) => src?.originalTitle,
        (src) => src?.original_title
      )
    );

    let releaseYear = extractYear(
      pickFirstDefined(
        ...collectValues(
          (src) => src?.year,
          (src) => src?.releaseYear,
          (src) => src?.released,
          (src) => src?.releaseInfo?.year
        )
      )
    );

    if (!movieTitle && specialMetadataResult?.title) {
      movieTitle = specialMetadataResult.title;
    }

    if (!releaseYear && specialMetadataResult?.year) {
      const specialYear = extractYear(specialMetadataResult.year);
      if (specialYear) {
        releaseYear = specialYear;
      }
    }

    let searchType;
    if (type === 'series') {
      searchType = 'tvsearch';
    } else if (type === 'movie') {
      searchType = 'movie';
    } else {
      searchType = 'search';
    }

    const seasonToken = Number.isFinite(seasonNum) ? `{Season:${seasonNum}}` : null;
    const episodeToken = Number.isFinite(episodeNum) ? `{Episode:${episodeNum}}` : null;
    const strictTextMode = !isSpecialRequest && (type === 'movie' || type === 'series');

    if (!usingCachedSearchResults) {
      const searchPlans = [];
      const seenPlans = new Set();
      const addPlan = (planType, { tokens = [], rawQuery = null } = {}) => {
        const tokenList = [...tokens];
        if (planType === 'tvsearch') {
          if (seasonToken) tokenList.push(seasonToken);
          if (episodeToken) tokenList.push(episodeToken);
        }
        const normalizedTokens = tokenList.filter(Boolean);
        const query = rawQuery ? rawQuery : normalizedTokens.join(' ');
        if (!query) {
          return false;
        }
        const planKey = `${planType}|${query}`;
        if (seenPlans.has(planKey)) {
          return false;
        }
        seenPlans.add(planKey);
        const planRecord = { type: planType, query, rawQuery: rawQuery ? rawQuery : null, tokens: normalizedTokens };
        if (strictTextMode && planType === 'search' && rawQuery && !isSpecialRequest) {
          const strictPhrase = sanitizeStrictSearchPhrase(rawQuery);
          if (strictPhrase) {
            planRecord.strictMatch = true;
            planRecord.strictPhrase = strictPhrase;
          }
        }
        searchPlans.push(planRecord);
        return true;
      };

      // Add ID-based searches immediately (before waiting for TMDb/Cinemeta)
      if (type === 'series') {
        if (metaIds.tvdb) {
          addPlan('tvsearch', { tokens: [`{TvdbId:${metaIds.tvdb}}`] });
        }
        if (metaIds.imdb) {
          addPlan('tvsearch', { tokens: [`{ImdbId:${metaIds.imdb}}`] });
        }
      } else if (type === 'movie') {
        if (metaIds.imdb) {
          addPlan('movie', { tokens: [`{ImdbId:${metaIds.imdb}}`] });
        }
        if (metaIds.tmdb) {
          addPlan('movie', { tokens: [`{TmdbId:${metaIds.tmdb}}`] });
        }
      } else if (metaIds.imdb) {
        addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
      }

      // Start ID-based searches immediately in background
      const idSearchPromises = [];
      const idSearchStartTs = Date.now();
      if (searchPlans.length > 0) {
        console.log(`${INDEXER_LOG_PREFIX} Starting ${searchPlans.length} ID-based search(es) immediately`);
        idSearchPromises.push(...searchPlans.map((plan) => {
          console.log(`${INDEXER_LOG_PREFIX} Dispatching early ID plan`, plan);
          const planStartTs = Date.now();
          return Promise.allSettled([
            executeManagerPlanWithBackoff(plan),
            executeNewznabPlan(plan),
          ]).then((settled) => ({ plan, settled, startTs: planStartTs, endTs: Date.now() }));
        }));
      }

      // Now wait for TMDb to get localized titles (if applicable)
      const tmdbWaitStartTs = Date.now();
      if (tmdbMetadataPromise) {
        console.log('[TMDB] Waiting for TMDb metadata to add localized searches');
        tmdbMetadata = await tmdbMetadataPromise;
        console.log(`[TMDB] TMDb metadata fetch completed in ${Date.now() - tmdbWaitStartTs} ms`);
        if (tmdbMetadata) {
          if (!releaseYear && tmdbMetadata.year) {
            const tmdbYear = extractYear(tmdbMetadata.year);
            if (tmdbYear) {
              releaseYear = tmdbYear;
            }
          }
          // Create a metadata object compatible with existing code
          metaSources.push({
            imdb_id: incomingImdbId,
            tmdb_id: String(tmdbMetadata.tmdbId),
            title: tmdbMetadata.originalTitle,
            year: tmdbMetadata.year,
            _tmdbTitles: tmdbMetadata.titles, // Store for later use
          });
        }
      }

      // Wait for Cinemeta if applicable
      let cinemetaTitleCandidate = null;
      const cinemetaWaitStartTs = Date.now();
      if (cinemetaPromise) {
        console.log('[CINEMETA] Waiting for Cinemeta metadata');
        cinemetaMeta = await cinemetaPromise;
        console.log(`[CINEMETA] Cinemeta fetch completed in ${Date.now() - cinemetaWaitStartTs} ms`);
        if (cinemetaMeta) {
          metaSources.push(cinemetaMeta);
          cinemetaTitleCandidate = pickFirstDefined(
            cinemetaMeta?.name,
            cinemetaMeta?.title,
            cinemetaMeta?.originalTitle,
            cinemetaMeta?.original_title
          );
        }
      }

      if (type === 'series' && !tvdbService.isConfigured() && cinemetaMeta && !metaIds.tvdb) {
        const cinemetaTvdbId = normalizeNumericId(
          cinemetaMeta?.ids?.tvdb
          || cinemetaMeta?.tvdb_id
          || cinemetaMeta?.tvdb
        );
        if (cinemetaTvdbId) {
          metaIds.tvdb = cinemetaTvdbId;
          const added = addPlan('tvsearch', { tokens: [`{TvdbId:${metaIds.tvdb}}`] });
          if (added) {
            console.log(`${INDEXER_LOG_PREFIX} Added Cinemeta TVDB ID plan`, { tvdb: metaIds.tvdb });
            const planStartTs = Date.now();
            idSearchPromises.push(Promise.allSettled([
              executeManagerPlanWithBackoff(searchPlans[searchPlans.length - 1]),
              executeNewznabPlan(searchPlans[searchPlans.length - 1]),
            ]).then((settled) => ({
              plan: searchPlans[searchPlans.length - 1],
              settled,
              startTs: planStartTs,
              endTs: Date.now(),
            })));
          }
        }
      }

      if (!movieTitle) {
        movieTitle = pickFirstDefined(
          ...collectValues(
            (src) => src?.name,
            (src) => src?.title,
            (src) => src?.originalTitle,
            (src) => src?.original_title
          )
        );
      }

      if (!releaseYear) {
        releaseYear = extractYear(
          pickFirstDefined(
            ...collectValues(
              (src) => src?.year,
              (src) => src?.releaseYear,
              (src) => src?.released,
              (src) => src?.releaseInfo?.year
            )
          )
        );
      }

      console.log('[REQUEST] Resolved title/year', { movieTitle, releaseYear, elapsedMs: Date.now() - requestStartTs });

      const isCinemetaTitleSource = Boolean(
        cinemetaTitleCandidate
        && movieTitle
        && String(movieTitle).trim() === String(cinemetaTitleCandidate).trim()
      );
      // Strip subtitle after colon for Cinemeta series titles only when colon appears after 4th word
      const stripSeriesSubtitle = (title, allowStrip) => {
        if (!title || !allowStrip) return title;
        const colonIdx = title.indexOf(':');
        if (colonIdx > 0 && colonIdx < title.length - 1) {
          const beforeColon = title.slice(0, colonIdx).trim();
          const beforeWords = beforeColon.split(/\s+/).filter(Boolean);
          if (beforeWords.length >= 4) {
            const afterColon = title.slice(colonIdx + 1).trim();
            if (!/^\d{4}$/.test(afterColon)) {
              return beforeColon;
            }
          }
        }
        return title;
      };
      const searchTitle = type === 'series'
        ? stripSeriesSubtitle(movieTitle, isCinemetaTitleSource)
        : movieTitle;

      // Continue with text-based searches using TMDb titles
      const textQueryParts = [];
      let tmdbLocalizedQuery = null;
      let easynewsSearchParams = null;
      let textQueryFallbackValue = null;
      if (searchTitle) {
        textQueryParts.push(searchTitle);
      }
      if (type === 'movie' && Number.isFinite(releaseYear)) {
        textQueryParts.push(String(releaseYear));
      } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
        textQueryParts.push(`S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
      }

      const shouldForceTextSearch = isSpecialRequest;
      const shouldAddTextSearch = shouldForceTextSearch || !INDEXER_MANAGER_STRICT_ID_MATCH;

      if (shouldAddTextSearch) {
        const hasTmdbTitles = metaSources.some(s => s?._tmdbTitles?.length > 0);
        const hasHumanTitleMeta = Boolean(movieTitle && movieTitle.trim());
        if (!hasTmdbTitles && !hasHumanTitleMeta) {
          console.log(`${INDEXER_LOG_PREFIX} Skipping text search plans (no TMDb/Cinemeta title)`);
        } else {
          const textQueryCandidate = textQueryParts.join(' ').trim();
          const isEpisodeOnly = /^s\d{2}e\d{2}$/i.test(textQueryCandidate) && !movieTitle;
          const isYearOnly = /^\d{4}$/.test(textQueryCandidate) && (!movieTitle || !movieTitle.trim());
          if (isEpisodeOnly) {
            console.log(`${INDEXER_LOG_PREFIX} Skipping episode-only text plan (no title)`);
          } else if (isYearOnly) {
            console.log(`${INDEXER_LOG_PREFIX} Skipping year-only text plan (no title)`);
          } else {
            const rawFallback = textQueryCandidate.trim();
            textQueryFallbackValue = tmdbService.normalizeToAscii(rawFallback);
            if (textQueryFallbackValue && textQueryFallbackValue !== rawFallback) {
              console.log(`${INDEXER_LOG_PREFIX} Normalized text query to ASCII`, { original: rawFallback, normalized: textQueryFallbackValue });
            }
            const normalizedValue = (textQueryFallbackValue || '').trim();
            const normalizedYearOnly = /^\d{4}$/.test(normalizedValue);
            const normalizedEpisodeOnly = /^s\d{2}e\d{2}$/i.test(normalizedValue) || /^s\d{2}$/i.test(normalizedValue) || /^e\d{2}$/i.test(normalizedValue);
            const rawHadNonAscii = /[^\x00-\x7F]/.test(rawFallback);
            if (normalizedYearOnly || normalizedEpisodeOnly) {
              console.log(`${INDEXER_LOG_PREFIX} Skipping text search plan (normalized to episode/year only)`, { original: rawFallback, normalized: normalizedValue });
            } else if (normalizedValue) {
              const addedTextPlan = addPlan('search', { rawQuery: textQueryFallbackValue });
              if (addedTextPlan) {
                console.log(`${INDEXER_LOG_PREFIX} Added text search plan`, { query: textQueryFallbackValue });
              } else {
                console.log(`${INDEXER_LOG_PREFIX} Text search plan already present (deduped)`, { query: textQueryFallbackValue });
              }
            } else {
              console.log(`${INDEXER_LOG_PREFIX} Skipping text search plan (empty after ASCII normalization); will use TMDb titles instead`);
            }
          }
        }

        // TMDb multi-language searches: add search plans for each configured language
        const tmdbTitles = metaSources.find(s => s?._tmdbTitles)?._tmdbTitles;
        if (tmdbTitles && tmdbTitles.length > 0 && !isSpecialRequest) {
          console.log(`[TMDB] Adding up to ${tmdbTitles.length} normalized TMDb search plans`);
          tmdbTitles.forEach((titleObj) => {
            const normalizedBase = (titleObj.asciiTitle || '').trim();
            if (!normalizedBase) {
              console.log(`${INDEXER_LOG_PREFIX} Skipping TMDb title with no ASCII representation`, { language: titleObj.language, title: titleObj.title });
              return;
            }

            let normalizedQuery = normalizedBase;
            if (type === 'movie' && Number.isFinite(releaseYear)) {
              normalizedQuery = `${normalizedQuery} ${releaseYear}`;
            } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
              normalizedQuery = `${normalizedQuery} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            }

            const added = addPlan('search', { rawQuery: normalizedQuery });
            if (added) {
              console.log(`${INDEXER_LOG_PREFIX} Added normalized TMDb ${titleObj.language} search plan`, { query: normalizedQuery });
            }

            if (!tmdbLocalizedQuery) {
              tmdbLocalizedQuery = normalizedQuery;
            }
          });
        }
      } else {
        const reason = INDEXER_MANAGER_STRICT_ID_MATCH ? 'strict ID matching enabled' : 'text search disabled';
        console.log(`${INDEXER_LOG_PREFIX} ${reason}; skipping text-based search`);
      }

      if (INDEXER_MANAGER_INDEXERS) {
        console.log(`${INDEXER_LOG_PREFIX} Using configured indexers`, INDEXER_MANAGER_INDEXERS);
      } else {
        console.log(`${INDEXER_LOG_PREFIX} Using manager default indexer selection`);
      }

      if (easynewsService.isEasynewsEnabled()) {
        const easynewsStrictMode = !isSpecialRequest && (type === 'movie' || type === 'series');
        let easynewsRawQuery = null;

        // Check if we have TMDb titles - prefer English titles for Easynews
        const tmdbTitles = metaSources.find(s => s?._tmdbTitles)?._tmdbTitles;
        if (tmdbTitles && tmdbTitles.length > 0) {
          // Find English title first
          const englishTitle = tmdbTitles.find(t => t.language && t.language.startsWith('en-'));
          if (englishTitle) {
            easynewsRawQuery = englishTitle.title;
            if (type === 'movie' && Number.isFinite(releaseYear)) {
              easynewsRawQuery = `${easynewsRawQuery} ${releaseYear}`;
            } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
              easynewsRawQuery = `${easynewsRawQuery} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            }
            console.log('[EASYNEWS] Using English title from TMDb:', easynewsRawQuery);
          } else {
            // No English title, try ASCII-safe titles only
            const asciiTitle = tmdbTitles.find(t => t.title && !/[^\x00-\x7F]/.test(t.title));
            if (asciiTitle) {
              easynewsRawQuery = asciiTitle.title;
              if (type === 'movie' && Number.isFinite(releaseYear)) {
                easynewsRawQuery = `${easynewsRawQuery} ${releaseYear}`;
              } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
                easynewsRawQuery = `${easynewsRawQuery} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
              }
              console.log('[EASYNEWS] Using ASCII title from TMDb:', easynewsRawQuery);
            }
          }
        }

        // Fallback to old logic if no TMDb titles
        if (!easynewsRawQuery) {
          if (isSpecialRequest) {
            easynewsRawQuery = (specialMetadataResult?.title || movieTitle || baseIdentifier || '').trim();
          } else if (easynewsStrictMode) {
            easynewsRawQuery = (textQueryParts.join(' ').trim() || movieTitle || '').trim();
          } else {
            easynewsRawQuery = (textQueryParts.join(' ').trim() || movieTitle || '').trim();
          }
          if (!easynewsRawQuery && tmdbLocalizedQuery) {
            easynewsRawQuery = tmdbLocalizedQuery;
          }
          if (!easynewsRawQuery && textQueryFallbackValue) {
            easynewsRawQuery = textQueryFallbackValue;
          }
          if (!easynewsRawQuery && baseIdentifier) {
            easynewsRawQuery = baseIdentifier;
          }

          // Skip Easynews if final query contains non-ASCII characters
          if (easynewsRawQuery && /[^\x00-\x7F]/.test(easynewsRawQuery)) {
            console.log('[EASYNEWS] Skipping search - query contains non-ASCII characters:', easynewsRawQuery);
            easynewsRawQuery = null;
          }
        }

        if (!easynewsRawQuery && baseIdentifier) {
          easynewsRawQuery = baseIdentifier;
        }

        if (easynewsRawQuery) {
          const trimmedEasynewsQuery = easynewsRawQuery.trim();
          const easynewsEpisodeOnly = /^s\d{2}e\d{2}$/i.test(trimmedEasynewsQuery);
          const easynewsYearOnly = /^\d{4}$/.test(trimmedEasynewsQuery);
          if (easynewsEpisodeOnly) {
            console.log('[EASYNEWS] Skipping episode-only query (no title)');
            easynewsRawQuery = baseIdentifier || null;
          } else if (easynewsYearOnly && (!movieTitle || !movieTitle.trim())) {
            console.log('[EASYNEWS] Skipping year-only query (no title)');
            easynewsRawQuery = baseIdentifier || null;
          }
        }

        if (easynewsRawQuery) {
          easynewsSearchParams = {
            rawQuery: easynewsRawQuery,
            fallbackQuery: textQueryFallbackValue || baseIdentifier || movieTitle || '',
            year: type === 'movie' ? releaseYear : null,
            season: type === 'series' ? seasonNum : null,
            episode: type === 'series' ? episodeNum : null,
            strictMode: easynewsStrictMode,
            specialTextOnly: Boolean(isSpecialRequest || requestLacksIdentifiers),
          };
          console.log('[EASYNEWS] Prepared search params, will run in parallel with NZB searches');
        }
      }

      // Start Easynews search in parallel if params are ready
      let easynewsPromise = null;
      let easynewsSearchStartTs = null;
      if (easynewsSearchParams) {
        console.log('[EASYNEWS] Starting search in parallel');
        easynewsSearchStartTs = Date.now();
        easynewsPromise = easynewsService.searchEasynews(easynewsSearchParams)
          .then((results) => {
            if (Array.isArray(results) && results.length > 0) {
              console.log('[EASYNEWS] Retrieved results', { count: results.length, query: easynewsSearchParams.rawQuery });
              return results;
            }
            return [];
          })
          .catch((error) => {
            console.warn('[EASYNEWS] Search failed', error.message);
            return [];
          });
      }

      const deriveResultKey = (result) => {
        if (!result) return null;
        const indexerId = result.indexerId || result.IndexerId || 'unknown';
        const indexer = result.indexer || result.Indexer || '';
        const title = (result.title || result.Title || '').trim();
        const size = result.size || result.Size || 0;

        // Use title + indexer info + size as unique key for better deduplication
        return `${indexerId}|${indexer}|${title}|${size}`;
      };

      const usingStrictIdMatching = INDEXER_MANAGER_STRICT_ID_MATCH;
      const resultsByKey = usingStrictIdMatching ? null : new Map();
      const aggregatedResults = usingStrictIdMatching ? [] : null;
      const rawAggregatedResults = [];
      const planSummaries = [];

      const resultMatchesStrictPlan = (plan, item) => {
        if (!plan?.strictMatch || !plan.strictPhrase) return true;
        const annotated = (item?.parsedTitle || item?.parsedTitleDisplay || item?.season || item?.episode || item?.year)
          ? item
          : annotateNzbResult(item, 0);
        const candidateTitle = (annotated?.parsedTitle || annotated?.title || annotated?.Title || '').trim();
        const strictTitlePhrase = (() => {
          try {
            const parsed = parseReleaseMetadata(plan.query || plan.strictPhrase);
            if (parsed?.parsedTitle) return sanitizeStrictSearchPhrase(parsed.parsedTitle);
          } catch (_) { /* fallback */ }
          return plan.strictPhrase;
        })();
        if (!candidateTitle) {
          if (isNewznabDebugEnabled()) {
            console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (no parsed title)`, {
              rawTitle: item?.title || item?.Title || null,
              query: plan.query,
            });
          }
          return false;
        }
        if (!matchesStrictSearch(candidateTitle, strictTitlePhrase)) {
          if (isNewznabDebugEnabled()) {
            console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (title mismatch)`, {
              title: candidateTitle,
              query: strictTitlePhrase,
            });
          }
          return false;
        }
        if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
          if (!Number.isFinite(annotated?.season) || !Number.isFinite(annotated?.episode)) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (missing season/episode)`, {
                title: candidateTitle,
                season: annotated?.season ?? null,
                episode: annotated?.episode ?? null,
                query: plan.query,
              });
            }
            return false;
          }
          if (Number(annotated.season) !== Number(seasonNum) || Number(annotated.episode) !== Number(episodeNum)) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (season/episode mismatch)`, {
                title: candidateTitle,
                season: annotated?.season ?? null,
                episode: annotated?.episode ?? null,
                expectedSeason: seasonNum,
                expectedEpisode: episodeNum,
                query: plan.query,
              });
            }
            return false;
          }
        }
        if (type === 'movie' && Number.isFinite(releaseYear)) {
          if (!Number.isFinite(annotated?.year)) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (missing year)`, {
                title: candidateTitle,
                year: annotated?.year ?? null,
                expectedYear: releaseYear,
                query: plan.query,
              });
            }
            return false;
          }
          if (Number(annotated.year) !== Number(releaseYear)) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (year mismatch)`, {
                title: candidateTitle,
                year: annotated?.year ?? null,
                expectedYear: releaseYear,
                query: plan.query,
              });
            }
            return false;
          }
        }
        if (type === 'movie') {
          const releaseTypes = Array.isArray(annotated?.releaseTypes)
            ? annotated.releaseTypes.map((value) => String(value).toLowerCase())
            : [];
          const adultReleaseTypes = new Set(['xxx', 'adult', 'porn', 'pornographic', 'erotic', 'erotica']);
          const hasAdultReleaseType = releaseTypes.some((value) => adultReleaseTypes.has(value));
          if (hasAdultReleaseType) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (adult release type)`, {
                title: candidateTitle,
                releaseTypes,
                query: plan.query,
              });
            }
            return false;
          }
          const audioOnlyPattern = /\b(soundtrack|ost|score|album|flac|mp3|aac|alac|wav|ape|m4a)\b/i;
          const containerValue = (annotated?.container || '').toString().toLowerCase();
          const isVideoContainer = /(mkv|mp4|avi|mov|wmv|mpg|mpeg|m4v|webm|ts|m2ts)/i.test(containerValue);
          if (audioOnlyPattern.test(candidateTitle) && !isVideoContainer) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (audio-only title)`, {
                title: candidateTitle,
                container: containerValue || null,
                query: plan.query,
              });
            }
            return false;
          }
        }
        if (isNewznabDebugEnabled()) {
          console.log(`${INDEXER_LOG_PREFIX} Strict text match passed`, {
            title: candidateTitle,
            season: annotated?.season ?? null,
            episode: annotated?.episode ?? null,
            year: annotated?.year ?? null,
            query: plan.query,
          });
        }
        return true;
      };

      // Process early ID-based searches that are already running
      const idProcessStartTs = Date.now();
      const idPlanResults = await Promise.all(idSearchPromises);
      console.log(`${INDEXER_LOG_PREFIX} ID-based searches completed in ${Date.now() - idSearchStartTs} ms total`);
      const processedIdPlans = new Set();

      for (const { plan, settled, startTs, endTs } of idPlanResults) {
        console.log(`${INDEXER_LOG_PREFIX} ID plan execution time: ${endTs - startTs} ms for "${plan.query}"`);
        processedIdPlans.add(`${plan.type}|${plan.query}`);
        const managerSet = settled[0];
        const newznabSet = settled[1];
        const managerResults = managerSet?.status === 'fulfilled'
          ? (Array.isArray(managerSet.value?.results) ? managerSet.value.results : (Array.isArray(managerSet.value) ? managerSet.value : []))
          : [];
        const newznabResults = newznabSet?.status === 'fulfilled'
          ? (Array.isArray(newznabSet.value?.results) ? newznabSet.value.results : (Array.isArray(newznabSet.value) ? newznabSet.value : []))
          : [];
        const combinedResults = [...managerResults, ...newznabResults];
        const errors = [];
        if (managerSet?.status === 'rejected') {
          errors.push(`manager: ${managerSet.reason?.message || managerSet.reason}`);
        } else if (Array.isArray(managerSet?.value?.errors) && managerSet.value.errors.length) {
          managerSet.value.errors.forEach((err) => errors.push(`manager: ${err}`));
        }
        if (newznabSet?.status === 'rejected') {
          errors.push(`newznab: ${newznabSet.reason?.message || newznabSet.reason}`);
        } else if (Array.isArray(newznabSet?.value?.errors) && newznabSet.value.errors.length) {
          newznabSet.value.errors.forEach((err) => errors.push(`newznab: ${err}`));
        }

        console.log(`${INDEXER_LOG_PREFIX} ✅ ${plan.type} returned ${combinedResults.length} total results for query "${plan.query}"`, {
          managerCount: managerResults.length || 0,
          newznabCount: newznabResults.length || 0,
          errors: errors.length ? errors : undefined,
        });

        const filteredResults = combinedResults.filter((item) =>
          item && typeof item === 'object' && item.downloadUrl && resultMatchesStrictPlan(plan, item)
        );
        filteredResults.forEach((item) => rawAggregatedResults.push({ result: item, planType: plan.type }));

        if (filteredResults.length > 0) {
          if (usingStrictIdMatching) {
            aggregatedResults.push(...filteredResults.map((item) => ({ result: item, planType: plan.type })));
          } else if (resultsByKey) {
            for (const item of filteredResults) {
              const key = deriveResultKey(item);
              if (!key) continue;
              if (!resultsByKey.has(key)) {
                resultsByKey.set(key, { result: item, planType: plan.type });
              }
            }
          }
        }

        planSummaries.push({
          planType: plan.type,
          query: plan.query,
          total: combinedResults.length,
          filtered: filteredResults.length,
          managerCount: managerResults.length,
          newznabCount: newznabResults.length,
          errors: errors.length ? errors : undefined,
          newznabEndpoints: Array.isArray(newznabSet?.value?.endpoints) ? newznabSet.value.endpoints : [],
        });
      }

      // Now execute remaining text-based search plans (exclude already-processed ID plans)
      const remainingPlans = searchPlans.filter(p => !processedIdPlans.has(`${p.type}|${p.query}`));
      console.log(`${INDEXER_LOG_PREFIX} Executing ${remainingPlans.length} text-based search plan(s)`);
      const textSearchStartTs = Date.now();
      const planExecutions = remainingPlans.map((plan) => {
        console.log(`${INDEXER_LOG_PREFIX} Dispatching plan`, plan);
        return Promise.allSettled([
          executeManagerPlanWithBackoff(plan),
          executeNewznabPlan(plan),
        ]).then((settled) => {
          const managerSet = settled[0];
          const newznabSet = settled[1];
          const managerResults = managerSet?.status === 'fulfilled'
            ? (Array.isArray(managerSet.value?.results) ? managerSet.value.results : (Array.isArray(managerSet.value) ? managerSet.value : []))
            : [];
          const newznabResults = newznabSet?.status === 'fulfilled'
            ? (Array.isArray(newznabSet.value?.results) ? newznabSet.value.results : (Array.isArray(newznabSet.value) ? newznabSet.value : []))
            : [];
          const combinedResults = [...managerResults, ...newznabResults];
          const errors = [];
          if (managerSet?.status === 'rejected') {
            errors.push(`manager: ${managerSet.reason?.message || managerSet.reason}`);
          } else if (Array.isArray(managerSet?.value?.errors) && managerSet.value.errors.length) {
            managerSet.value.errors.forEach((err) => errors.push(`manager: ${err}`));
          }
          if (newznabSet?.status === 'rejected') {
            errors.push(`newznab: ${newznabSet.reason?.message || newznabSet.reason}`);
          } else if (Array.isArray(newznabSet?.value?.errors) && newznabSet.value.errors.length) {
            newznabSet.value.errors.forEach((err) => errors.push(`newznab: ${err}`));
          }
          if (combinedResults.length === 0 && errors.length > 0) {
            return {
              plan,
              status: 'rejected',
              error: new Error(errors.join('; ')),
              errors,
              mgrCount: managerResults.length,
              newznabCount: newznabResults.length,
            };
          }
          return {
            plan,
            status: 'fulfilled',
            data: combinedResults,
            errors,
            mgrCount: managerResults.length,
            newznabCount: newznabResults.length,
            newznabEndpoints: Array.isArray(newznabSet?.value?.endpoints) ? newznabSet.value.endpoints : [],
          };
        });
      });

      const planResultsSettled = await Promise.all(planExecutions);
      console.log(`${INDEXER_LOG_PREFIX} Text-based searches completed in ${Date.now() - textSearchStartTs} ms`);

      for (const result of planResultsSettled) {
        const { plan } = result;
        if (result.status === 'rejected') {
          console.error(`${INDEXER_LOG_PREFIX} ❌ Search plan failed`, {
            message: result.error?.message || result.errors?.join('; ') || result.error,
            type: plan.type,
            query: plan.query
          });
          planSummaries.push({
            planType: plan.type,
            query: plan.query,
            total: 0,
            filtered: 0,
            uniqueAdded: 0,
            error: result.error?.message || result.errors?.join('; ') || 'Unknown failure'
          });
          continue;
        }

        const planResults = Array.isArray(result.data) ? result.data : [];
        console.log(`${INDEXER_LOG_PREFIX} ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`, {
          managerCount: result.mgrCount || 0,
          newznabCount: result.newznabCount || 0,
          errors: result.errors && result.errors.length ? result.errors : undefined,
        });

        const filteredResults = planResults.filter((item) => {
          if (!item || typeof item !== 'object') {
            return false;
          }
          if (!item.downloadUrl) {
            return false;
          }
          return resultMatchesStrictPlan(plan, item);
        });

        filteredResults.forEach((item) => rawAggregatedResults.push({ result: item, planType: plan.type }));

        let addedCount = 0;
        if (usingStrictIdMatching) {
          aggregatedResults.push(...filteredResults.map((item) => ({ result: item, planType: plan.type })));
          addedCount = filteredResults.length;
        } else {
          const beforeSize = resultsByKey.size;
          for (const item of filteredResults) {
            const key = deriveResultKey(item);
            if (!key) continue;
            if (!resultsByKey.has(key)) {
              resultsByKey.set(key, { result: item, planType: plan.type });
            }
          }
          addedCount = resultsByKey.size - beforeSize;
        }

        planSummaries.push({
          planType: plan.type,
          query: plan.query,
          total: planResults.length,
          filtered: filteredResults.length,
          uniqueAdded: addedCount,
          managerCount: result.mgrCount || 0,
          newznabCount: result.newznabCount || 0,
          errors: result.errors && result.errors.length ? result.errors : undefined,
        });
        console.log(`${INDEXER_LOG_PREFIX} ✅ Plan summary`, planSummaries[planSummaries.length - 1]);
        if (result.newznabEndpoints && result.newznabEndpoints.length) {
          console.log(`${NEWZNAB_LOG_PREFIX} Endpoint results`, result.newznabEndpoints);
        }
      }

      const aggregationCount = usingStrictIdMatching ? aggregatedResults.length : resultsByKey.size;
      if (aggregationCount === 0) {
        console.warn(`${INDEXER_LOG_PREFIX} ⚠ All ${searchPlans.length} search plans returned no NZB results`);
      } else if (usingStrictIdMatching) {
        console.log(`${INDEXER_LOG_PREFIX} ✅ Aggregated NZB results with strict ID matching`, {
          plansRun: searchPlans.length,
          totalResults: aggregationCount
        });
      } else {
        console.log(`${INDEXER_LOG_PREFIX} ✅ Aggregated unique NZB results`, {
          plansRun: searchPlans.length,
          uniqueResults: aggregationCount
        });
      }

      const dedupedNzbResults = dedupeResultsByTitle(
        usingStrictIdMatching
          ? aggregatedResults.map((entry) => entry.result)
          : Array.from(resultsByKey.values()).map((entry) => entry.result)
      );
      const rawNzbResults = rawAggregatedResults.map((entry) => entry.result);

      dedupedSearchResults = dedupedNzbResults;
      rawSearchResults = rawNzbResults.length > 0 ? rawNzbResults : dedupedNzbResults.slice();

      const baseResults = dedupeEnabled ? dedupedSearchResults : rawSearchResults;
      if (!dedupeEnabled) {
        console.log(`${INDEXER_LOG_PREFIX} Dedupe disabled for this request; returning ${baseResults.length} raw results`);
      }

      finalNzbResults = baseResults
        .filter((result, index) => {
          if (!result.downloadUrl || !result.indexerId) {
            console.warn(`${INDEXER_LOG_PREFIX} Skipping NZB result ${index} missing required fields`, {
              hasDownloadUrl: !!result.downloadUrl,
              hasIndexerId: !!result.indexerId,
              title: result.title
            });
            return false;
          }
          return true;
        })
        .map((result) => ({ ...result, _sourceType: 'nzb' }));

      // Wait for Easynews results if search was started
      // Easynews gets 7s from its start if other searches are done, otherwise waits with them
      const easynewsWaitStartTs = Date.now();
      if (easynewsPromise) {
        console.log('[EASYNEWS] Waiting for parallel Easynews search to complete');
        const easynewsElapsedMs = Date.now() - (easynewsSearchStartTs || easynewsWaitStartTs);
        const remainingMs = Math.max(0, easynewsService.EASYNEWS_SEARCH_STANDALONE_TIMEOUT_MS - easynewsElapsedMs);
        let easynewsResults = [];
        try {
          easynewsResults = await Promise.race([
            easynewsPromise,
            new Promise((resolve) => setTimeout(() => resolve([]), remainingMs)),
          ]);
        } catch (err) {
          console.warn('[EASYNEWS] Search timed out or failed', err?.message || err);
        }
        console.log(`[EASYNEWS] Easynews search completed in ${Date.now() - easynewsWaitStartTs} ms`);
        if (Array.isArray(easynewsResults) && easynewsResults.length > 0) {
          console.log('[EASYNEWS] Adding results to final list', { count: easynewsResults.length });
          easynewsResults.forEach((item) => {
            const enriched = {
              ...item,
              _sourceType: 'easynews',
              indexer: item.indexer || 'Easynews',
              indexerId: item.indexerId || 'easynews',
            };
            finalNzbResults.push(enriched);
          });
        }
      }

      console.log(`${INDEXER_LOG_PREFIX} Final NZB selection: ${finalNzbResults.length} results`, { elapsedMs: Date.now() - requestStartTs });
    }

    const effectiveMaxSizeBytes = (() => {
      const overrideBytes = triageOverrides.maxSizeBytes;
      const defaultBytes = INDEXER_MAX_RESULT_SIZE_BYTES;
      const normalizedOverride = Number.isFinite(overrideBytes) && overrideBytes > 0 ? overrideBytes : null;
      const normalizedDefault = Number.isFinite(defaultBytes) && defaultBytes > 0 ? defaultBytes : null;
      if (normalizedOverride && normalizedDefault) {
        return Math.min(normalizedOverride, normalizedDefault);
      }
      return normalizedOverride || normalizedDefault || null;
    })();
    const resolvedPreferredLanguages = resolvePreferredLanguages(triageOverrides.preferredLanguages, INDEXER_PREFERRED_LANGUAGES);
    const activeSortMode = triageOverrides.sortMode || INDEXER_SORT_MODE;
    const resolvedSortOrder = INDEXER_SORT_ORDER.length > 0
      ? INDEXER_SORT_ORDER
      : (activeSortMode === 'language_quality_size'
        ? ['language', 'resolution', 'size']
        : ['resolution', 'size']);
    const effectiveSortMode = resolvedSortOrder.length > 0 ? 'custom_priority' : activeSortMode;

    finalNzbResults = finalNzbResults.map((result, index) => annotateNzbResult(result, index));
    finalNzbResults = prepareSortedResults(finalNzbResults, {
      sortMode: effectiveSortMode,
      sortOrder: resolvedSortOrder,
      preferredLanguages: resolvedPreferredLanguages,
      preferredQualities: INDEXER_PREFERRED_QUALITIES,
      preferredEncodes: INDEXER_PREFERRED_ENCODES,
      preferredReleaseGroups: INDEXER_PREFERRED_RELEASE_GROUPS,
      preferredVisualTags: INDEXER_PREFERRED_VISUAL_TAGS,
      preferredAudioTags: INDEXER_PREFERRED_AUDIO_TAGS,
      preferredKeywords: INDEXER_PREFERRED_KEYWORDS,
      maxSizeBytes: effectiveMaxSizeBytes,
      releaseExclusions: RELEASE_EXCLUSIONS,
      allowedResolutions: ALLOWED_RESOLUTIONS,
      resolutionLimitPerQuality: RESOLUTION_LIMIT_PER_QUALITY,
    });
    if (dedupeEnabled) {
      finalNzbResults = dedupeResultsByTitle(finalNzbResults);
    }

    if (triagePrewarmPromise) {
      await triagePrewarmPromise;
      triagePrewarmPromise = null;
    }

    const logTopLanguages = () => {
      // const sample = finalNzbResults.slice(0, 10).map((result, idx) => ({
      //   rank: idx + 1,
      //   title: result.title,
      //   indexer: result.indexer,
      //   resolution: result.resolution || result.release?.resolution || null,
      //   sizeGb: result.size ? (result.size / (1024 * 1024 * 1024)).toFixed(2) : null,
      //   languages: result.release?.languages || [],
      //   indexerLanguage: result.language || null,
      //   preferredMatches: resolvedPreferredLanguages.length > 0 ? getPreferredLanguageMatches(result, resolvedPreferredLanguages) : [],
      // }));
      // console.log('[LANGUAGE] Top stream ordering sample', sample);
    };
    logTopLanguages();
    const allowedCacheStatuses = TRIAGE_FINAL_STATUSES;
    const requestedDisable = triageOverrides.disabled === true;
    const requestedEnable = triageOverrides.enabled === true;
    const overrideIndexerTokens = (triageOverrides.indexers && triageOverrides.indexers.length > 0)
      ? triageOverrides.indexers
      : null;
    const directPaidTokens = overrideIndexerTokens ? [] : getPaidDirectIndexerTokens();
    const managerHealthTokens = INDEXER_MANAGER === 'none'
      ? []
      : (TRIAGE_PRIORITY_INDEXERS.length > 0 ? TRIAGE_PRIORITY_INDEXERS : TRIAGE_HEALTH_INDEXERS);
    let combinedHealthTokens = [];
    if (overrideIndexerTokens) {
      combinedHealthTokens = [...overrideIndexerTokens];
    } else {
      if (managerHealthTokens && managerHealthTokens.length > 0) {
        combinedHealthTokens = [...managerHealthTokens];
      }
      if (directPaidTokens.length > 0) {
        combinedHealthTokens = combinedHealthTokens.concat(directPaidTokens);
      }
    }
    // Check if Easynews should be treated as indexer
    const EASYNEWS_TREAT_AS_INDEXER = toBoolean(process.env.EASYNEWS_TREAT_AS_INDEXER, false);
    if (EASYNEWS_TREAT_AS_INDEXER) {
      const easynewsToken = 'easynews';
      const normalizedTokens = new Set((combinedHealthTokens || []).map((token) => normalizeIndexerToken(token)).filter(Boolean));
      if (!normalizedTokens.has(easynewsToken)) {
        combinedHealthTokens = [...combinedHealthTokens, easynewsToken];
      }
    }

    const serializedIndexerTokens = TRIAGE_SERIALIZED_INDEXERS.length > 0
      ? TRIAGE_SERIALIZED_INDEXERS
      : combinedHealthTokens;
    const healthIndexerSet = new Set((combinedHealthTokens || []).map((token) => normalizeIndexerToken(token)).filter(Boolean));
    console.log(`[NZB TRIAGE] Easynews health check mode: ${EASYNEWS_TREAT_AS_INDEXER ? 'ENABLED' : 'DISABLED'}`);

    const triagePool = healthIndexerSet.size > 0
      ? finalNzbResults.filter((result) => {
        // Include regular indexer matches
        if (nzbMatchesIndexer(result, healthIndexerSet)) {
          return true;
        }
        // Include Easynews if flag is enabled
        if (EASYNEWS_TREAT_AS_INDEXER && result._sourceType === 'easynews') {
          console.log(`[NZB TRIAGE] Including Easynews result in triage pool: ${result.title}`);
          return true;
        }
        return false;
      })
      : [];
    console.log(`[NZB TRIAGE] Triage pool size: ${triagePool.length} (from ${finalNzbResults.length} total results)`);
    const getDecisionStatus = (candidate) => {
      const decision = triageDecisions.get(candidate.downloadUrl);
      return decision && decision.status ? String(decision.status).toLowerCase() : null;
    };
    const pendingStatuses = new Set(['unverified', 'pending']);
    const hasPendingRetries = triagePool.some((candidate) => pendingStatuses.has(getDecisionStatus(candidate)));
    const hasVerifiedResult = triagePool.some((candidate) => getDecisionStatus(candidate) === 'verified');
    let triageEligibleResults = [];
    const paidIndexerLimitMap = buildCombinedLimitMap(ACTIVE_NEWZNAB_CONFIGS);
    const getIndexerKey = (candidate) => normalizeIndexerToken(candidate?.indexerId || candidate?.indexer);

    if (hasPendingRetries) {
      triageEligibleResults = prioritizeTriageCandidates(triagePool, TRIAGE_MAX_CANDIDATES, {
        shouldInclude: (candidate) => pendingStatuses.has(getDecisionStatus(candidate)),
        perIndexerLimitMap: paidIndexerLimitMap,
        getIndexerKey,
      });
    } else if (!hasVerifiedResult) {
      triageEligibleResults = prioritizeTriageCandidates(triagePool, TRIAGE_MAX_CANDIDATES, {
        shouldInclude: (candidate) => !getDecisionStatus(candidate),
        perIndexerLimitMap: paidIndexerLimitMap,
        getIndexerKey,
      });
    }

    if (triageEligibleResults.length === 0 && triageDecisions.size === 0) {
      triageEligibleResults = prioritizeTriageCandidates(triagePool, TRIAGE_MAX_CANDIDATES, {
        perIndexerLimitMap: paidIndexerLimitMap,
        getIndexerKey,
      });
    }
    const candidateHasConclusiveDecision = (candidate) => {
      const decision = triageDecisions.get(candidate.downloadUrl);
      if (decision && isTriageFinalStatus(decision.status)) {
        return true;
      }
      const normalizedTitle = normalizeReleaseTitle(candidate.title);
      if (normalizedTitle) {
        const derived = triageTitleMap.get(normalizedTitle);
        if (
          derived
          && isTriageFinalStatus(derived.status)
          && indexerService.canShareDecision(derived.publishDateMs, candidate.publishDateMs)
        ) {
          return true;
        }
      }
      return false;
    };
    const categoryForType = STREAMING_MODE !== 'native' ? nzbdavService.getNzbdavCategory(type) : null;
    const triageCandidatesToRun = triageEligibleResults.filter((candidate) => !candidateHasConclusiveDecision(candidate));
    const shouldSkipTriageForRequest = requestLacksIdentifiers || isSpecialRequest;
    const shouldAttemptTriage = triageCandidatesToRun.length > 0 && !requestedDisable && !shouldSkipTriageForRequest && (requestedEnable || TRIAGE_ENABLED);
    let triageOutcome = null;
    let triageCompleteForCache = !shouldAttemptTriage;
    let prefetchCandidate = null;
    let prefetchNzbPayload = null;

    if (shouldAttemptTriage) {
      if (!TRIAGE_NNTP_CONFIG) {
        console.warn('[NZB TRIAGE] Skipping health checks because NNTP configuration is missing');
      } else {
        const triageLogger = (level, message, context) => {
          const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
          if (context) logFn(`[NZB TRIAGE] ${message}`, context);
          else logFn(`[NZB TRIAGE] ${message}`);
        };
        const triageOptions = {
          allowedIndexerIds: combinedHealthTokens,
          preferredIndexerIds: combinedHealthTokens, // Use same indexers for filtering and ranking
          serializedIndexerIds: serializedIndexerTokens,
          timeBudgetMs: TRIAGE_TIME_BUDGET_MS,
          maxCandidates: TRIAGE_MAX_CANDIDATES,
          downloadConcurrency: Math.max(1, TRIAGE_MAX_CANDIDATES),
          triageOptions: {
            ...TRIAGE_BASE_OPTIONS,
            nntpConfig: { ...TRIAGE_NNTP_CONFIG },
          },
          captureNzbPayloads: true,
          logger: triageLogger,
        };
        try {
          triageOutcome = await triageAndRank(triageCandidatesToRun, triageOptions);
          const latestDecisions = triageOutcome?.decisions instanceof Map ? triageOutcome.decisions : new Map(triageOutcome?.decisions || []);
          latestDecisions.forEach((decision, downloadUrl) => {
            triageDecisions.set(downloadUrl, decision);
          });
          triageTitleMap = buildTriageTitleMap(triageDecisions);
          console.log(`[NZB TRIAGE] Evaluated ${triageOutcome.evaluatedCount}/${triageOutcome.candidatesConsidered} candidate NZBs in ${triageOutcome.elapsedMs} ms (timedOut=${triageOutcome.timedOut})`);
          if (triageDecisions.size > 0) {
            const statusCounts = {};
            let loggedSamples = 0;
            const sampleLimit = 5;
            const logDecisionSamples = false;
            triageDecisions.forEach((decision, downloadUrl) => {
              const status = decision?.status || 'unknown';
              statusCounts[status] = (statusCounts[status] || 0) + 1;
              if (logDecisionSamples && loggedSamples < sampleLimit) {
                console.log('[NZB TRIAGE] Decision sample', {
                  status,
                  blockers: decision?.blockers || [],
                  warnings: decision?.warnings || [],
                  fileCount: decision?.fileCount ?? null,
                  nzbIndex: decision?.nzbIndex ?? null,
                  downloadUrl
                });
                loggedSamples += 1;
              }
            });
            if (logDecisionSamples && triageDecisions.size > sampleLimit) {
              console.log(`[NZB TRIAGE] (${triageDecisions.size - sampleLimit}) additional decisions omitted from sample log`);
            }
            console.log('[NZB TRIAGE] Decision status breakdown', statusCounts);
          } else {
            console.log('[NZB TRIAGE] No decisions were produced by the triage runner');
          }
        } catch (triageError) {
          console.warn(`[NZB TRIAGE] Health check failed: ${triageError.message}`);
        }
      }
    } else if (shouldSkipTriageForRequest && TRIAGE_ENABLED && !requestedDisable) {
      const reason = isSpecialRequest
        ? 'special catalog request'
        : 'non-ID request (no IMDb/TVDB identifier)';
      console.log(`[NZB TRIAGE] Skipping health checks for ${reason}`);
    }

    if (shouldAttemptTriage) {
      triageCompleteForCache = Boolean(
        triageOutcome
        && !triageOutcome?.timedOut
        && triageDecisionsMatchStatuses(triageDecisions, triageEligibleResults, allowedCacheStatuses)
      );
    }

    if (triageCompleteForCache && shouldAttemptTriage) {
      triageEligibleResults.forEach((candidate) => {
        const decision = triageDecisions.get(candidate.downloadUrl);
        if (decision && decision.status === 'verified' && typeof decision.nzbPayload === 'string') {
          cache.cacheVerifiedNzbPayload(candidate.downloadUrl, decision.nzbPayload, {
            title: decision.title || candidate.title,
            size: candidate.size,
            fileName: candidate.title,
          });
          if (!prefetchCandidate && STREAMING_MODE !== 'native') {
            prefetchCandidate = {
              downloadUrl: candidate.downloadUrl,
              title: candidate.title,
              category: categoryForType,
              requestedEpisode,
            };
          }
        }
        if (decision && decision.nzbPayload) {
          delete decision.nzbPayload;
        }
      });
    } else if (triageDecisions && triageDecisions.size > 0) {
      triageDecisions.forEach((decision) => {
        if (decision && decision.nzbPayload) {
          delete decision.nzbPayload;
        }
      });
    }

    // If prefetch is enabled, capture first verified NZB payload even when triage cache completion criteria aren’t met
    if (TRIAGE_PREFETCH_FIRST_VERIFIED && STREAMING_MODE !== 'native' && !prefetchCandidate && triageDecisions && triageDecisions.size > 0) {
      for (const candidate of triageEligibleResults) {
        const decision = triageDecisions.get(candidate.downloadUrl);
        if (decision && decision.status === 'verified' && typeof decision.nzbPayload === 'string') {
          prefetchCandidate = {
            downloadUrl: candidate.downloadUrl,
            title: candidate.title,
            category: categoryForType,
            requestedEpisode,
          };
          prefetchNzbPayload = decision.nzbPayload;
          cache.cacheVerifiedNzbPayload(candidate.downloadUrl, decision.nzbPayload, {
            title: decision.title || candidate.title,
            size: candidate.size,
            fileName: candidate.title,
          });
          delete decision.nzbPayload;
          break;
        }
      }
    }

    // NZBDav cache cleanup is now handled automatically by the cache module

    const triagePendingDownloadUrls = triageEligibleResults
      .filter((candidate) => !candidateHasConclusiveDecision(candidate))
      .map((candidate) => candidate.downloadUrl);
    const cacheReadyDecisionEntries = Array.from(triageDecisions.entries())
      .map(([downloadUrl, decision]) => {
        const sanitized = sanitizeDecisionForCache(decision);
        return sanitized ? [downloadUrl, sanitized] : null;
      })
      .filter(Boolean);
    const cacheMeta = streamCacheKey
      ? {
        version: 1,
        storedAt: Date.now(),
        triageComplete: !triageOutcome?.timedOut && triagePendingDownloadUrls.length === 0,
        triagePendingDownloadUrls,
        finalNzbResults: serializeFinalNzbResults(finalNzbResults),
        triageDecisionsSnapshot: cacheReadyDecisionEntries,
      }
      : null;

    // Skip NZBDav history fetching in native streaming mode
    let historyByTitle = new Map();
    if (STREAMING_MODE !== 'native') {
      try {
        historyByTitle = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType]);
        if (historyByTitle.size > 0) {
          console.log(`[NZBDAV] Loaded ${historyByTitle.size} completed NZBs for instant playback detection (category=${categoryForType})`);
        }
      } catch (historyError) {
        console.warn(`[NZBDAV] Unable to load NZBDav history for instant detection: ${historyError.message}`);
      }
    }

    let triageLogCount = 0;
    let triageLogSuppressed = false;
    const activePreferredLanguages = resolvedPreferredLanguages;

    const instantStreams = [];
    const verifiedStreams = [];
    const regularStreams = [];

    finalNzbResults.forEach((result) => {
      // Skip releases matching blocklist (ISO, sample, exe, etc.)
      if (result.title && RELEASE_BLOCKLIST_REGEX.test(result.title)) {
        return;
      }

      const sizeInGB = result.size ? (result.size / 1073741824).toFixed(2) : null;
      const sizeString = sizeInGB ? `${sizeInGB} GB` : 'Size Unknown';
      const releaseInfo = result.release || {};
      const releaseLanguages = Array.isArray(releaseInfo.languages) ? releaseInfo.languages : [];
      const releaseLanguageLabels = resolveLanguageLabels(releaseLanguages);
      const sourceLanguage = result.language || null;
      const sourceLanguageLabel = resolveLanguageLabel(sourceLanguage);
      const qualityMatch = result.title?.match(/(4320p|2160p|1440p|1080p|720p|576p|540p|480p|360p|240p|8k|4k|uhd)/i);
      const detectedResolutionToken = result.resolution
        || releaseInfo.resolution
        || (qualityMatch ? normalizeResolutionToken(qualityMatch[0]) : null);
      const resolutionBadge = formatResolutionBadge(detectedResolutionToken);
      const rawQualityLabel = result.qualityLabel || releaseInfo.qualityLabel || null;
      const qualityLabel = rawQualityLabel && String(rawQualityLabel).toLowerCase() !== String(detectedResolutionToken || '').toLowerCase()
        ? rawQualityLabel
        : null;
      const featureBadges = extractQualityFeatureBadges(result.title || '');
      const qualityParts = [];
      if (resolutionBadge) qualityParts.push(resolutionBadge);
      if (qualityLabel) qualityParts.push(qualityLabel);
      featureBadges.forEach((badge) => {
        if (!qualityParts.includes(badge)) qualityParts.push(badge);
      });
      const qualitySummary = qualityParts.join(' ');
      const quality = qualityLabel || '';
      const languageLabel = releaseLanguageLabels.length > 0
        ? releaseLanguageLabels.join(', ')
        : (sourceLanguageLabel || null);
      const preferredLanguageMatches = activePreferredLanguages.length > 0
        ? getPreferredLanguageMatches(result, activePreferredLanguages)
        : [];
      const preferredLanguageLabels = resolveLanguageLabels(preferredLanguageMatches.map(resolveLanguageLabel));
      const matchedPreferredLanguage = preferredLanguageLabels.length > 0 ? preferredLanguageLabels[0] : null;
      const preferredLanguageHit = preferredLanguageMatches.length > 0;

      const baseParams = new URLSearchParams({
        indexerId: String(result.indexerId),
        type,
        id
      });

      baseParams.set('downloadUrl', result.downloadUrl);
      if (result.guid) baseParams.set('guid', result.guid);
      if (result.size) baseParams.set('size', String(result.size));
      if (result.title) baseParams.set('title', result.title);
      if (result.easynewsPayload) baseParams.set('easynewsPayload', result.easynewsPayload);
      if (result._sourceType) baseParams.set('sourceType', result._sourceType);

      const cacheKey = nzbdavService.buildNzbdavCacheKey(result.downloadUrl, categoryForType, requestedEpisode);
      // Cache entries are managed internally by the cache module
      const normalizedTitle = normalizeReleaseTitle(result.title);
      const historySlot = normalizedTitle ? historyByTitle.get(normalizedTitle) : null;
      const isInstant = Boolean(historySlot); // Instant playback if found in history

      const directTriageInfo = triageDecisions.get(result.downloadUrl);
      const fallbackTitleKey = normalizedTitle;
      const fallbackTriageInfo = !directTriageInfo && fallbackTitleKey ? triageTitleMap.get(fallbackTitleKey) : null;
      const fallbackAllowed = fallbackTriageInfo
        ? indexerService.canShareDecision(fallbackTriageInfo.publishDateMs, result.publishDateMs)
        : false;
      const triageInfo = directTriageInfo || (fallbackAllowed ? fallbackTriageInfo : null);
      const triageApplied = Boolean(directTriageInfo);
      const triageDerivedFromTitle = Boolean(!directTriageInfo && fallbackAllowed && fallbackTriageInfo);
      const triageStatus = triageInfo?.status || (triageApplied ? 'unknown' : 'not-run');
      if (INDEXER_HIDE_BLOCKED_RESULTS && triageStatus === 'blocked') {
        if (triageInfo) {
          // console.log('[STREMIO][TRIAGE] Hiding blocked stream', {
          //   title: result.title,
          //   downloadUrl: result.downloadUrl,
          //   indexer: result.indexer,
          //   blockers: triageInfo.blockers || [],
          //   warnings: triageInfo.warnings || [],
          //   archiveFindings: triageInfo.archiveFindings || [],
          // });
        } else {
          // console.log('[STREMIO][TRIAGE] Hiding blocked stream with missing triageInfo', {
          //   title: result.title,
          //   downloadUrl: result.downloadUrl,
          //   indexer: result.indexer,
          // });
        }
        return;
      }
      let triagePriority = 1;
      let triageTag = null;

      if (triageStatus === 'verified') {
        triagePriority = 0;
        triageTag = '✅';
      } else if (triageStatus === 'unverified' || triageStatus === 'unverified_7z') {
        triageTag = '⚠️';
      } else if (triageStatus === 'blocked') {
        triagePriority = 2;
        triageTag = '🚫';
      } else if (triageStatus === 'fetch-error') {
        triagePriority = 2;
        triageTag = '⚠️';
      } else if (triageStatus === 'error') {
        triagePriority = 2;
        triageTag = '⚠️';
      } else if (triageStatus === 'pending' || triageStatus === 'skipped') {
        if (triageOutcome?.timedOut) triageTag = '⏱️';
      }

      const archiveFindings = triageInfo?.archiveFindings || [];
      const archiveStatuses = archiveFindings.map((finding) => String(finding?.status || '').toLowerCase());
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
      const passedArchiveCheck = archiveStatuses.some((status) => status === 'rar-stored' || status === 'sevenzip-stored');
      const failedArchiveCheck = (triageInfo?.blockers || []).some((blocker) => archiveFailureTokens.has(blocker))
        || archiveStatuses.some((status) => archiveFailureTokens.has(status));
      let archiveCheckStatus = 'not-run';
      if (triageInfo) {
        if (failedArchiveCheck) archiveCheckStatus = 'failed';
        else if (passedArchiveCheck) archiveCheckStatus = 'passed';
        else if (archiveFindings.length > 0) archiveCheckStatus = 'inconclusive';
      }

      const missingArticlesFailure = (triageInfo?.blockers || []).includes('missing-articles')
        || archiveStatuses.includes('segment-missing');
      const missingArticlesSuccess = archiveStatuses.includes('segment-ok')
        || archiveStatuses.includes('sevenzip-untested');
      let missingArticlesStatus = 'not-run';
      if (triageInfo) {
        if (missingArticlesFailure) missingArticlesStatus = 'failed';
        else if (missingArticlesSuccess) missingArticlesStatus = 'passed';
        else if (archiveFindings.length > 0) missingArticlesStatus = 'inconclusive';
      }

      if (triageApplied || triageDerivedFromTitle) {
        // console.log('[STREMIO][TRIAGE] Stream decision', {
        //   title: result.title,
        //   downloadUrl: result.downloadUrl,
        //   indexer: result.indexer,
        //   triageStatus,
        //   triageApplied,
        //   triageDerivedFromTitle,
        //   blockers: triageInfo?.blockers || [],
        //   warnings: triageInfo?.warnings || [],
        //   archiveFindings,
        //   archiveCheckStatus,
        //   missingArticlesStatus,
        //   timedOut: Boolean(triageOutcome?.timedOut),
        //   decisionSource: triageApplied ? 'direct' : 'title-fallback',
        // });
      }

      if (historySlot?.nzoId) {
        baseParams.set('historyNzoId', historySlot.nzoId);
        if (historySlot.jobName) {
          baseParams.set('historyJobName', historySlot.jobName);
        }
        if (historySlot.category) {
          baseParams.set('historyCategory', historySlot.category);
        }
      }

      const tokenSegment = ADDON_SHARED_SECRET ? `/${ADDON_SHARED_SECRET}` : '';
      const rawFilename = (result.title || 'stream').toString().trim();
      const normalizedFilename = rawFilename
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const fileBase = normalizedFilename || 'stream';
      const hasVideoExt = /\.(mkv|mp4|m4v|avi|mov|wmv|mpg|mpeg|ts|webm)$/i.test(fileBase);
      const fileWithExt = hasVideoExt ? fileBase : `${fileBase}.mkv`;
      const encodedFilename = encodeURIComponent(fileWithExt);
      const streamUrl = `${addonBaseUrl}${tokenSegment}/nzb/stream/${encodeStreamParams(baseParams)}/${encodedFilename}`;
      const tags = [];
      if (triageTag) tags.push(triageTag);
      if (isInstant && STREAMING_MODE !== 'native') tags.push('⚡ Instant');
      if (preferredLanguageLabels.length > 0) {
        preferredLanguageLabels.forEach((language) => tags.push(language));
      }
      // quality summary now part of name; keep tags focused on status/language/size
      if (languageLabel) tags.push(`🌐 ${languageLabel}`);
      if (sizeString) tags.push(sizeString);
      const addonLabel = ADDON_NAME || DEFAULT_ADDON_NAME;

      const tagsString = tags.filter(Boolean).join(' • ');

      const namingContext = {
        addon: addonLabel,
        title: result.parsedTitleDisplay || result.parsedTitle || result.title || '',
        filename: normalizedFilename || '',
        indexer: result.indexer || '',
        size: sizeString || '',
        quality: quality || '',
        source: result.source || releaseInfo.source || '',
        codec: result.codec || releaseInfo.codec || '',
        group: result.group || releaseInfo.group || '',
        health: triageTag || '',
        languages: languageLabel || '',
        tags: tagsString,
        resolution: detectedResolutionToken || result.resolution || releaseInfo.resolution || '',
        container: result.container || releaseInfo.container || '',
        hdr: (result.hdrList || releaseInfo.hdrList || []).join(' | '),
        audio: (result.audioList || releaseInfo.audioList || []).join(' '),
      };

      // Add nested context for AIOStreams template compatibility
      // We map our flat properties to the expected 'stream' object
      namingContext.stream = {
        proxied: true, // We proxy everything via NZBDav/Stremio
        private: false, // Public Usenet
        resolution: namingContext.resolution,
        upscaled: false, // We don't detect upscaling yet
        quality: namingContext.quality,
        qualitySummary,
        streamQuality: namingContext.quality,
        resolutionQuality: qualitySummary || namingContext.resolution,
        encode: namingContext.codec,
        type: type || 'movie',
        visualTags: (result.hdrList || releaseInfo.hdrList || []),
        audioTags: (result.audioList || releaseInfo.audioList || []),
        audioChannels: [], // Not strictly parsed yet, usually part of audioTags
        seeders: 0, // Usenet doesn't have seeders
        size: result.size || 0, // Raw bytes
        folderSize: 0,
        indexer: namingContext.indexer,
        languages: releaseLanguageLabels.length > 0 ? releaseLanguageLabels : (sourceLanguageLabel ? [sourceLanguageLabel] : []),
        network: '', // Not strictly tracked
        title: namingContext.title,
        filename: namingContext.filename,
        message: namingContext.health, // Map health status to message
        health: namingContext.health, // Alias for clear naming
        releaseGroup: namingContext.group, // AIOStreams uses releaseGroup
        // Additional mappings
        shortName: namingContext.indexer,
        cached: isInstant || Boolean(triageTag && triageTag.includes('✅')),
        instant: isInstant
      };

      // Service context (representing the provider/addon logic)
      namingContext.service = {
        shortName: 'Usenet',
        cached: isInstant || Boolean(triageTag && triageTag.includes('✅')),
        instant: isInstant
      };

      // Addon context
      namingContext.addon = {
        name: addonLabel
      };

      const buildPatternFromTokenList = (rawPattern, variant, defaultPattern) => {
        if (rawPattern && typeof rawPattern === 'string' && rawPattern.includes('{')) {
          return rawPattern;
        }
        const hasLineBreaks = /[\r\n]/.test(String(rawPattern || ''));
        const normalizedList = String(rawPattern || '')
          .replace(/\band\b/gi, ',')
          .replace(/[;|]/g, ',');
        const tokens = normalizedList
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean);
        if (!hasLineBreaks && tokens.length === 0) return defaultPattern;

        const shortTokenMap = {
          addon: '{addon.name}',
          title: '{stream.title::exists["{stream.title}"||""]}',
          instant: '{stream.instant::istrue["⚡"||""]}',
          health: '{stream.health::exists["{stream.health}"||""]}',
          quality: '{stream.resolutionQuality::exists["{stream.resolutionQuality}"||""]}',
          resolution_quality: '{stream.resolutionQuality::exists["{stream.resolutionQuality}"||""]}',
          stream_quality: '{stream.streamQuality::exists["{stream.streamQuality}"||""]}',
          resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
          source: '{stream.source::exists["{stream.source}"||""]}',
          codec: '{stream.encode::exists["{stream.encode}"||""]}',
          group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
          size: '{stream.size::>0["{stream.size::bytes}"||""]}',
          languages: '{stream.languages::join(" ")::exists["{stream.languages::join(\" \")}"||""]}',
          indexer: '{stream.indexer::exists["{stream.indexer}"||""]}',
          filename: '{stream.filename::exists["{stream.filename}"||""]}',
          tags: '{tags::exists["{tags}"||""]}',
        };

        const longTokenMap = {
          title: '{stream.title::exists["🎬 {stream.title}"||""]}',
          filename: '{stream.filename::exists["📄 {stream.filename}"||""]}',
          source: '{stream.source::exists["🎥 {stream.source}"||""]}',
          codec: '{stream.encode::exists["🎞️ {stream.encode}"||""]}',
          resolution: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
          visual: '{stream.visualTags::join(" | ")::exists["📺 {stream.visualTags::join(\" | \")}"||""]}',
          audio: '{stream.audioTags::join(" ")::exists["🎧 {stream.audioTags::join(\" \")}"||""]}',
          group: '{stream.releaseGroup::exists["👥 {stream.releaseGroup}"||""]}',
          size: '{stream.size::>0["📦 {stream.size::bytes}"||""]}',
          languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
          indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
          health: '{stream.health::exists["🧪 {stream.health}"||""]}',
          instant: '{stream.instant::istrue["⚡ Instant"||""]}',
          quality: '{stream.resolutionQuality::exists["✨ {stream.resolutionQuality}"||""]}',
          resolution_quality: '{stream.resolutionQuality::exists["✨ {stream.resolutionQuality}"||""]}',
          stream_quality: '{stream.streamQuality::exists["✨ {stream.streamQuality}"||""]}',
          tags: '{tags::exists["🏷️ {tags}"||""]}',
        };

        const tokenMap = variant === 'long' ? longTokenMap : shortTokenMap;

        if (hasLineBreaks) {
          const lines = String(rawPattern || '').split(/\r?\n/);
          const lineParts = lines.map((line) => {
            const normalizedLine = String(line || '')
              .replace(/\band\b/gi, ',')
              .replace(/[;|]/g, ',');
            const lineTokens = normalizedLine
              .split(',')
              .map((token) => token.trim())
              .filter(Boolean);
            return lineTokens
              .map((token) => tokenMap[token.toLowerCase()] || null)
              .filter(Boolean)
              .join(' ');
          });
          const separator = variant === 'long' ? '\n' : ' ';
          const joined = lineParts.join(separator);
          if (joined.replace(/\s/g, '') === '') return defaultPattern;
          return joined;
        }

        const parts = tokens
          .map((token) => tokenMap[token.toLowerCase()] || null)
          .filter(Boolean);

        if (parts.length === 0) return defaultPattern;
        return parts.join(' ');
      };

      // Default AIOStreams template
      const defaultDescriptionPattern = '{stream.title::exists["🎬 {stream.title}\n"||""]}{stream.source::exists["🎥 {stream.source} "||""]}{stream.encode::exists["🎞️ {stream.encode}\n"||"\n"]}{stream.visualTags::join(\' | \')::exists["📺 {stream.visualTags::join(\' | \')}\n"||""]}{stream.audioTags::join(\' \')::exists["🎧 {stream.audioTags::join(\' \')}\n"||""]}{stream.releaseGroup::exists["👥 {stream.releaseGroup}\n"||""]}{stream.size::>0["📦 {stream.size::bytes}\n"||""]}{stream.languages::join(\' \')::exists["🌎 {stream.languages::join(\' \')}\n"||""]}{stream.indexer::exists["🔎 {stream.indexer}"||""]}';
      const effectiveDefaultDescriptionPattern = `{stream.title::exists["🎬 {stream.title}\n"||""]}{stream.streamQuality::exists["✨ {stream.streamQuality}\n"||""]}{stream.source::exists["🎥 {stream.source}\n"||""]}{stream.encode::exists["🎞️ {stream.encode}\n"||""]}{stream.visualTags::join(" | ")::exists["📺 {stream.visualTags::join(\" | \")}\n"||""]}{stream.audioTags::join(" ")::exists["🎧 {stream.audioTags::join(\" \")}\n"||""]}{stream.releaseGroup::exists["👥 {stream.releaseGroup}\n"||""]}{stream.size::>0["📦 {stream.size::bytes}\n"||""]}{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}\n"||""]}{stream.indexer::exists["🔎 {stream.indexer}\n"||""]}{stream.health::exists["🧪 {stream.health}"||""]}`;
      const effectiveDescriptionPattern = buildPatternFromTokenList(NZB_NAMING_PATTERN, 'long', effectiveDefaultDescriptionPattern);
      const formattedTitle = formatStreamTitle(effectiveDescriptionPattern, namingContext, effectiveDefaultDescriptionPattern);

      const defaultNamePattern = '{addon.name} {stream.health::exists["{stream.health} "||""]}{stream.instant::istrue["⚡ "||""]}{stream.resolution::exists["{stream.resolution}"||""]}';
      const effectiveDefaultNamePattern = '{addon.name} {stream.health::exists["{stream.health} "||""]}{stream.instant::istrue["⚡ "||""]}{stream.resolution::exists["{stream.resolution}"||""]}';
      const effectiveNamePattern = buildPatternFromTokenList(NZB_DISPLAY_NAME_PATTERN, 'short', effectiveDefaultNamePattern);
      const formattedName = formatStreamTitle(effectiveNamePattern, namingContext, effectiveDefaultNamePattern);

      // Build behavior hints based on streaming mode
      let behaviorHints;
      if (STREAMING_MODE === 'native') {
        // Native mode: minimal behaviorHints for Stremio v5 native NZB streaming
        behaviorHints = {
          bingeGroup: `usenetstreamer-${detectedResolutionToken || 'unknown'}`,
          videoSize: result.size || undefined,
          filename: result.title || undefined,
        };
      } else {
        // NZBDav mode: WebDAV-based streaming
        behaviorHints = {
          notWebReady: true,
          filename: result.title || undefined,
        };
        if (isInstant) {
          behaviorHints.cached = true;
          if (historySlot) {
            behaviorHints.cachedFromHistory = true;
          }
        }
      }

      if (triageApplied && triageLogCount < 10) {
        const archiveSampleEntries = [];
        (triageInfo?.archiveFindings || []).forEach((finding) => {
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
        // console.log('[NZB TRIAGE] Stream candidate status', {
        //   title: result.title,
        //   downloadUrl: result.downloadUrl,
        //   status: triageStatus,
        //   triageApplied,
        //   triagePriority,
        //   blockers: triageInfo?.blockers || [],
        //   warnings: triageInfo?.warnings || [],
        //   archiveFindings: triageInfo?.archiveFindings || [],
        //   archiveSampleEntries,
        //   archiveCheckStatus,
        //   missingArticlesStatus,
        //   timedOut: Boolean(triageOutcome?.timedOut)
        // });
        triageLogCount += 1;
      } else if (!triageApplied) {
        // Skip logging for streams that were never part of the triage batch
      } else if (!triageLogSuppressed) {
        console.log('[NZB TRIAGE] Additional stream triage logs suppressed');
        triageLogSuppressed = true;
      }

      // Build the stream object based on streaming mode
      let stream;
      if (STREAMING_MODE === 'native') {
        // Native mode: Stremio v5 native NZB streaming
        const nntpServers = buildNntpServersArray();
        stream = {
          name: formattedName,
          description: formattedTitle,
          nzbUrl: result.downloadUrl,
          servers: nntpServers.length > 0 ? nntpServers : undefined,
          url: undefined,
          infoHash: undefined,
          behaviorHints,
        };
      } else {
        // NZBDav mode: WebDAV-based streaming
        stream = {
          title: formattedTitle,
          name: formattedName,
          url: streamUrl,
          behaviorHints,
          meta: {
            originalTitle: result.title,
            indexer: result.indexer,
            size: result.size,
            quality,
            age: result.age,
            type: 'nzb',
            cached: Boolean(isInstant),
            cachedFromHistory: Boolean(historySlot),
            languages: releaseLanguages,
            indexerLanguage: sourceLanguage,
            resolution: detectedResolutionToken || null,
            preferredLanguageMatch: preferredLanguageHit,
            preferredLanguageName: matchedPreferredLanguage,
            preferredLanguageNames: preferredLanguageMatches,
          }
        };

        // Add health check metadata for NZBDav mode
        if (triageTag || triageInfo || triageOutcome?.timedOut || !triageApplied) {
          if (triageInfo) {
            stream.meta.healthCheck = {
              status: triageStatus,
              blockers: triageInfo.blockers || [],
              warnings: triageInfo.warnings || [],
              fileCount: triageInfo.fileCount,
              archiveCheck: archiveCheckStatus,
              missingArticlesCheck: missingArticlesStatus,
              applied: triageApplied,
              inheritedFromTitle: triageDerivedFromTitle,
            };
            stream.meta.healthCheck.archiveFindings = archiveFindings;
            if (triageInfo.sourceDownloadUrl) {
              stream.meta.healthCheck.sourceDownloadUrl = triageInfo.sourceDownloadUrl;
            }
          } else {
            stream.meta.healthCheck = {
              status: triageOutcome?.timedOut ? 'pending' : 'not-run',
              applied: false,
            };
          }
        }
      }

      if (isInstant) {
        instantStreams.push(stream);
      } else if (triageStatus === 'verified') {
        verifiedStreams.push(stream);
      } else {
        regularStreams.push(stream);
      }

      if (preferredLanguageMatches.length > 0 || sourceLanguage || releaseLanguages.length > 0) {
        // console.log('[LANGUAGE] Stream classification', {
        //   title: result.title,
        //   preferredLanguageMatches,
        //   parserLanguages: releaseLanguages,
        //   indexerLanguage: sourceLanguage,
        //   indexer: result.indexer,
        //   indexerId: result.indexerId,
        //   preferredLanguageHit,
        // });
      }
    });

    const streams = instantStreams.concat(verifiedStreams, regularStreams);

    // Log cached streams count (only relevant for NZBDav mode)
    if (STREAMING_MODE !== 'native') {
      const instantCount = streams.filter((stream) => stream?.meta?.cached).length;
      if (instantCount > 0) {
        console.log(`[STREMIO] ${instantCount}/${streams.length} streams already cached in NZBDav`);
      }
    }

    const requestElapsedMs = Date.now() - requestStartTs;
    const modeLabel = STREAMING_MODE === 'native' ? 'native NZB' : 'NZB';
    console.log(`[STREMIO] Returning ${streams.length} ${modeLabel} streams`, { elapsedMs: requestElapsedMs, ts: new Date().toISOString() });
    if (process.env.DEBUG_STREAM_PAYLOADS === 'true') {
      streams.forEach((stream, index) => {
        console.log(`[STREMIO] Stream[${index}]`, {
          name: stream.name,
          description: stream.description,
          nzbUrl: stream.nzbUrl,
          url: stream.url,
          infoHash: stream.infoHash,
          servers: stream.servers,
          behaviorHints: stream.behaviorHints,
          hasMeta: Boolean(stream.meta),
        });
      });
    }

    const responsePayload = { streams };
    if (streamCacheKey && cacheMeta && streams.length > 0) {
      cache.setStreamCacheEntry(streamCacheKey, responsePayload, cacheMeta);
    } else if (streamCacheKey && cacheMeta) {
      console.log('[CACHE] Skipping stream cache write for empty stream payload', { type, id });
    }

    res.json(responsePayload);

    if (TRIAGE_PREFETCH_FIRST_VERIFIED && STREAMING_MODE !== 'native' && prefetchCandidate) {
      prunePrefetchedNzbdavJobs();
      if (prefetchedNzbdavJobs.has(prefetchCandidate.downloadUrl)) {
        // Prefetch already running or completed for this download URL
      } else {
        const jobPromise = new Promise((resolve, reject) => {
          setImmediate(async () => {
            try {
              const cachedEntry = cache.getVerifiedNzbCacheEntry(prefetchCandidate.downloadUrl);
              if (cachedEntry) {
                console.log('[CACHE] Using verified NZB payload for prefetch', { downloadUrl: prefetchCandidate.downloadUrl });
              }
              const added = await nzbdavService.addNzbToNzbdav({
                downloadUrl: prefetchCandidate.downloadUrl,
                cachedEntry,
                category: prefetchCandidate.category,
                jobLabel: prefetchCandidate.title,
              });
              resolve({
                nzoId: added.nzoId,
                category: prefetchCandidate.category,
                jobName: prefetchCandidate.title,
                createdAt: Date.now(),
              });
            } catch (error) {
              reject(error);
            }
          });
        });

        prefetchedNzbdavJobs.set(prefetchCandidate.downloadUrl, { promise: jobPromise, createdAt: Date.now() });

        jobPromise
          .then((jobInfo) => {
            prefetchedNzbdavJobs.set(prefetchCandidate.downloadUrl, jobInfo);
            console.log(`[NZBDAV] Prefetched first verified NZB queued (nzoId=${jobInfo.nzoId})`);
          })
          .catch((prefetchError) => {
            prefetchedNzbdavJobs.delete(prefetchCandidate.downloadUrl);
            console.warn('[NZBDAV] Prefetch of first verified NZB failed:', prefetchError.message);
          });
      }
    }
  } catch (error) {
    console.error('[ERROR] Processing failed:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || error.message,
      details: {
        type,
        id,
        indexerManager: INDEXER_MANAGER_LABEL,
        indexerManagerUrl: INDEXER_MANAGER_URL,
        timestamp: new Date().toISOString()
      }
    });
  }
}

['/:token/stream/:type/:id.json', '/stream/:type/:id.json'].forEach((route) => {
  app.get(route, streamHandler);
});

async function handleEasynewsNzbDownload(req, res) {
  if (!easynewsService.isEasynewsEnabled()) {
    res.status(503).json({ error: 'Easynews integration is disabled' });
    return;
  }
  const payload = typeof req.query.payload === 'string' ? req.query.payload : null;
  if (!payload) {
    res.status(400).json({ error: 'Missing payload parameter' });
    return;
  }
  try {
    const requester = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || 'unknown';
    console.log('[EASYNEWS] Incoming NZB request', {
      requester,
      payloadPreview: `${payload.slice(0, 16)}${payload.length > 16 ? '…' : ''}`,
      streamingMode: STREAMING_MODE,
    });
    const nzbData = await easynewsService.downloadEasynewsNzb(payload);
    console.log('[EASYNEWS] NZB download succeeded', {
      fileName: nzbData.fileName,
      size: nzbData.buffer?.length,
      contentType: nzbData.contentType,
    });
    res.setHeader('Content-Type', nzbData.contentType || 'application/x-nzb+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${nzbData.fileName || 'easynews.nzb'}"`);
    res.status(200).send(nzbData.buffer);
  } catch (error) {
    const statusCode = /credential|unauthorized|forbidden/i.test(error.message || '') ? 401 : 502;
    console.warn('[EASYNEWS] NZB download failed', error.message || error);
    res.status(statusCode).json({ error: error.message || 'Unable to fetch Easynews NZB' });
  }
}

async function handleNzbdavStream(req, res) {
  // Decode base64url encoded params from path if present
  if (req.params.encodedParams && !req.query.downloadUrl) {
    const decoded = decodeStreamParams(req.params.encodedParams);
    if (decoded && typeof decoded === 'object') {
      Object.assign(req.query, decoded);
    }
  }
  let { downloadUrl, type = 'movie', id = '', title = 'NZB Stream' } = req.query;
  const easynewsPayload = typeof req.query.easynewsPayload === 'string' ? req.query.easynewsPayload : null;
  const declaredSize = Number(req.query.size);

  const historyNzoId = req.query.historyNzoId;
  if (!downloadUrl && !historyNzoId) {
    res.status(400).json({ error: 'downloadUrl or historyNzoId query parameter is required' });
    return;
  }
  if (!downloadUrl && historyNzoId) {
    downloadUrl = `history:${historyNzoId}`;
  }

  try {
    const category = nzbdavService.getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const cacheKey = nzbdavService.buildNzbdavCacheKey(downloadUrl, category, requestedEpisode);
    let existingSlotHint = historyNzoId
      ? {
        nzoId: historyNzoId,
        jobName: req.query.historyJobName,
        category: req.query.historyCategory
      }
      : null;

    let prefetchedSlotHint = null;
    if (!existingSlotHint) {
      prefetchedSlotHint = await resolvePrefetchedNzbdavJob(downloadUrl);
      if (prefetchedSlotHint?.nzoId) {
        existingSlotHint = {
          nzoId: prefetchedSlotHint.nzoId,
          jobName: prefetchedSlotHint.jobName,
          category: prefetchedSlotHint.category,
        };
      }
    }

    let inlineEasynewsEntry = null;
    if (!existingSlotHint && easynewsPayload) {
      try {
        const easynewsNzb = await easynewsService.downloadEasynewsNzb(easynewsPayload);
        const nzbString = easynewsNzb.buffer.toString('utf8');
        cache.cacheVerifiedNzbPayload(downloadUrl, nzbString, {
          title,
          size: Number.isFinite(declaredSize) ? declaredSize : undefined,
          fileName: easynewsNzb.fileName,
        });
        inlineEasynewsEntry = cache.getVerifiedNzbCacheEntry(downloadUrl);
        if (!inlineEasynewsEntry) {
          inlineEasynewsEntry = {
            payloadBuffer: Buffer.from(nzbString, 'utf8'),
            metadata: {
              title,
              size: Number.isFinite(declaredSize) ? declaredSize : undefined,
              fileName: easynewsNzb.fileName,
            }
          };
        }
        console.log('[EASYNEWS] Downloaded NZB payload for inline queueing');
      } catch (easynewsError) {
        const message = easynewsError?.message || easynewsError || 'unknown error';
        console.warn('[EASYNEWS] Failed to fetch NZB payload:', message);
        throw new Error(`Unable to download Easynews NZB payload: ${message}`);
      }
    }

    const streamData = await cache.getOrCreateNzbdavStream(cacheKey, () =>
      nzbdavService.buildNzbdavStream({
        downloadUrl,
        category,
        title,
        requestedEpisode,
        existingSlot: existingSlotHint,
        inlineCachedEntry: inlineEasynewsEntry,
      })
    );

    if (prefetchedSlotHint?.nzoId) {
      prefetchedNzbdavJobs.set(downloadUrl, {
        ...prefetchedSlotHint,
        jobName: streamData.jobName || prefetchedSlotHint.jobName,
        category: streamData.category || prefetchedSlotHint.category,
        createdAt: Date.now(),
      });
    }

    if ((req.method || 'GET').toUpperCase() === 'HEAD') {
      const inferredMime = inferMimeType(streamData.fileName || title || 'stream');
      const totalSize = Number.isFinite(streamData.size) ? streamData.size : undefined;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', inferredMime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
      res.setHeader('Content-Disposition', `inline; filename="${(streamData.fileName || 'stream').replace(/[\\/:*?"<>|]+/g, '_')}"`);
      if (Number.isFinite(totalSize)) {
        res.setHeader('Content-Length', String(totalSize));
        res.setHeader('X-Total-Length', String(totalSize));
      }
      res.status(200).end();
      return;
    }

    await nzbdavService.proxyNzbdavStream(req, res, streamData.viewPath, streamData.fileName || '');
  } catch (error) {
    if (error?.isNzbdavFailure) {
      console.warn('[NZBDAV] Stream failure detected:', error.failureMessage || error.message);
      const served = await nzbdavService.streamFailureVideo(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.failureMessage || error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    if (error?.code === 'NO_VIDEO_FILES') {
      console.warn('[NZBDAV] Stream failure due to missing playable files');
      const served = await nzbdavService.streamVideoTypeFailure(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    // console.error('[NZBDAV] Stream proxy error:', error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: error.message });
    } else {
      res.end();
    }
  }
}

['/:token/nzb/stream/:encodedParams/:filename', '/:token/nzb/stream/:filename', '/nzb/stream/:encodedParams/:filename', '/nzb/stream/:filename', '/:token/nzb/stream', '/nzb/stream'].forEach((route) => {
  app.get(route, handleNzbdavStream);
  app.head(route, handleNzbdavStream);
});

['/:token/easynews/nzb', '/easynews/nzb'].forEach((route) => {
  app.get(route, handleEasynewsNzbDownload);
});

function startHttpServer() {
  if (serverInstance) {
    return serverInstance;
  }
  serverInstance = app.listen(currentPort, SERVER_HOST, () => {
    console.log(`Addon running at http://${SERVER_HOST}:${currentPort}`);
  });
  serverInstance.on('close', () => {
    serverInstance = null;
  });
  return serverInstance;
}

async function restartHttpServer() {
  if (!serverInstance) {
    startHttpServer();
    return;
  }
  await new Promise((resolve, reject) => {
    serverInstance.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  startHttpServer();
}

startHttpServer();

// Fetch real caps for all enabled indexers in the background at startup
if (NEWZNAB_ENABLED && ACTIVE_NEWZNAB_CONFIGS.length > 0) {
  newznabService.refreshCapsCache(ACTIVE_NEWZNAB_CONFIGS, { timeoutMs: 12000 })
    .then((capsCache) => {
      console.log('[NEWZNAB][CAPS] Startup caps loaded', Object.keys(capsCache));
      if (Object.keys(capsCache).length > 0) {
        runtimeEnv.updateRuntimeEnv({ NEWZNAB_CAPS_CACHE: JSON.stringify(capsCache) });
        runtimeEnv.applyRuntimeEnv();
      }
    })
    .catch((err) => {
      console.warn('[NEWZNAB][CAPS] Startup caps fetch failed (using defaults)', err?.message || err);
    });
}
