require('dotenv').config();

// Global safety net: prevent unhandled errors from crashing the server.
// This catches socket-level errors (e.g. NNTP TLS EACCES) that escape all other handlers.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (process kept alive):', err?.message || err);
  if (err?.code) console.error('[FATAL] Error code:', err.code);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection (process kept alive):', reason?.message || reason);
});

const crypto = require('crypto');
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

// One-time startup migrations: retire legacy config fields that were dropped
// from the UI but still applied silently (e.g. NZB_RELEASE_EXCLUSIONS, where a
// bare term like "cam" matched any title containing those letters and dropped
// every result; NZB_MIN_RESULT_SIZE_MB's hidden additive floor). Each folds its value into the current
// visible field and DELETES the legacy key, so it stops applying and never
// re-migrates. Idempotent: once the keys are gone this is a no-op. Keys
// supplied solely via Docker/.env are left alone.
try {
  const { runStartupMigrations } = require('./src/services/sort/legacyFieldMigrations');
  const migrationUpdates = runStartupMigrations(runtimeEnv.getRuntimeEnv());
  if (migrationUpdates) {
    runtimeEnv.updateRuntimeEnv(migrationUpdates);
    runtimeEnv.applyRuntimeEnv();
    console.log('[MIGRATION] Retired legacy config fields:', Object.keys(migrationUpdates).join(', '));
  }
} catch (err) {
  console.error('[MIGRATION] Startup field migration failed (continuing):', err && err.message ? err.message : err);
}

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
const { ensureSharedSecret, ensureAdminSecret, ensureStreamToken, getEffectiveStreamToken } = require('./src/middleware/auth');
const newznabService = require('./src/services/newznab');
const easynewsService = require('./src/services/easynews');
const { toFiniteNumber, toPositiveInt, toBoolean, parseCommaList, parsePathList, normalizeSortMode, resolvePreferredLanguages, resolveLanguageLabel, resolveLanguageLabels, toSizeBytesFromGb, toSizeBytesFromMb, collectConfigValues, computeManifestUrl, stripTrailingSlashes, decodeBase64Value, deriveSortOrder } = require('./src/utils/config');
const { normalizeReleaseTitle, parseRequestedEpisode, isVideoFileName, fileMatchesEpisode, normalizeNzbdavPath, inferMimeType, normalizeIndexerToken, nzbMatchesIndexer, cleanSpecialSearchTitle, parseFilterList, normalizeResolutionToken } = require('./src/utils/parsers');
const { sanitizeErrorForClient, TRIAGE_FINAL_STATUSES, isTriageFinalStatus, buildStreamCacheKey, restoreTriageDecisions, extractTriageOverrides, sleep, annotateNzbResult, applyMaxSizeFilter, prepareSortedResults, getPreferredLanguageMatch, getPreferredLanguageMatches, triageStatusRank, buildTriageTitleMap, prioritizeTriageCandidates, triageDecisionsMatchStatuses, sanitizeDecisionForCache, serializeFinalNzbResults, restoreFinalNzbResults, safeStat, formatStreamTitle } = require('./src/utils/helpers');
const { maskSensitiveValues, unsentinelValues, CREDENTIAL_MASK_SENTINEL, SENSITIVE_KEYS, SENSITIVE_KEY_PATTERNS, isSensitiveKey } = require('./src/utils/credentialMask');
const { buildTriageNntpConfig, buildNntpServersArray } = require('./src/services/triage/nntpConfig');
const { sanitizeStrictSearchPhrase, cleanSearchTitle, matchesStrictSearch, normaliseTitle, levenshteinRatio, titleSimilarityCheck, TITLE_SIMILARITY_THRESHOLD } = require('./src/utils/stringUtils');
const { formatResolutionBadge, extractQualityFeatureBadges, summarizeNewznabPlan } = require('./src/utils/formatters');
const { normalizeUsenetGroup, extractUsenetGroup, extractFileCount, parseAllowedResolutionList, parseResolutionLimitValue, isResultFromPaidIndexer, dedupeResultsByTitle, DEDUPE_MODES } = require('./src/utils/resultUtils');

// Resolve the configured dedupe mode. Priority:
//   1. NZB_DEDUP_MODE explicitly set ('off' | 'standard' | 'strict')
//   2. Legacy NZB_DEDUP_ENABLED=false → 'off'
//   3. Default / legacy NZB_DEDUP_ENABLED=true → 'standard'
// Existing users who had dedupe enabled (or unset) get 'standard' — the exact
// behavior they had before this knob was introduced.
function resolveDedupeMode(env) {
  const raw = (env.NZB_DEDUP_MODE || '').toString().trim().toLowerCase();
  if (raw === 'off' || DEDUPE_MODES.has(raw)) return raw;
  // No explicit mode — fall back to the legacy boolean.
  const legacy = (env.NZB_DEDUP_ENABLED ?? 'true').toString().trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(legacy)) return 'off';
  return 'standard';
}
const { getStreamParamsKey, encodeStreamParams, decodeStreamParams } = require('./src/utils/streamParams');
const { isNewznabDebugEnabled, isNewznabEndpointLoggingEnabled, logNewznabDebug } = require('./src/services/newznabDebug');
const { getPaidDirectIndexerTokens, buildPaidIndexerLimitMap } = require('./src/services/newznabIndexerLimits');
const { buildEasynewsSearchParams } = require('./src/services/easynews/queryBuilder');
const createManifestHandler = require('./src/routes/manifest');
const createCatalogHandler = require('./src/routes/catalog');
const createMetaHandler = require('./src/routes/meta');
const createEasynewsHandler = require('./src/routes/easynews');
const indexerService = require('./src/services/indexer');
const nzbdavService = require('./src/services/nzbdav');
const specialMetadata = require('./src/services/specialMetadata');
const tmdbService = require('./src/services/tmdb');
const tvdbService = require('./src/services/tvdb');
const animeDatabase = require('./src/services/animeDatabase');
const autoAdvanceQueue = require('./src/services/autoAdvanceQueue');
const backgroundTriage = require('./src/services/backgroundTriage');
const diskNzbCache = require('./src/cache/diskNzbCache');
const profileManager = require('./src/services/profileManager');

// Periodic janitor — prune caches + sessions on a timer so RAM/disk stay
// bounded without relying on an admin config-save. unref() so it never keeps
// the process alive on its own. Runs once for the process lifetime.
const CACHE_JANITOR_INTERVAL_MS = (() => {
  const raw = Number(process.env.CACHE_JANITOR_INTERVAL_MINUTES);
  if (Number.isFinite(raw) && raw > 0) return raw * 60 * 1000;
  return 10 * 60 * 1000; // 10 minutes
})();
setInterval(() => {
  try { cache.runMaintenance(); } catch (err) { console.warn('[JANITOR] cache maintenance failed:', err.message); }
  try { autoAdvanceQueue.pruneExpiredSessions(); } catch (err) { console.warn('[JANITOR] auto-advance prune failed:', err.message); }
  try { backgroundTriage.pruneSessions(); } catch (err) { console.warn('[JANITOR] bg-triage prune failed:', err.message); }
}, CACHE_JANITOR_INTERVAL_MS).unref();

const app = express();
let currentPort = Number(process.env.PORT || 7000);
const ADDON_VERSION = '1.8.2';
const DEFAULT_ADDON_NAME = 'UsenetStreamer';
let serverInstance = null;
const SERVER_HOST = '0.0.0.0';
let PAID_INDEXER_TOKENS = new Set();


// Blocklist patterns for unplayable/unwanted release types
// Matches standalone tokens: .iso, -iso-, (iso), space-delimited, etc.
const RELEASE_BLOCKLIST_REGEX = /(?:^|[\s.\-_(\[])(?:iso|img|bin|cue|exe)(?:[\s.\-_\)\]]|$)/i;

const PREFETCH_NZBDAV_JOB_TTL_MS = 60 * 60 * 1000;
const prefetchedNzbdavJobs = new Map();

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

  // If prefetch already detected this NZB as failed, return the failure marker
  if (entry.failed) {
    return { failed: true, failureMessage: entry.failureMessage };
  }

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
      // Queue itself failed — store failure marker so we don't re-queue
      prefetchedNzbdavJobs.set(downloadUrl, {
        failed: true,
        failureMessage: error.failureMessage || error.message,
        createdAt: Date.now(),
      });
      console.warn('[NZBDAV] Prefetch job failed before reuse:', error.message || error);
      return { failed: true, failureMessage: error.failureMessage || error.message };
    }
  }
  return entry;
}

app.use(cors());

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Global guard: ADDON_SHARED_SECRET is mandatory since v1.7.6.
// Without it, every route returns 503 except a helpful setup hint.
// ---------------------------------------------------------------------------
const SETUP_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>UsenetStreamer — Setup Required</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1118;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.box{max-width:520px;padding:2rem;border:1px solid #333;border-radius:8px;background:#161b22}
h1{color:#f85149;margin-top:0}code{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:0.95em}</style></head>
<body><div class="box"><h1>Setup Required</h1>
<p><strong>ADDON_SHARED_SECRET</strong> is not configured. Since v1.7.6 this is mandatory.</p>
<p>Set it in your Docker environment or <code>.env</code> file:</p>
<pre><code>ADDON_SHARED_SECRET=your-secret-here</code></pre>
<p>Then restart the container. The admin panel and all streaming endpoints will remain locked until this is set.</p></div></body></html>`;

app.use((req, res, next) => {
  const secret = (process.env.ADDON_SHARED_SECRET || '').trim();
  if (secret) return next();
  // Allow assets so the error page could reference them in future
  if (req.path.startsWith('/assets/')) return next();
  const wantsJson = (req.headers.accept || '').includes('application/json')
    || req.path.endsWith('.json');
  if (wantsJson) {
    res.status(503).json({ error: 'ADDON_SHARED_SECRET is not configured. Set it in your Docker/environment config and restart.' });
    return;
  }
  res.status(503).type('html').send(SETUP_HTML);
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

const adminApiRouter = express.Router();
adminApiRouter.use(express.json({ limit: '1mb' }));
const adminStatic = express.static(path.join(__dirname, 'admin'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  },
});

// Keys that cannot be changed via the admin API — only via env/docker/filesystem.
// STREAMING_MODE used to be here (frozen because native mode exposes raw indexer
// links to Stremio); it's now editable from the UI and applies on save via
// rebuildRuntimeConfig() — no restart needed. The native-mode tradeoff is surfaced
// as a UI warning instead of a hard freeze.
const FROZEN_KEYS = new Set(['ADDON_SHARED_SECRET']);

adminApiRouter.get('/config', (req, res) => {
  const values = collectConfigValues(ADMIN_CONFIG_KEYS);
  if (!values.STREAMING_MODE) {
    values.STREAMING_MODE = 'nzbdav';
  }
  if (!values.NZB_MAX_RESULT_SIZE_GB) {
    values.NZB_MAX_RESULT_SIZE_GB = String(DEFAULT_MAX_RESULT_SIZE_GB);
  }
  if (!values.TMDB_SEARCH_MODE) {
    values.TMDB_SEARCH_MODE = 'english_only';
  }
  // Populate derived sort order so dashboard reflects legacy NZB_SORT_MODE correctly
  if (!(values.NZB_SORT_ORDER || '').trim()) {
    values.NZB_SORT_ORDER = INDEXER_SORT_ORDER.join(',');
  }
  res.json({
    values: maskSensitiveValues(values),
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

  // Validate user-facing numeric fields server-side. The admin form is
  // `novalidate`, so its min/max attributes aren't enforced — reject an
  // out-of-range value with a clear message instead of silently persisting
  // something that disables a feature or breaks triage. Empty = "use default".
  const NUMERIC_FIELD_RULES = {
    NZB_RESOLUTION_LIMIT_PER_QUALITY: { min: 0, integer: true, label: 'Results per quality' },
    NZB_MIN_RESULT_SIZE_GB: { min: 0, label: 'Min result size (GB)' },
    NZB_MAX_RESULT_SIZE_GB: { min: 0, label: 'Max result size (GB)' },
    NZB_MAX_BITRATE_MBPS: { min: 0, label: 'Max bitrate (Mbps)' },
    NZBDAV_HISTORY_CATALOG_LIMIT: { min: 0, max: 200, integer: true, label: 'Stremio catalog limit' },
    NZB_TRIAGE_NNTP_PORT: { min: 1, max: 65535, integer: true, label: 'NNTP port' },
    NZB_TRIAGE_MAX_CONNECTIONS: { min: 2, max: 12, integer: true, label: 'Max NNTP connections' },
  };
  for (const [key, rule] of Object.entries(NUMERIC_FIELD_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    const raw = incoming[key];
    if (raw === '' || raw === null || raw === undefined) continue; // unset = use default
    const num = Number(raw);
    const rangeText = rule.max !== undefined ? `between ${rule.min} and ${rule.max}` : `${rule.min} or greater`;
    if (!Number.isFinite(num)
        || (rule.integer && !Number.isInteger(num))
        || num < rule.min
        || (rule.max !== undefined && num > rule.max)) {
      res.status(400).json({ error: `${rule.label} must be ${rule.integer ? 'a whole number ' : ''}${rangeText} (got "${raw}").` });
      return;
    }
  }
  // Cross-field: min result size must not exceed max result size — but a max of
  // 0 means "no cap" (unlimited), so only enforce this when a real max is set.
  if (incoming.NZB_MIN_RESULT_SIZE_GB && incoming.NZB_MAX_RESULT_SIZE_GB) {
    const mn = Number(incoming.NZB_MIN_RESULT_SIZE_GB);
    const mx = Number(incoming.NZB_MAX_RESULT_SIZE_GB);
    if (Number.isFinite(mn) && Number.isFinite(mx) && mx > 0 && mn > mx) {
      res.status(400).json({ error: `Min result size (${mn} GB) can't be larger than max result size (${mx} GB).` });
      return;
    }
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
      // Never allow frozen keys to be changed via the API
      if (FROZEN_KEYS.has(key)) return;
      const value = incoming[key];
      // Skip masked sentinel values — keep existing process.env value unchanged
      if (value === CREDENTIAL_MASK_SENTINEL) {
        // For numbered keys pre-initialized to null, undo the deletion
        if (numberedKeySet.has(key)) {
          delete updates[key];
        }
        return;
      }
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
      // Clearing ANY field must REMOVE the key, not persist "". applyRuntimeEnv
      // deliberately won't overwrite a non-empty process.env value with '' (to
      // protect Docker/.env config) — so a persisted "" leaves the OLD value
      // applied until the next restart: the "I cleared the field but it keeps
      // coming back" bug. Deleting the key instead unsets it live, while a value
      // supplied solely via Docker/.env is preserved (it was never an applied
      // runtime-env key). Booleans never reach here as '' (they're 'true'/
      // 'false'); numbered keys already null-delete via the path above. This
      // generalizes what used to be a proxy-only fix to every config field.
      if (updates[key] === '') {
        updates[key] = null;
      }
    }
  });

  // Safety: explicitly persist TMDb keys even if ADMIN_CONFIG_KEYS filtering breaks
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_API_KEY')
      && incoming.TMDB_API_KEY !== CREDENTIAL_MASK_SENTINEL) {
    // null (not '') on clear so it unsets live and reverts to any Docker/.env
    // value — same delete-on-clear rule as the main field loop.
    updates.TMDB_API_KEY = incoming.TMDB_API_KEY ? String(incoming.TMDB_API_KEY) : null;
  }

  // Safety: frozen keys can never be changed via the API — only via env/docker
  FROZEN_KEYS.forEach((key) => delete updates[key]);
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_ENABLED')) {
    updates.TMDB_ENABLED = incoming.TMDB_ENABLED ? String(incoming.TMDB_ENABLED) : 'false';
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_SEARCH_LANGUAGES')) {
    updates.TMDB_SEARCH_LANGUAGES = incoming.TMDB_SEARCH_LANGUAGES ? String(incoming.TMDB_SEARCH_LANGUAGES) : null;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'TMDB_SEARCH_MODE')) {
    updates.TMDB_SEARCH_MODE = incoming.TMDB_SEARCH_MODE ? String(incoming.TMDB_SEARCH_MODE) : null;
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

    // Use unsentineled values: `incoming` still has masked sentinels for credential
    // fields (API keys + credential-bearing proxy URLs). applyRuntimeEnv() above
    // restored the real values to process.env, so unsentinelValues swaps the sentinels
    // back — otherwise the caps fetch would use the sentinel as the proxy URL
    // ("Invalid proxy URL") and as the API key (silent caps failure → defaults).
    const newznabConfigsForCaps = newznabService.getNewznabConfigsFromValues(unsentinelValues(incoming), { includeEmpty: false });
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
    // Clear in-memory caches + sessions (they hold config-dependent state), but
    // KEEP the on-disk NZB payloads — they stay valid across settings changes and
    // give fast re-mounts without re-downloading from indexers.
    cache.clearTransientCaches('admin-config-save');
    backgroundTriage.closeAllSessions('admin-config-save');
    autoAdvanceQueue.closeAllSessions('admin-config-save');
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

// ── Profile CRUD ────────────────────────────────────────────────────────────
// Profiles are stored as flat NZB_PROFILE_<NN>_<FIELD> keys in runtime-env.json
// (same storage as everything else — no new file). These endpoints read/write only
// ACTIVE slots, so responses stay small. Profile config is read live per request via
// getEffectiveConfig(process.env), so applyRuntimeEnv() is enough — no rebuild needed.
function findFreeProfileSlot(source = process.env) {
  const used = new Set(Array.from(profileManager.getProfiles(source).values()).map((p) => parseInt(p.slot, 10)));
  for (let i = 1; i <= profileManager.MAX_PROFILES; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

adminApiRouter.get('/profiles', (req, res) => {
  res.json({
    profiles: Array.from(profileManager.getProfiles().values()),
    maxProfiles: profileManager.MAX_PROFILES,
    fields: Object.keys(profileManager.PROFILE_OVERRIDES),
    // suffix -> global env key (= the admin form field name). The UI uses this to map
    // a profile's overrides onto the existing form fields, and back on save.
    overrideMap: profileManager.PROFILE_OVERRIDES,
  });
});

adminApiRouter.post('/profiles', (req, res) => {
  const body = req.body || {};
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const newSlug = profileManager.slugifyProfileName(rawName);
  if (!rawName || !newSlug || !profileManager.isValidProfileName(newSlug)) {
    res.status(400).json({ error: 'Invalid profile name. Use letters, numbers, spaces, _ or - (not a reserved word like "admin" or "stream").' });
    return;
  }
  const profiles = profileManager.getProfiles();
  const editingSlug = typeof body.slug === 'string' ? profileManager.slugifyProfileName(body.slug) : '';
  const editing = editingSlug ? profiles.get(editingSlug) : null;

  // Reject if the new slug collides with a DIFFERENT existing profile.
  const collision = profiles.get(newSlug);
  if (collision && (!editing || collision.slot !== editing.slot)) {
    res.status(409).json({ error: `A profile "${newSlug}" already exists.` });
    return;
  }

  let slotNum;
  if (editing) {
    slotNum = parseInt(editing.slot, 10);
  } else {
    slotNum = findFreeProfileSlot();
    if (!slotNum) {
      res.status(409).json({ error: `Maximum of ${profileManager.MAX_PROFILES} profiles reached.` });
      return;
    }
  }
  const idx = String(slotNum).padStart(2, '0');

  // Whitelist: only known override suffixes; empty/missing -> null (clear = inherit).
  const incomingOverrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides : {};
  const updates = { [`NZB_PROFILE_${idx}_NAME`]: rawName };
  Object.keys(profileManager.PROFILE_OVERRIDES).forEach((suffix) => {
    const v = incomingOverrides[suffix];
    const trimmed = typeof v === 'string' ? v.trim() : v;
    updates[`NZB_PROFILE_${idx}_${suffix}`] = (trimmed === '' || trimmed === null || trimmed === undefined) ? null : String(trimmed);
  });

  try {
    runtimeEnv.updateRuntimeEnv(updates);
    runtimeEnv.applyRuntimeEnv();
    res.json({ success: true, profile: profileManager.getProfiles().get(newSlug) || null });
  } catch (error) {
    console.error('[ADMIN] Failed to save profile', error);
    res.status(500).json({ error: 'Failed to persist profile' });
  }
});

adminApiRouter.delete('/profiles/:slug', (req, res) => {
  const slug = profileManager.slugifyProfileName(req.params.slug || '');
  const profile = profileManager.getProfiles().get(slug);
  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  const idx = profile.slot;
  const updates = { [`NZB_PROFILE_${idx}_NAME`]: null };
  Object.keys(profileManager.PROFILE_OVERRIDES).forEach((suffix) => {
    updates[`NZB_PROFILE_${idx}_${suffix}`] = null;
  });
  try {
    runtimeEnv.updateRuntimeEnv(updates);
    runtimeEnv.applyRuntimeEnv();
    res.json({ success: true });
  } catch (error) {
    console.error('[ADMIN] Failed to delete profile', error);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// Preview a sort-config import — returns the parsed slice without
// persisting anything. The frontend uses this to show the user what will be
// applied before they save.
adminApiRouter.post('/sort-import/preview', (req, res) => {
  try {
    const { importAioConfig } = require('./src/services/sort/aioImporter');
    const payload = req.body || {};
    const rawConfig = payload.config !== undefined ? payload.config : payload;
    const result = importAioConfig(rawConfig);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Failed to parse imported config' });
  }
});

adminApiRouter.post('/test-connections', async (req, res) => {
  const payload = req.body || {};
  const { type } = payload;
  // Resolve masked sentinel values back to real process.env before testing
  const values = unsentinelValues(payload.values);
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

app.use('/admin/api', (req, res, next) => ensureAdminSecret(req, res, next), adminApiRouter);
app.use('/admin', adminStatic);
app.use('/:token/admin', (req, res, next) => {
  ensureAdminSecret(req, res, (err) => {
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

// Multi-profile routing: a request like /<token>/<profile>/<resource>... carries a
// profile name in the 2nd path segment (detected by the 3rd segment being a Stremio
// resource word). Validate it, stash req.profileName, and rewrite the URL to the
// normal /<token>/<resource>... form so the existing routes + the token guard below
// match unchanged. Default 2-segment URLs are untouched.
// Phase 1: the profile is parsed but not yet applied (behaves identically to default).
const PROFILE_RESOURCE_WORDS = new Set(['manifest.json', 'stream', 'meta', 'catalog', 'subtitles', 'nzb', 'easynews']);
app.use((req, res, next) => {
  const parts = req.path.split('/').filter(Boolean);
  if (parts.length >= 3
      && parts[0] !== 'admin' && parts[0] !== 'assets'
      && PROFILE_RESOURCE_WORDS.has(parts[2].toLowerCase())) {
    const profile = parts[1];
    // Only treat this as a profile request when parts[1] is a valid profile name.
    // A reserved word here must fall through to its normal route, NOT 404 — e.g.
    // /<token>/nzb/stream (parts[2]='stream' is a resource word, but parts[1]='nzb'
    // is the nzb subsystem) and /<token>/easynews/nzb. Unknown-but-valid-format names
    // still set req.profileName and get 404'd downstream by the resource handlers.
    if (profileManager.isValidProfileName(profile)) {
      req.profileName = profile;
      const qs = req.url.slice(req.path.length); // preserve any ?query
      req.url = `/${[parts[0], ...parts.slice(2)].join('/')}${qs}`;
    }
  }
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/assets/')) return next();
  if (req.path.startsWith('/admin') && !req.path.startsWith('/admin/api')) return next();
  if (/^\/[^/]+\/admin/.test(req.path) && !/^\/[^/]+\/admin\/api/.test(req.path)) return next();
  return ensureStreamToken(req, res, next);
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
let ADDON_STREAM_TOKEN = ''; // resolved in rebuildRuntimeConfig (auto-generated if missing)
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
let NEWZNAB_FILTER_NZB_ONLY = toBoolean(process.env.NEWZNAB_FILTER_NZB_ONLY, false);
let DEBUG_NEWZNAB_SEARCH = toBoolean(process.env.DEBUG_NEWZNAB_SEARCH, false);
let DEBUG_NEWZNAB_TEST = toBoolean(process.env.DEBUG_NEWZNAB_TEST, false);
let DEBUG_NEWZNAB_ENDPOINTS = toBoolean(process.env.DEBUG_NEWZNAB_ENDPOINTS, false);
let NEWZNAB_CONFIGS = newznabService.getEnvNewznabConfigs({ includeEmpty: false });
let ACTIVE_NEWZNAB_CONFIGS = newznabService.filterUsableConfigs(NEWZNAB_CONFIGS, { requireEnabled: true, requireApiKey: true });
const NEWZNAB_LOG_PREFIX = '[NEWZNAB]';

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

let INDEXER_SORT_MODE = normalizeSortMode(process.env.NZB_SORT_MODE, 'quality_then_size');
let INDEXER_SORT_ORDER = deriveSortOrder(process.env.NZB_SORT_ORDER, INDEXER_SORT_MODE);
let INDEXER_PREFERRED_LANGUAGES = resolvePreferredLanguages(process.env.NZB_PREFERRED_LANGUAGE, []);
let INDEXER_PREFERRED_QUALITIES = parseCommaList(process.env.NZB_PREFERRED_QUALITIES);
let INDEXER_PREFERRED_ENCODES = parseCommaList(process.env.NZB_PREFERRED_ENCODES);
let INDEXER_PREFERRED_RELEASE_GROUPS = parseCommaList(process.env.NZB_PREFERRED_RELEASE_GROUPS);
let INDEXER_PREFERRED_VISUAL_TAGS = parseCommaList(process.env.NZB_PREFERRED_VISUAL_TAGS);
let INDEXER_PREFERRED_AUDIO_TAGS = parseCommaList(process.env.NZB_PREFERRED_AUDIO_TAGS);
let INDEXER_PREFERRED_KEYWORDS = parseCommaList(process.env.NZB_PREFERRED_KEYWORDS);
let INDEXER_DEDUP_MODE = resolveDedupeMode(process.env);
let INDEXER_HIDE_BLOCKED_RESULTS = toBoolean(process.env.NZB_HIDE_BLOCKED_RESULTS, false);
let INDEXER_MAX_RESULT_SIZE_BYTES = toSizeBytesFromGb(
  process.env.NZB_MAX_RESULT_SIZE_GB && process.env.NZB_MAX_RESULT_SIZE_GB !== ''
    ? process.env.NZB_MAX_RESULT_SIZE_GB
    : DEFAULT_MAX_RESULT_SIZE_GB
);
let INDEXER_MIN_RESULT_SIZE_BYTES = toSizeBytesFromMb(process.env.NZB_MIN_RESULT_SIZE_MB || '45');
let ALLOWED_RESOLUTIONS = parseAllowedResolutionList(process.env.NZB_ALLOWED_RESOLUTIONS);
let RELEASE_EXCLUSIONS = parseCommaList(process.env.NZB_RELEASE_EXCLUSIONS);
let NZB_NAMING_PATTERN = process.env.NZB_NAMING_PATTERN || '';
let NZB_DISPLAY_NAME_PATTERN = process.env.NZB_DISPLAY_NAME_PATTERN || '';
let RESOLUTION_LIMIT_PER_QUALITY = parseResolutionLimitValue(process.env.NZB_RESOLUTION_LIMIT_PER_QUALITY);
let TRIAGE_ENABLED = toBoolean(process.env.NZB_TRIAGE_ENABLED, false);
let AUTO_ADVANCE_ENABLED = false;
let AUTO_ADVANCE_BACKUP_COUNT = 0;
let NZB_STREAM_PROTECTION = (process.env.NZB_STREAM_PROTECTION || '').trim().toLowerCase();
let TRIAGE_MODE = 'disabled';

// PURE: map a protection mode (+ auto-advance strategy + legacy fallbacks) to
// the derived triage/auto-advance settings, WITHOUT touching any global. This
// is the per-profile-ready core; the wrapper below preserves today's behavior.
// `forcePrefetchOff` is true only for 'none' (matching the original, which only
// ever forced TRIAGE_PREFETCH_FIRST_VERIFIED=false in the 'none' branch).
function deriveProtection(protection, strategy, legacy = {}) {
  const backupCount = strategy === 'prequeue' ? 1 : 0;
  switch (protection) {
    case 'none':
      return { triageEnabled: false, triageMode: 'disabled', autoAdvanceEnabled: false, backupCount, forcePrefetchOff: true };
    case 'auto-advance':
      return { triageEnabled: false, triageMode: 'disabled', autoAdvanceEnabled: true, backupCount };
    case 'health-check':
      return { triageEnabled: true, triageMode: 'blocking', autoAdvanceEnabled: false, backupCount };
    case 'health-check-auto-advance':
      return { triageEnabled: true, triageMode: 'blocking', autoAdvanceEnabled: true, backupCount };
    case 'smart-play-only':
      return { triageEnabled: true, triageMode: 'background', autoAdvanceEnabled: false, backupCount };
    case 'smart-play':
      return { triageEnabled: true, triageMode: 'background', autoAdvanceEnabled: true, backupCount };
    default: {
      // Backward compat: derive from legacy NZB_TRIAGE_ENABLED / NZB_TRIAGE_MODE.
      const triageEnabled = toBoolean(legacy.triageEnabled, false);
      if (!triageEnabled) {
        return { triageEnabled: false, triageMode: 'disabled', autoAdvanceEnabled: true, backupCount };
      }
      const rawMode = (legacy.triageMode || '').trim().toLowerCase();
      const triageMode = ['blocking', 'background', 'disabled'].includes(rawMode) ? rawMode : 'blocking';
      return { triageEnabled, triageMode, autoAdvanceEnabled: triageMode === 'background', backupCount };
    }
  }
}

// Wrapper: reads env + assigns the module globals exactly as before (used at
// startup/rebuild). Behavior is identical to the previous inline switch.
function deriveStreamProtection() {
  const protection = (process.env.NZB_STREAM_PROTECTION || '').trim().toLowerCase();
  const strategy = (process.env.NZB_AUTO_ADVANCE_STRATEGY || 'on-demand').trim().toLowerCase();
  NZB_STREAM_PROTECTION = protection;

  // Auto-advance strategy (only matters when auto-advance is enabled):
  //   on-demand (default): backupCount=0 → queue 1 at a time on user click
  //   prequeue:            backupCount=1 → keep 1+1 ready once activated
  const d = deriveProtection(protection, strategy, {
    triageEnabled: process.env.NZB_TRIAGE_ENABLED,
    triageMode: process.env.NZB_TRIAGE_MODE,
  });
  AUTO_ADVANCE_BACKUP_COUNT = d.backupCount;
  TRIAGE_ENABLED = d.triageEnabled;
  TRIAGE_MODE = d.triageMode;
  AUTO_ADVANCE_ENABLED = d.autoAdvanceEnabled;
  if (d.forcePrefetchOff) TRIAGE_PREFETCH_FIRST_VERIFIED = false; // no protection = no prefetch
}
let TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 25000);
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
let SMART_PLAY_MODE = (process.env.NZB_SMART_PLAY_MODE || 'fastest').trim().toLowerCase() === 'top-ranked' ? 'top-ranked' : 'fastest';
deriveStreamProtection(); // must run AFTER TRIAGE_PREFETCH_FIRST_VERIFIED is declared (overrides for none/smart-play)

// Per-request protection switches for a given effective config (or the globals when
// profileEff is null). Mirrors deriveStreamProtection's mapping WITHOUT mutating any
// global, so a profile's protection mode applies consistently to the streams the
// handler builds AND the playback callbacks they invoke. Strategy + legacy triage
// fallbacks stay global (only the protection mode is per-profile); the triage engine,
// pool, pre-warm, and NZB_TRIAGE_* tuning are untouched.
function resolveRequestProtection(profileEff) {
  if (!profileEff) {
    return {
      triageEnabled: TRIAGE_ENABLED, triageMode: TRIAGE_MODE,
      autoAdvanceEnabled: AUTO_ADVANCE_ENABLED, backupCount: AUTO_ADVANCE_BACKUP_COUNT,
      prefetchFirstVerified: TRIAGE_PREFETCH_FIRST_VERIFIED,
    };
  }
  const d = deriveProtection(
    (profileEff.config.NZB_STREAM_PROTECTION || '').trim().toLowerCase(),
    (process.env.NZB_AUTO_ADVANCE_STRATEGY || 'on-demand').trim().toLowerCase(),
    { triageEnabled: process.env.NZB_TRIAGE_ENABLED, triageMode: process.env.NZB_TRIAGE_MODE });
  return {
    triageEnabled: d.triageEnabled, triageMode: d.triageMode,
    autoAdvanceEnabled: d.autoAdvanceEnabled, backupCount: d.backupCount,
    prefetchFirstVerified: d.forcePrefetchOff ? false : TRIAGE_PREFETCH_FIRST_VERIFIED,
  };
}

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

// In-memory cache of downloaded NZB payloads for upfront triage retries.
// Avoids re-downloading NZBs on the second request when triage timed out.
// Entries auto-expire after 10 minutes.
const UPFRONT_PAYLOAD_CACHE_TTL_MS = 10 * 60 * 1000;
// Cap entries so a burst of triage downloads can't balloon RAM with raw NZB
// bytes (each entry is a full NZB payload). Oldest-inserted evicted first.
const UPFRONT_PAYLOAD_CACHE_MAX = 40;
const upfrontNzbPayloadCache = new Map();
function getOrPruneUpfrontPayloadCache() {
  const now = Date.now();
  for (const [url, entry] of upfrontNzbPayloadCache) {
    if (now - entry.ts > UPFRONT_PAYLOAD_CACHE_TTL_MS) {
      upfrontNzbPayloadCache.delete(url);
    }
  }
  // Return a thin wrapper that the runner can use as a standard Map
  return {
    get(url) {
      const entry = upfrontNzbPayloadCache.get(url);
      if (!entry) return undefined;
      if (Date.now() - entry.ts > UPFRONT_PAYLOAD_CACHE_TTL_MS) {
        upfrontNzbPayloadCache.delete(url);
        return undefined;
      }
      return entry.payload;
    },
    set(url, payload) {
      upfrontNzbPayloadCache.set(url, { payload, ts: Date.now() });
      while (upfrontNzbPayloadCache.size > UPFRONT_PAYLOAD_CACHE_MAX) {
        const oldestKey = upfrontNzbPayloadCache.keys().next().value;
        if (oldestKey === undefined) break;
        upfrontNzbPayloadCache.delete(oldestKey);
      }
    },
    has(url) {
      return this.get(url) !== undefined;
    },
  };
}

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

// True if any saved profile selects a protection mode that enables triage
// (health-check / smart-play variants). A profile with no STREAM_PROTECTION
// override inherits the default and is already covered by the global
// TRIAGE_ENABLED check. Lets the startup pre-warm build the shared NNTP pool
// even when the DEFAULT profile has triage off, so a request to a health-check
// profile finds a warm pool instead of building one cold inside triage.
function anyProfileEnablesTriage() {
  try {
    const strategy = (process.env.NZB_AUTO_ADVANCE_STRATEGY || 'on-demand').trim().toLowerCase();
    const legacy = { triageEnabled: process.env.NZB_TRIAGE_ENABLED, triageMode: process.env.NZB_TRIAGE_MODE };
    for (const profile of profileManager.getProfiles().values()) {
      const protection = (profile.overrides?.STREAM_PROTECTION || '').trim().toLowerCase();
      if (!protection) continue; // inherits default → covered by global TRIAGE_ENABLED
      if (deriveProtection(protection, strategy, legacy).triageEnabled) return true;
    }
  } catch (err) {
    console.warn('[NZB TRIAGE] Profile triage pre-warm scan failed', err?.message || err);
  }
  return false;
}

function maybePrewarmSharedNntpPool() {
  if ((!TRIAGE_ENABLED && !anyProfileEnablesTriage()) || !TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
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

function triggerRequestTriagePrewarm(reason = 'request', triageEnabled = TRIAGE_ENABLED) {
  // Gate on the EFFECTIVE (per-request) triage flag, not the global default-profile
  // one. This lets a request to a health-check profile pre-warm the shared NNTP
  // pool even when the DEFAULT profile has triage off — otherwise the pool would
  // be built cold inside triage on that request, adding seconds of latency.
  if (!triageEnabled || !TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
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
  if (!TRIAGE_ENABLED || !TRIAGE_REUSE_POOL || !TRIAGE_NNTP_CONFIG) {
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
  const previousStreamToken = ADDON_STREAM_TOKEN;

  // Streaming mode: 'nzbdav' (default) or 'native' (Windows Stremio v5 only)
  STREAMING_MODE = (process.env.STREAMING_MODE || 'nzbdav').trim().toLowerCase();
  if (!['nzbdav', 'native'].includes(STREAMING_MODE)) STREAMING_MODE = 'nzbdav';

  ADDON_BASE_URL = (process.env.ADDON_BASE_URL || '').trim();
  ADDON_SHARED_SECRET = (process.env.ADDON_SHARED_SECRET || '').trim();
  // Stream token is independent — auto-generated if not explicitly set
  ensureStreamTokenExists();
  ADDON_STREAM_TOKEN = getEffectiveStreamToken();
  ADDON_NAME = (process.env.ADDON_NAME || DEFAULT_ADDON_NAME).trim() || DEFAULT_ADDON_NAME;

  INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'none').trim().toLowerCase();
  // Native mode forces newznab-only ONLY when the addon is on plain HTTP. On HTTP,
  // native must hand Stremio the indexer's direct HTTPS link (Stremio refuses HTTP
  // addon URLs) and manager (Prowlarr) links are usually local/HTTP — hence
  // newznab-only. On HTTPS, native serves NZBs via the addon (encrypted), so any
  // indexer works and the constraint is lifted.
  if (STREAMING_MODE === 'native' && !/^https:/i.test(ADDON_BASE_URL)) INDEXER_MANAGER = 'none';
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
  NEWZNAB_FILTER_NZB_ONLY = toBoolean(process.env.NEWZNAB_FILTER_NZB_ONLY, false);
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
  INDEXER_SORT_ORDER = deriveSortOrder(process.env.NZB_SORT_ORDER, INDEXER_SORT_MODE);
  INDEXER_PREFERRED_LANGUAGES = resolvePreferredLanguages(process.env.NZB_PREFERRED_LANGUAGE, []);
  INDEXER_PREFERRED_QUALITIES = parseCommaList(process.env.NZB_PREFERRED_QUALITIES);
  INDEXER_PREFERRED_ENCODES = parseCommaList(process.env.NZB_PREFERRED_ENCODES);
  INDEXER_PREFERRED_RELEASE_GROUPS = parseCommaList(process.env.NZB_PREFERRED_RELEASE_GROUPS);
  INDEXER_PREFERRED_VISUAL_TAGS = parseCommaList(process.env.NZB_PREFERRED_VISUAL_TAGS);
  INDEXER_PREFERRED_AUDIO_TAGS = parseCommaList(process.env.NZB_PREFERRED_AUDIO_TAGS);
  INDEXER_PREFERRED_KEYWORDS = parseCommaList(process.env.NZB_PREFERRED_KEYWORDS);
  INDEXER_DEDUP_MODE = resolveDedupeMode(process.env);
  INDEXER_HIDE_BLOCKED_RESULTS = toBoolean(process.env.NZB_HIDE_BLOCKED_RESULTS, false);
  INDEXER_MAX_RESULT_SIZE_BYTES = toSizeBytesFromGb(
    process.env.NZB_MAX_RESULT_SIZE_GB && process.env.NZB_MAX_RESULT_SIZE_GB !== ''
      ? process.env.NZB_MAX_RESULT_SIZE_GB
      : DEFAULT_MAX_RESULT_SIZE_GB
  );
  INDEXER_MIN_RESULT_SIZE_BYTES = toSizeBytesFromMb(process.env.NZB_MIN_RESULT_SIZE_MB || '45');
  ALLOWED_RESOLUTIONS = parseAllowedResolutionList(process.env.NZB_ALLOWED_RESOLUTIONS);
  RELEASE_EXCLUSIONS = parseCommaList(process.env.NZB_RELEASE_EXCLUSIONS);
  NZB_NAMING_PATTERN = process.env.NZB_NAMING_PATTERN || '';
  NZB_DISPLAY_NAME_PATTERN = process.env.NZB_DISPLAY_NAME_PATTERN || '';
  RESOLUTION_LIMIT_PER_QUALITY = parseResolutionLimitValue(process.env.NZB_RESOLUTION_LIMIT_PER_QUALITY);

  TRIAGE_PREFETCH_FIRST_VERIFIED = toBoolean(process.env.NZB_TRIAGE_PREFETCH_FIRST_VERIFIED, true);
  SMART_PLAY_MODE = (process.env.NZB_SMART_PLAY_MODE || 'fastest').trim().toLowerCase() === 'top-ranked' ? 'top-ranked' : 'fastest';
  deriveStreamProtection();
  TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 25000);
  TRIAGE_MAX_CANDIDATES = toPositiveInt(process.env.NZB_TRIAGE_MAX_CANDIDATES, 25);
  TRIAGE_DOWNLOAD_CONCURRENCY = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_CONCURRENCY, 8);
  TRIAGE_PRIORITY_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXERS);
  TRIAGE_PRIORITY_INDEXER_LIMITS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXER_LIMITS);
  TRIAGE_HEALTH_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_HEALTH_INDEXERS);
  TRIAGE_SERIALIZED_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_SERIALIZED_INDEXERS);
  refreshPaidIndexerTokens();
  TRIAGE_NNTP_CONFIG = buildTriageNntpConfig();
  TRIAGE_MAX_DECODED_BYTES = toPositiveInt(process.env.NZB_TRIAGE_MAX_DECODED_BYTES, 32 * 1024);
  TRIAGE_NNTP_MAX_CONNECTIONS = toPositiveInt(process.env.NZB_TRIAGE_MAX_CONNECTIONS, 12);
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
  easynewsService.reloadConfig({ addonBaseUrl: resolvedAddonBase, sharedSecret: ADDON_STREAM_TOKEN });
  diskNzbCache.reloadConfig();

  const portChanged = previousPort !== undefined && previousPort !== currentPort;
  if (log) {
    console.log('[CONFIG] Runtime configuration refreshed', {
      port: currentPort,
      portChanged,
      baseUrlChanged: previousBaseUrl !== undefined && previousBaseUrl !== ADDON_BASE_URL,
      sharedSecretChanged: previousSharedSecret !== undefined && previousSharedSecret !== ADDON_SHARED_SECRET,
      streamTokenChanged: previousStreamToken !== undefined && previousStreamToken !== ADDON_STREAM_TOKEN,
      addonName: ADDON_NAME,
      indexerManager: INDEXER_MANAGER,
      newznabEnabled: NEWZNAB_ENABLED,
      streamProtection: NZB_STREAM_PROTECTION || '(legacy)',
      triageEnabled: TRIAGE_ENABLED,
      triageMode: TRIAGE_MODE,
      autoAdvanceEnabled: AUTO_ADVANCE_ENABLED,
      autoAdvanceBackupCount: AUTO_ADVANCE_BACKUP_COUNT,
      prefetchFirstVerified: TRIAGE_PREFETCH_FIRST_VERIFIED,
      smartPlayMode: SMART_PLAY_MODE,
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
  'ADDON_STREAM_TOKEN',
  'INDEXER_MANAGER',
  'INDEXER_MANAGER_URL',
  'INDEXER_MANAGER_API_KEY',
  'INDEXER_MANAGER_PROXY',
  'INDEXER_MANAGER_STRICT_ID_MATCH',
  'INDEXER_MANAGER_INDEXERS',
  'INDEXER_MANAGER_CACHE_MINUTES',
  'NZB_SORT_MODE',
  'NZB_SORT_ORDER',
  'NZB_SORT_ORDER_MOVIES',
  'NZB_SORT_ORDER_SERIES',
  'NZB_SORT_ORDER_ANIME',
  'NZB_PREFERRED_LANGUAGE',
  'NZB_PREFERRED_QUALITIES',
  'NZB_PREFERRED_ENCODES',
  'NZB_PREFERRED_RELEASE_GROUPS',
  'NZB_PREFERRED_VISUAL_TAGS',
  'NZB_PREFERRED_AUDIO_TAGS',
  'NZB_PREFERRED_AUDIO_CHANNELS',
  'NZB_PREFERRED_KEYWORDS',
  'NZB_MAX_RESULT_SIZE_GB',
  'NZB_DEDUP_ENABLED',
  'NZB_DEDUP_MODE',
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
  'NZB_STREAM_PROTECTION',
  'NZB_AUTO_ADVANCE_STRATEGY',
  'NZB_TRIAGE_ENABLED',
  'NZB_TRIAGE_MODE',
  'NZB_TRIAGE_HEALTH_METHOD',
  'NZB_TRIAGE_TIME_BUDGET_MS',
  'NZB_TRIAGE_MAX_CANDIDATES',
  'NZB_TRIAGE_PRIORITY_INDEXERS',
  'NZB_TRIAGE_PRIORITY_INDEXER_LIMITS',
  'NZB_TRIAGE_SERIALIZED_INDEXERS',
  'NZB_TRIAGE_DOWNLOAD_CONCURRENCY',
  'NZB_TRIAGE_MAX_CONNECTIONS',
  'NZB_TRIAGE_PREFETCH_FIRST_VERIFIED',
  'NZB_SMART_PLAY_MODE',
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

// Filter-side env vars (excluded/required/regex). These were referenced by
// admin/index.html and the server's filter pipeline, but were missing from
// ADMIN_CONFIG_KEYS — meaning saving the form silently discarded them. Adding
// them here makes the form actually persist user edits.
ADMIN_CONFIG_KEYS.push(
  'NZB_EXCLUDED_QUALITIES',
  'NZB_EXCLUDED_ENCODES',
  'NZB_EXCLUDED_VISUAL_TAGS',
  'NZB_EXCLUDED_AUDIO_TAGS',
  'NZB_EXCLUDED_AUDIO_CHANNELS',
  'NZB_EXCLUDED_LANGUAGES',
  'NZB_EXCLUDED_RELEASE_GROUPS',
  'NZB_EXCLUDED_REGEX_PATTERNS',
  'NZB_REQUIRED_REGEX_PATTERNS',
  'NZB_MIN_RESULT_SIZE_GB',
  'NZB_MAX_BITRATE_MBPS',
  // Imported sort-config textarea — read at request time, but wasn't persisted
  // across form saves until added here. Without this, the textarea reverts to
  // empty after every save and per-type sort criteria from the import are lost.
  // (Env var name retained for backward compatibility with existing installs.)
  'NZB_AIO_SORT_CONFIG',
);

function executeManagerPlanWithBackoff(plan, skipManager = false) {
  if (skipManager || INDEXER_MANAGER === 'none') {
    return Promise.resolve({ results: [] });
  }
  if (plan.skipHydra && INDEXER_MANAGER === 'nzbhydra') {
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
  return 4320; // default 72 hours
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

// Eagerly initialize the stream-params encryption key so it appears in
// runtime-env.json immediately on first startup (not deferred to first request).
getStreamParamsKey();

// ---------------------------------------------------------------------------
// Auto-generate ADDON_STREAM_TOKEN if not explicitly set.
// Since v1.7.6 the stream token is always independent from the admin secret.
// ---------------------------------------------------------------------------
function ensureAddonConfigured() {
  if (!ADDON_BASE_URL) {
    throw new Error('ADDON_BASE_URL is not configured');
  }
}

function ensureStreamTokenExists() {
  const existing = (process.env.ADDON_STREAM_TOKEN || '').trim();
  if (existing) return;
  const generated = crypto.randomBytes(24).toString('base64url');
  runtimeEnv.updateRuntimeEnv({ ADDON_STREAM_TOKEN: generated });
  runtimeEnv.applyRuntimeEnv();
  console.log('[SECURITY] ⚠ ADDON_STREAM_TOKEN was not set - auto-generated a new stream token.');
  console.log('[SECURITY] ⚠ Since v1.7.6, the stream token is always separate from the admin token.');
  console.log('[SECURITY] ⚠ Your manifest URL has changed - you may need to reinstall the addon in Stremio.');
  console.log(`[SECURITY] ⚠ New stream token generated (${generated.slice(0, 4)}…). Check runtime-env.json or the admin panel to see the full token.`);
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

// Profile-aware addon display name, matching the manifest naming logic: a profile
// that merely inherits the base name shows as "{base} ({profile})"; a genuinely
// custom name (different from the base) is used verbatim. Used for the per-stream
// "addon" label so it stays consistent with the installed addon's name.
function resolveAddonDisplayName(profileEff) {
  const base = ADDON_NAME || DEFAULT_ADDON_NAME;
  if (!profileEff || !profileEff.profile) return base;
  const own = ((profileEff.profile.overrides && profileEff.profile.overrides.ADDON_NAME) || '').trim();
  return (own && own !== base) ? own : `${base} (${profileEff.profile.name})`;
}

// Route handlers created from extracted factory modules
function getRouteConfig(profileName) {
  const base = {
    STREAMING_MODE,
    ADDON_NAME,
    DEFAULT_ADDON_NAME,
    ADDON_BASE_URL,
    ADDON_VERSION,
    NZBDAV_HISTORY_CATALOG_LIMIT,
  };
  // No profile (default profile) → exact current behavior, byte-identical.
  if (!profileName) return base;
  const eff = profileManager.getEffectiveConfig(profileName);
  if (!eff) return { ...base, profileUnknown: true };
  const ov = eff.profile.overrides;
  const catalogOverride = ov.CATALOG_LIMIT;
  return {
    ...base,
    STREAMING_MODE: eff.config.STREAMING_MODE || base.STREAMING_MODE,
    ADDON_NAME: (ov.ADDON_NAME && ov.ADDON_NAME.trim()) ? ov.ADDON_NAME.trim() : base.ADDON_NAME,
    NZBDAV_HISTORY_CATALOG_LIMIT: (catalogOverride != null && String(catalogOverride).trim() !== '')
      ? (Number(catalogOverride) || 0)
      : base.NZBDAV_HISTORY_CATALOG_LIMIT,
    profileSlug: eff.profile.slug,
    profileDisplayName: eff.profile.name,
    // A profile is treated as having a fully-custom name (shown verbatim, with no
    // "(profile)" suffix) only when its name DIFFERS from the base/default name. A
    // profile that merely inherited the base name — e.g. the create-profile form
    // pre-filled "UNS" — still gets the "{base} (profile)" form for consistency.
    profileNameOverridden: Boolean(ov.ADDON_NAME && ov.ADDON_NAME.trim() && ov.ADDON_NAME.trim() !== base.ADDON_NAME),
  };
}

const manifestHandler = createManifestHandler(getRouteConfig);
const catalogHandler = createCatalogHandler(getRouteConfig);
const metaHandler = createMetaHandler(getRouteConfig);
const handleEasynewsNzbDownload = createEasynewsHandler(getRouteConfig);

['/manifest.json', '/:token/manifest.json'].forEach((route) => {
  app.get(route, manifestHandler);
});

['/catalog/:type/:id.json', '/:token/catalog/:type/:id.json'].forEach((route) => {
  app.get(route, catalogHandler);
});

['/meta/:type/:id.json', '/:token/meta/:type/:id.json'].forEach((route) => {
  app.get(route, metaHandler);
});

async function streamHandler(req, res) {
  const requestStartTs = Date.now();
  const { type, id } = req.params;
  // Scope sessions by profile so two profiles never share auto-advance/triage
  // candidate lists. Travels in the callback URL query (read back by the
  // smartplay/nzb handlers), so downstream lookups resolve the right session.
  const contentKey = req.profileName ? `${type}:${id}:${req.profileName}` : `${type}:${id}`;
  // Resolve this request's effective per-profile config (null = default profile).
  // A valid-format but unknown profile is a 404, matching the manifest behavior.
  const profileEff = req.profileName ? profileManager.getEffectiveConfig(req.profileName) : null;
  if (req.profileName && !profileEff) {
    res.status(404).json({ streams: [] });
    return;
  }
  // Per-profile sort/filter/dedup source: overlay this profile's overrides onto
  // global env. For the default profile (profileEff null) this IS process.env, so
  // every derivation below stays byte-identical to today.
  const sortSource = profileEff ? { ...process.env, ...profileEff.config } : process.env;
  // Per-profile stream protection: deriveProtection() maps the profile's protection
  // MODE to the same {triage, auto-advance} switches the global wrapper sets at
  // startup. We only read these per-request switches per profile — the triage engine,
  // pool, pre-warm, and all NZB_TRIAGE_* tuning stay global and untouched. Strategy +
  // legacy triage fallbacks also stay global (only the protection mode is per-profile).
  // Default profile (profileEff null) reuses the existing globals -> byte-identical.
  const effProtection = resolveRequestProtection(profileEff);
  const effTriageEnabled = effProtection.triageEnabled;
  const effTriageMode = effProtection.triageMode;
  const effAutoAdvanceEnabled = effProtection.autoAdvanceEnabled;
  const effAutoAdvanceBackupCount = effProtection.backupCount;
  const effPrefetchFirstVerified = effProtection.prefetchFirstVerified;
  // Per-profile streaming mode (native vs nzbdav). Default profile uses the global
  // STREAMING_MODE -> byte-identical. Drives native-vs-nzbdav stream building + the
  // nzbdav-only feature guards below. getEffectiveConfig already resolved the profile's
  // mode (or inherited the default).
  const effStreamingMode = profileEff ? profileEff.config.STREAMING_MODE : STREAMING_MODE;
  // A native profile on a plain-HTTP addon must be newznab-only (direct indexer HTTPS
  // links — manager links are usually local/HTTP and unplayable). On HTTPS, native serves
  // via the /nzb/fetch proxy so the manager is fine. nzbdav profiles + the default are
  // unaffected (false — the instance INDEXER_MANAGER already reflects native-instance HTTP).
  const effSkipManager = effStreamingMode === 'native' && !/^https:/i.test(ADDON_BASE_URL) && INDEXER_MANAGER !== 'none';
  console.log(`[REQUEST] Received request for ${type} ID: ${id}`, { ts: new Date(requestStartTs).toISOString() });
  let triagePrewarmPromise = null;

  const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, '');

  let baseIdentifier = id;
  if (type === 'series' && typeof id === 'string' && !animeDatabase.isAnimeId(id)) {
    const parts = id.split(':');
    if (parts.length >= 3) {
      const potentialEpisode = Number.parseInt(parts[parts.length - 1], 10);
      const potentialSeason = Number.parseInt(parts[parts.length - 2], 10);
      if (Number.isFinite(potentialSeason) && Number.isFinite(potentialEpisode)) {
        baseIdentifier = parts.slice(0, parts.length - 2).join(':');
      }
    }
  } else if (type === 'series' && typeof id === 'string' && animeDatabase.isAnimeId(id)) {
    // For anime IDs like kitsu:12345:5, strip only the episode part
    const parts = id.split(':');
    baseIdentifier = parts.slice(0, 2).join(':'); // e.g. kitsu:12345
  }

  let incomingImdbId = null;
  let incomingTvdbId = null;
  let incomingSpecialId = null;
  let incomingTmdbId = null;
  let incomingNzbdavId = null;
  let incomingAnimeId = null; // { idType, id, episode }

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
  } else if (animeDatabase.isAnimeId(baseIdentifier)) {
    // Anime ID detected (kitsu:, mal:, anilist:)
    incomingAnimeId = animeDatabase.parseAnimeId(id);
    if (incomingAnimeId) {
      console.log(`[ANIME] Detected anime ID: ${incomingAnimeId.idType}:${incomingAnimeId.id}`, { episode: incomingAnimeId.episode });
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
  const isAnimeRequest = Boolean(incomingAnimeId);
  const requestLacksIdentifiers = !incomingImdbId && !incomingTvdbId && !incomingTmdbId && !isSpecialRequest && !isNzbdavRequest && !isAnimeRequest;

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
    if (effStreamingMode !== 'native') {
      nzbdavService.ensureNzbdavConfigured();
    }
    triagePrewarmPromise = triggerRequestTriagePrewarm('request', effTriageEnabled);

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
      const tmdbFind = await tmdbService.findByExternalId(incomingImdbId, 'imdb_id', 'movie');
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

    // --- Anime ID resolution: map kitsu/mal/anilist → IMDB/TVDB + override season/episode ---
    let animeResolved = null;
    if (isAnimeRequest) {
      try {
        animeResolved = await animeDatabase.resolveAnimeId(incomingAnimeId);
        if (animeResolved) {
          if (animeResolved.imdbId && !incomingImdbId) {
            incomingImdbId = animeResolved.imdbId;
          }
          if (animeResolved.tvdbId && !incomingTvdbId) {
            incomingTvdbId = animeResolved.tvdbId;
          }
          if (animeResolved.tmdbId && !incomingTmdbId) {
            incomingTmdbId = animeResolved.tmdbId;
          }
          console.log(`[ANIME] Resolved to Western IDs`, { imdb: incomingImdbId, tvdb: incomingTvdbId, tmdb: incomingTmdbId });
        } else {
          console.warn(`[ANIME] Could not resolve ${incomingAnimeId.idType}:${incomingAnimeId.id} to any Western ID`);
        }
      } catch (err) {
        console.error(`[ANIME] Resolution failed: ${err.message}`);
      }
    }

    if (isNzbdavRequest) {
      if (effStreamingMode === 'native') {
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

      const tokenSegment = ADDON_STREAM_TOKEN ? `/${ADDON_STREAM_TOKEN}` : '';
      // Carry the active profile as a URL segment so the callback (stripped by the
      // profile middleware) resolves the same profile's effective config. Empty for
      // the default profile -> byte-identical URLs for existing installs.
      const profileSegment = req.profileName ? `/${req.profileName}` : '';
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
      const streamUrl = `${addonBaseUrl}${tokenSegment}${profileSegment}/nzb/stream/${encodeStreamParams(baseParams)}/${encodedFilename}`;

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

    let requestedEpisode = isAnimeRequest ? null : parseRequestedEpisode(type, id, req.query || {});

    // For anime IDs, derive season/episode from anime database resolution
    if (isAnimeRequest && animeResolved) {
      const animeSeason = animeResolved.season != null ? Number(animeResolved.season) : 1;
      const animeEpisode = animeResolved.episode != null ? Number(animeResolved.episode) : null;
      if (Number.isFinite(animeEpisode)) {
        requestedEpisode = { season: animeSeason, episode: animeEpisode };
        console.log(`[ANIME] Resolved episode info`, { season: animeSeason, episode: animeEpisode });
      }
    } else if (isAnimeRequest && incomingAnimeId?.episode != null) {
      // Fallback: use raw anime episode if database resolution failed
      requestedEpisode = { season: 1, episode: Number(incomingAnimeId.episode) };
      console.log(`[ANIME] Using raw anime episode (no DB mapping)`, requestedEpisode);
    }

    const streamCacheKey = STREAM_CACHE_MAX_ENTRIES > 0
      ? buildStreamCacheKey({ type, id, requestedEpisode, query: req.query || {}, profileName: req.profileName })
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
    // Resolve the dedupe mode up front. Priority:
    //   1. ?dedupeEnabled=false query override (force 'off' for power users)
    //   2. INDEXER_DEDUP_MODE (configured value)
    // The cached-restore block below must honor it; previously dedupe ran
    // unconditionally on cached results, which silently dropped streams on
    // subsequent opens when the user had dedupe disabled and a per-quality cap on.
    const triageOverrides = extractTriageOverrides(req.query || {});
    const dedupeBooleanOverride = typeof triageOverrides.dedupeEnabled === 'boolean' ? triageOverrides.dedupeEnabled : null;
    const dedupeMode = dedupeBooleanOverride === false ? 'off' : (profileEff ? resolveDedupeMode(sortSource) : INDEXER_DEDUP_MODE);
    const dedupeEnabled = dedupeMode !== 'off';
    if (cachedSearchMeta) {
      const restored = restoreFinalNzbResults(cachedSearchMeta.finalNzbResults);
      rawSearchResults = restored.slice();
      dedupedSearchResults = dedupeEnabled
        ? dedupeResultsByTitle(restored, PAID_INDEXER_TOKENS, dedupeMode)
        : restored.slice();
      finalNzbResults = dedupedSearchResults.slice();
      usingCachedSearchResults = true;
    }
    let triageTitleMap = buildTriageTitleMap(triageDecisions);

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
    // For anime requests, push anime metadata so title resolution picks it up
    if (isAnimeRequest && animeResolved && animeResolved.originalTitle) {
      metaSources.push({ title: animeResolved.originalTitle, name: animeResolved.originalTitle, year: animeResolved.year });
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
    const skipMetadataFetch = Boolean(cachedSearchMeta);

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

    // Restore title/year from cache if not available from query (Stremio sends empty query on 2nd visit)
    if (!movieTitle && cachedSearchMeta?.movieTitle) {
      movieTitle = cachedSearchMeta.movieTitle;
    }

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

    if (!releaseYear && cachedSearchMeta?.releaseYear) {
      releaseYear = cachedSearchMeta.releaseYear;
    }

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
      const addPlan = (planType, { tokens = [], rawQuery = null, skipHydra = false } = {}) => {
        // Word-boundary normalization for the text query (q=): slash/backslash in
        // a title (e.g. "A/B") aren't word boundaries to indexers, so the
        // literal query misses dotted release names. Treat them as spaces — the
        // single choke point for every text-plan source. (Accents are already
        // ASCII-folded upstream by normalizeToAscii.) This also flows into the
        // derived strictPhrase below, keeping search + matching consistent.
        if (planType === 'search' && rawQuery) {
          rawQuery = String(rawQuery).replace(/[/\\]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
        }
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
        const planRecord = { type: planType, query, rawQuery: rawQuery ? rawQuery : null, tokens: normalizedTokens, skipHydra: Boolean(skipHydra) };
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
          addPlan('movie', { tokens: [`{TmdbId:${metaIds.tmdb}}`], skipHydra: Boolean(metaIds.imdb) });
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
            executeManagerPlanWithBackoff(plan, effSkipManager),
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
          // In english_only mode, prefer the English title over the original foreign-language title
          const tmdbDisplayTitle = (() => {
            if (tmdbConfig.searchMode === 'english_only' && tmdbMetadata.titles?.length > 0) {
              const englishEntry = tmdbMetadata.titles.find(t => t.language && t.language.startsWith('en'));
              if (englishEntry?.title) return englishEntry.title;
            }
            return tmdbMetadata.originalTitle;
          })();
          metaSources.push({
            imdb_id: incomingImdbId,
            tmdb_id: String(tmdbMetadata.tmdbId),
            title: tmdbDisplayTitle,
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
              executeManagerPlanWithBackoff(searchPlans[searchPlans.length - 1], effSkipManager),
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

      // Anime: inject best title and year if still missing after TMDb/Cinemeta
      if (isAnimeRequest && animeResolved) {
        if (!movieTitle && animeResolved.originalTitle) {
          movieTitle = animeResolved.originalTitle;
          console.log(`[ANIME] Using anime title as movieTitle: ${movieTitle}`);
        }
        if (!releaseYear && animeResolved.year) {
          releaseYear = animeResolved.year;
          console.log(`[ANIME] Using anime year: ${releaseYear}`);
        }
      }

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
            // Strip punctuation the indexer can't match ("A, B & C (...)" →
            // "A B and C ..."); the year/SxxEyy suffix is alphanumeric so it
            // survives. ASCII-normalize first (handles CJK / transliteration),
            // then clean.
            textQueryFallbackValue = cleanSearchTitle(tmdbService.normalizeToAscii(rawFallback), tmdbMetadata?.originalLanguage);
            if (textQueryFallbackValue && textQueryFallbackValue !== rawFallback) {
              console.log(`${INDEXER_LOG_PREFIX} Normalized text query to ASCII`, { original: rawFallback, normalized: textQueryFallbackValue });
            }
            const normalizedValue = (textQueryFallbackValue || '').trim();
            const normalizedYearOnly = /^\d{4}$/.test(normalizedValue);
            const normalizedEpisodeOnly = /^s\d{2}e\d{2}$/i.test(normalizedValue) || /^s\d{2}$/i.test(normalizedValue) || /^e\d{2}$/i.test(normalizedValue);
            const rawHadNonAscii = /[^\x00-\x7F]/.test(rawFallback);
            // Check if ASCII normalization destroyed the title (e.g. CJK → digits only)
            const normalizedTitleOnly = searchTitle ? tmdbService.normalizeToAscii(searchTitle).trim() : '';
            const titleLetters = normalizedTitleOnly.replace(/[^a-zA-Z]/g, '');
            const originalTitleLength = (searchTitle || '').replace(/\s+/g, '').length;
            const normalizedTitleUsable = titleLetters.length >= 2
              && (originalTitleLength === 0 || normalizedTitleOnly.length / originalTitleLength >= 0.8);
            if (normalizedYearOnly || normalizedEpisodeOnly) {
              console.log(`${INDEXER_LOG_PREFIX} Skipping text search plan (normalized to episode/year only)`, { original: rawFallback, normalized: normalizedValue });
            } else if (!normalizedTitleUsable && rawHadNonAscii) {
              console.log(`${INDEXER_LOG_PREFIX} Skipping text search plan (ASCII normalization lost too much of the title)`, {
                original: searchTitle,
                normalized: normalizedTitleOnly,
                retainedRatio: originalTitleLength > 0 ? (normalizedTitleOnly.length / originalTitleLength).toFixed(2) : 'N/A',
              });
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

            // Skip if ASCII normalization destroyed too much of the original title
            const originalLen = (titleObj.title || '').replace(/\s+/g, '').length;
            const baseLetters = normalizedBase.replace(/[^a-zA-Z]/g, '');
            if (baseLetters.length < 2 || (originalLen > 0 && normalizedBase.length / originalLen < 0.8)) {
              console.log(`${INDEXER_LOG_PREFIX} Skipping TMDb title (ASCII normalization lost too much)`, {
                language: titleObj.language,
                title: titleObj.title,
                normalized: normalizedBase,
                retainedRatio: originalLen > 0 ? (normalizedBase.length / originalLen).toFixed(2) : 'N/A',
              });
              return;
            }

            // Strip punctuation so the query matches release-name tokens
            // ("A, B & C (...)" → "A B and C ..."); ratio guard above already
            // ran on the uncleaned title.
            let normalizedQuery = cleanSearchTitle(normalizedBase, titleObj.language);
            if (!normalizedQuery) return;
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

        // Anime title-based searches: add search plans for each known title variant
        if (isAnimeRequest && animeResolved && animeResolved.titles && animeResolved.titles.length > 0) {
          const searchableTitles = animeDatabase.getSearchableTitles(animeResolved.titles);
          console.log(`[ANIME] Adding up to ${searchableTitles.length} anime title search plans`);
          for (const titleObj of searchableTitles) {
            let normalizedQuery = cleanSearchTitle(titleObj.asciiTitle);
            if (!normalizedQuery) continue;
            if (type === 'movie' && Number.isFinite(releaseYear)) {
              normalizedQuery = `${normalizedQuery} ${releaseYear}`;
            } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
              normalizedQuery = `${normalizedQuery} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
            }

            const added = addPlan('search', { rawQuery: normalizedQuery });
            if (added) {
              console.log(`${INDEXER_LOG_PREFIX} Added anime title search plan`, { query: normalizedQuery, original: titleObj.title });
            }

            if (!tmdbLocalizedQuery) {
              tmdbLocalizedQuery = normalizedQuery;
            }
          }
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
        const animeSearchableTitles = (isAnimeRequest && animeResolved?.titles)
          ? animeDatabase.getSearchableTitles(animeResolved.titles)
          : [];
        easynewsSearchParams = buildEasynewsSearchParams({
          type,
          releaseYear,
          seasonNum,
          episodeNum,
          tmdbTitles: metaSources.find(s => s?._tmdbTitles)?._tmdbTitles,
          isAnimeRequest,
          animeSearchableTitles,
          textQueryFallbackValue,
          movieTitle,
          baseIdentifier,
          isSpecialRequest,
          specialMetadataTitle: specialMetadataResult?.title,
          requestLacksIdentifiers,
          strictMode: !isSpecialRequest && (type === 'movie' || type === 'series'),
          normalizeToAscii: tmdbService.normalizeToAscii,
        });
        if (easynewsSearchParams) {
          console.log('[EASYNEWS] Prepared search queries', { count: easynewsSearchParams.queries.length, queries: easynewsSearchParams.queries });
        }
      }

      // Start Easynews searches in parallel (one per query variant, results merged by guid)
      let easynewsPromise = null;
      let easynewsSearchStartTs = null;
      if (easynewsSearchParams) {
        const { queries, ...sharedParams } = easynewsSearchParams;
        console.log(`[EASYNEWS] Starting ${queries.length} search(es) in parallel`);
        easynewsSearchStartTs = Date.now();
        easynewsPromise = Promise.all(
          queries.map((rawQuery) =>
            easynewsService.searchEasynews({ ...sharedParams, rawQuery })
              .catch((err) => {
                console.warn('[EASYNEWS] Query failed:', rawQuery, err.message);
                return [];
              })
          )
        ).then((resultArrays) => {
          const seen = new Set();
          const merged = resultArrays.flat().filter((r) => {
            if (!r?.guid || seen.has(r.guid)) return false;
            seen.add(r.guid);
            return true;
          });
          if (merged.length > 0) {
            console.log('[EASYNEWS] Retrieved results', { count: merged.length, queries });
          }
          return merged;
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
        const isTvdbPlan = Array.isArray(plan?.tokens) && plan.tokens.some(t => /^\{TvdbId:/i.test(t));
        // SceneNZBs rebranded to Treasure-Maps — match either name (some users
        // still carry the old display name, new adds use the new one).
        const idxName = String(item?.indexerId || item?.indexer || '').toLowerCase();
        const isSceneNzbs = idxName.includes('scenenzbs') || /treasure[\s-]?maps/.test(idxName);
        if (isTvdbPlan && isSceneNzbs && type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
          const annotated = (item?.season !== undefined || item?.episode !== undefined) ? item : annotateNzbResult(item, 0);
          if (Number(annotated?.season) !== Number(seasonNum) || Number(annotated?.episode) !== Number(episodeNum)) return false;
        }
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
        // Additional Levenshtein similarity check on parsed titles to reject false positives
        // e.g. a short title vs a longer one sharing its first/last word can pass token checks but fail similarity
        const queryParsedTitle = (() => {
          try {
            const parsed = parseReleaseMetadata(plan.query || plan.strictPhrase);
            return parsed?.parsedTitle || null;
          } catch (_) { return null; }
        })();
        if (!titleSimilarityCheck(candidateTitle, queryParsedTitle)) {
          if (isNewznabDebugEnabled()) {
            console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (title similarity too low)`, {
              candidate: candidateTitle,
              query: queryParsedTitle,
              normCandidate: normaliseTitle(candidateTitle),
              normQuery: normaliseTitle(queryParsedTitle),
              ratio: levenshteinRatio(normaliseTitle(candidateTitle), normaliseTitle(queryParsedTitle)).toFixed(3),
              threshold: TITLE_SIMILARITY_THRESHOLD,
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
        // For series: if the NZB has a year and we know the release year, reject on mismatch (±1 tolerance)
        if (type === 'series' && Number.isFinite(releaseYear) && Number.isFinite(annotated?.year)) {
          if (Math.abs(Number(annotated.year) - Number(releaseYear)) > 1) {
            if (isNewznabDebugEnabled()) {
              console.log(`${INDEXER_LOG_PREFIX} Strict text match failed (series year mismatch)`, {
                title: candidateTitle,
                year: annotated.year,
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
          const isVideoContainer = /(mkv|mp4|avi|mov|wmv|mpg|mpeg|m4v|webm|ts)/i.test(containerValue);
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
        // Only filter non-NZB URLs from direct Newznab results — managers (Hydra/Prowlarr)
        // use their own URL formats that may not end in .nzb
        const filteredNewznab = NEWZNAB_FILTER_NZB_ONLY
          ? newznabResults.filter((item) => item && newznabService.isLikelyNzb(item.downloadUrl))
          : newznabResults;
        const combinedResults = [...managerResults, ...filteredNewznab];
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
          newznabCount: filteredNewznab.length || 0,
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
          executeManagerPlanWithBackoff(plan, effSkipManager),
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
          // Only filter non-NZB URLs from direct Newznab results — managers (Hydra/Prowlarr)
          // use their own URL formats that may not end in .nzb
          const filteredNewznab = NEWZNAB_FILTER_NZB_ONLY
            ? newznabResults.filter((item) => item && newznabService.isLikelyNzb(item.downloadUrl))
            : newznabResults;
          const combinedResults = [...managerResults, ...filteredNewznab];
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
              newznabCount: filteredNewznab.length,
            };
          }
          return {
            plan,
            status: 'fulfilled',
            data: combinedResults,
            errors,
            mgrCount: managerResults.length,
            newznabCount: filteredNewznab.length,
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
          : Array.from(resultsByKey.values()).map((entry) => entry.result),
        PAID_INDEXER_TOKENS,
        dedupeMode
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

    // The sort/filter module globals the block reads directly are re-derived here
    // into eff* locals from sortSource (declared near the top of the handler) with
    // the same parsers; buildConfigFromLegacy(sortSource) handles sort + preferred.
    const effAllowedResolutions = profileEff ? parseAllowedResolutionList(sortSource.NZB_ALLOWED_RESOLUTIONS) : ALLOWED_RESOLUTIONS;
    const effReleaseExclusions = profileEff ? parseCommaList(sortSource.NZB_RELEASE_EXCLUSIONS) : RELEASE_EXCLUSIONS;
    const effPreferredKeywords = profileEff ? parseCommaList(sortSource.NZB_PREFERRED_KEYWORDS) : INDEXER_PREFERRED_KEYWORDS;
    const effResolutionLimit = profileEff ? parseResolutionLimitValue(sortSource.NZB_RESOLUTION_LIMIT_PER_QUALITY) : RESOLUTION_LIMIT_PER_QUALITY;

    const effectiveMaxSizeBytes = (() => {
      const overrideBytes = triageOverrides.maxSizeBytes;
      const defaultBytes = profileEff
        ? toSizeBytesFromGb((sortSource.NZB_MAX_RESULT_SIZE_GB && sortSource.NZB_MAX_RESULT_SIZE_GB !== '') ? sortSource.NZB_MAX_RESULT_SIZE_GB : DEFAULT_MAX_RESULT_SIZE_GB)
        : INDEXER_MAX_RESULT_SIZE_BYTES;
      const normalizedOverride = Number.isFinite(overrideBytes) && overrideBytes > 0 ? overrideBytes : null;
      const normalizedDefault = Number.isFinite(defaultBytes) && defaultBytes > 0 ? defaultBytes : null;
      if (normalizedOverride && normalizedDefault) {
        return Math.min(normalizedOverride, normalizedDefault);
      }
      return normalizedOverride || normalizedDefault || null;
    })();
    const effPreferredLanguagesBase = profileEff ? resolvePreferredLanguages(sortSource.NZB_PREFERRED_LANGUAGE, []) : INDEXER_PREFERRED_LANGUAGES;
    const resolvedPreferredLanguages = resolvePreferredLanguages(triageOverrides.preferredLanguages, effPreferredLanguagesBase);
    const effSortModeBase = profileEff ? normalizeSortMode(sortSource.NZB_SORT_MODE, 'quality_then_size') : INDEXER_SORT_MODE;
    const activeSortMode = triageOverrides.sortMode || effSortModeBase;
    const resolvedSortOrder = profileEff ? deriveSortOrder(sortSource.NZB_SORT_ORDER, effSortModeBase) : INDEXER_SORT_ORDER;
    const effectiveSortMode = resolvedSortOrder.length > 0 ? 'custom_priority' : activeSortMode;

    // Pass the title's original-production language so annotation can tag
    // releases as "Original" when their audio matches (e.g. Korean audio on
    // a Korean film). Also pass TMDb runtime so bitrate can be derived from
    // file_size * 8 / runtime — the only way Max-Bitrate filter and Bitrate
    // sort key produce useful results (release names rarely carry explicit
    // bitrate tokens).
    const annotateContext = {
      originalLanguage: tmdbMetadata?.originalLanguage || null,
      runtimeMinutes: tmdbMetadata?.runtimeMinutes || null,
    };
    finalNzbResults = finalNzbResults.map((result, index) => annotateNzbResult(result, index, annotateContext));

    // Sort pipeline.
    // - If NZB_AIO_SORT_CONFIG is set (imported config), use it verbatim.
    // - Otherwise, build an equivalent config from the legacy NZB_SORT_ORDER +
    //   NZB_PREFERRED_* env vars so existing users see unchanged sort output.
    try {
      const { importAioConfig } = require('./src/services/sort/aioImporter');
      const { buildConfigFromLegacy } = require('./src/services/sort/legacyConfigAdapter');
      const { sortStreams } = require('./src/services/sort/sortEngine');
      const { filterStreams } = require('./src/services/sort/filter');
      const { precomputeMatches } = require('./src/services/sort/precompute');

      let unified;
      const rawConfig = (sortSource.NZB_AIO_SORT_CONFIG || '').trim();
      if (rawConfig) {
        const imported = importAioConfig(rawConfig);
        unified = {
          sortCriteria: imported.sortCriteria,
          preferred: imported.preferred,
          filters: imported.filters,
          expressions: imported.expressions,
          source: 'imported',
        };
      } else {
        const legacy = buildConfigFromLegacy(sortSource);
        // Layer legacy-era filter env vars into the unified filter shape.
        const splitCsvEnv = (val) => (val || '')
          .toString().split(',').map((s) => s.trim()).filter(Boolean);
        const minSizeGb = Number.parseFloat(sortSource.NZB_MIN_RESULT_SIZE_GB);
        const minSizeBytes = Number.isFinite(minSizeGb) && minSizeGb > 0
          ? minSizeGb * 1024 * 1024 * 1024
          : null;
        const maxBitrateMbps = Number.parseFloat(sortSource.NZB_MAX_BITRATE_MBPS);
        const maxBitrateBps = Number.isFinite(maxBitrateMbps) && maxBitrateMbps > 0
          ? maxBitrateMbps * 1_000_000
          : null;
        const sizeRange = {};
        if (minSizeBytes) sizeRange.min = minSizeBytes;
        if (Number.isFinite(effectiveMaxSizeBytes) && effectiveMaxSizeBytes > 0) {
          sizeRange.max = effectiveMaxSizeBytes;
        }
        const bitrateRange = {};
        if (maxBitrateBps) bitrateRange.max = maxBitrateBps;

        const linesFromEnv = (val) => (val || '')
          .toString().split('\n').map((s) => s.trim()).filter(Boolean);
        // Legacy "Release Exclusions" (NZB_RELEASE_EXCLUSIONS) are release-TYPE
        // keywords (cam, telesync, hdtv, webrip, xvid, 3d, …), NOT free regex.
        // Match each as a whole token using the same release-name boundary the
        // classifier uses, so "cam" hits ".CAM." / " CAM " but not the "cam"
        // inside an ordinary word like "camera", and "scr" not inside
        // "subscriber", etc. (Plain-substring matching here silently dropped
        // legit titles whose name contained a release-type substring.) Explicit
        // user regex (NZB_EXCLUDED_REGEX_
        // PATTERNS) is left untouched — those are author-controlled patterns.
        const releaseExclusionToPattern = (term) => {
          const t = String(term || '').trim();
          if (!t) return null;
          const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return { pattern: `(?<![^\\s\\[(_\\-.,])(${escaped})(?=[\\s\\)\\]_.\\-,]|$)`, flags: 'i' };
        };
        const filters = {
          excluded: {
            qualities: splitCsvEnv(sortSource.NZB_EXCLUDED_QUALITIES),
            encodes: splitCsvEnv(sortSource.NZB_EXCLUDED_ENCODES),
            visualTags: splitCsvEnv(sortSource.NZB_EXCLUDED_VISUAL_TAGS),
            audioTags: splitCsvEnv(sortSource.NZB_EXCLUDED_AUDIO_TAGS),
            audioChannels: splitCsvEnv(sortSource.NZB_EXCLUDED_AUDIO_CHANNELS),
            languages: splitCsvEnv(sortSource.NZB_EXCLUDED_LANGUAGES),
            releaseGroups: splitCsvEnv(sortSource.NZB_EXCLUDED_RELEASE_GROUPS),
            // No excluded.resolutions: resolution restriction is handled by the
            // Allowed-Resolutions grid (included.resolutions). A separate
            // excluded-resolutions field had no UI and was removed.
          },
          included: { resolutions: effAllowedResolutions || [] },
          ranges: {
            size: Object.keys(sizeRange).length ? sizeRange : undefined,
            bitrate: Object.keys(bitrateRange).length ? bitrateRange : undefined,
          },
          excludedRegex: [
            ...(Array.isArray(effReleaseExclusions) ? effReleaseExclusions.map(releaseExclusionToPattern).filter(Boolean) : []),
            ...linesFromEnv(sortSource.NZB_EXCLUDED_REGEX_PATTERNS),
          ],
          requiredRegex: linesFromEnv(sortSource.NZB_REQUIRED_REGEX_PATTERNS),
        };
        unified = {
          sortCriteria: legacy.sortCriteria,
          preferred: legacy.preferred,
          filters,
          expressions: {
            keywords: effPreferredKeywords || [],
          },
          source: 'legacy-migrated',
        };
      }

      // Note: we deliberately do NOT auto-activate `keyword`. Legacy users may
      // have NZB_PREFERRED_KEYWORDS set without `keyword` in their sort order;
      // the old engine treated those as a no-op. Preserving that behavior.

      const filterInputCount = finalNzbResults.length;
      const filterDropLog = [];
      finalNzbResults = filterStreams(finalNzbResults, unified.filters, { dropLog: filterDropLog });
      // When the filter removes everything (or nearly everything), surface WHY —
      // otherwise a bare "sorted=0" looks like a coverage failure when it's
      // really an over-restrictive filter. Group drops by gate + show samples.
      if (filterInputCount > 0 && finalNzbResults.length === 0 && filterDropLog.length > 0) {
        const reasonHist = {};
        for (const d of filterDropLog) {
          const gate = String(d.reason).split('=')[0];
          reasonHist[gate] = (reasonHist[gate] || 0) + 1;
        }
        console.log(`[SORT][FILTER] dropped ALL ${filterInputCount} results — by gate:`, reasonHist);
        console.log('[SORT][FILTER] samples:', filterDropLog.slice(0, 5).map((d) => `${d.reason}  ←  ${d.title}`));
      }
      precomputeMatches(finalNzbResults, {
        preferredKeywordsPatterns: unified.expressions?.keywords || [],
      });
      // Detect anime via Kitsu/MAL ID prefix — Stremio still sends type='series' for anime.
      const isAnimeContent = typeof id === 'string' && animeDatabase.isAnimeId(id);
      const sortType = isAnimeContent ? 'anime' : (type === 'series' ? 'series' : 'movie');
      finalNzbResults = sortStreams(finalNzbResults, {
        sortCriteria: unified.sortCriteria,
        preferred: unified.preferred,
      }, { type: sortType });
      console.log(`[SORT] source=${unified.source} sorted=${finalNzbResults.length}`);
    } catch (error) {
      console.error('[SORT] Sort engine failed, falling back to legacy:', error?.message || error);
      finalNzbResults = prepareSortedResults(finalNzbResults, {
        sortMode: effectiveSortMode,
        sortOrder: resolvedSortOrder,
        preferredLanguages: resolvedPreferredLanguages,
        preferredQualities: INDEXER_PREFERRED_QUALITIES,
        preferredEncodes: INDEXER_PREFERRED_ENCODES,
        preferredReleaseGroups: INDEXER_PREFERRED_RELEASE_GROUPS,
        preferredVisualTags: INDEXER_PREFERRED_VISUAL_TAGS,
        preferredAudioTags: INDEXER_PREFERRED_AUDIO_TAGS,
        preferredKeywords: effPreferredKeywords,
        maxSizeBytes: effectiveMaxSizeBytes,
        releaseExclusions: effReleaseExclusions,
        allowedResolutions: effAllowedResolutions,
        resolutionLimitPerQuality: effResolutionLimit,
      });
    }
    if (Number.isFinite(INDEXER_MIN_RESULT_SIZE_BYTES) && INDEXER_MIN_RESULT_SIZE_BYTES > 0) {
      finalNzbResults = finalNzbResults.filter(r => !Number.isFinite(r.size) || r.size >= INDEXER_MIN_RESULT_SIZE_BYTES);
    }
    // Per-quality result cap (NZB_RESOLUTION_LIMIT_PER_QUALITY) — the old
    // engine ran this inside prepareSortedResults; the new sort pipeline
    // doesn't, so we apply it here so existing users get the same cap.
    if (Number.isFinite(effResolutionLimit) && effResolutionLimit > 0) {
      const { applyResolutionLimits } = require('./src/utils/helpers');
      finalNzbResults = applyResolutionLimits(finalNzbResults, effResolutionLimit);
    }

    if (triagePrewarmPromise) {
      const prewarmStart = Date.now();
      console.log('[NZB TRIAGE] Waiting for NNTP pool pre-warm to complete (timeout: 10s)...');
      const PREWARM_TIMEOUT_MS = 10000;
      const prewarmSettled = await Promise.race([
        triagePrewarmPromise.then(() => 'resolved'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), PREWARM_TIMEOUT_MS)),
      ]).catch((err) => {
        console.warn('[NZB TRIAGE] Pre-warm await failed', err?.message || err);
        return 'error';
      });
      console.log(`[NZB TRIAGE] Pre-warm await finished: ${prewarmSettled} (${Date.now() - prewarmStart} ms)`);
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
    const directPaidTokens = overrideIndexerTokens ? [] : getPaidDirectIndexerTokens(ACTIVE_NEWZNAB_CONFIGS);
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

    // Fetch NZBDav history early — needed to skip completed NZBs from triage pool
    // and filter out failed NZBs from results before building streams
    const categoryForType = effStreamingMode !== 'native' ? nzbdavService.getNzbdavCategory(type) : null;
    let historyByTitle = new Map();
    let failedByTitle = new Map();
    if (effStreamingMode !== 'native') {
      try {
        const [completedResult, failedResult] = await Promise.all([
          nzbdavService.fetchCompletedNzbdavHistory([categoryForType]),
          nzbdavService.fetchFailedNzbdavHistory([categoryForType]),
        ]);
        historyByTitle = completedResult;
        failedByTitle = failedResult;
        if (historyByTitle.size > 0) {
          console.log(`[NZBDAV] Loaded ${historyByTitle.size} completed NZBs for instant playback detection (category=${categoryForType})`);
        }
        if (failedByTitle.size > 0) {
          console.log(`[NZBDAV] Loaded ${failedByTitle.size} failed NZBs for filtering (category=${categoryForType})`);
        }
      } catch (historyError) {
        console.warn(`[NZBDAV] Unable to load NZBDav history: ${historyError.message}`);
      }
    }

    // Filter out NZBs that previously failed in NZBDav — no point showing them to the user
    if (failedByTitle.size > 0) {
      const beforeCount = finalNzbResults.length;
      finalNzbResults = finalNzbResults.filter((result) => {
        const normalized = normalizeReleaseTitle(result.title);
        return !normalized || !failedByTitle.has(normalized);
      });
      const filteredCount = beforeCount - finalNzbResults.length;
      if (filteredCount > 0) {
        console.log(`[NZBDAV] Filtered out ${filteredCount} previously-failed NZBs from results`);
      }
    }

    // Build rank map before any triage filtering so both mounted and
    // health-checked candidates share the same authoritative rank source.
    const resultRankByUrl = new Map();
    finalNzbResults.forEach((result, index) => {
      if (result && result.downloadUrl) resultRankByUrl.set(result.downloadUrl, index);
    });

    // Collect NZBs already completed in NZBDav so Smart Play can select them
    // even though they are excluded from health-check triage below.
    const completedCandidates = [];
    let triagePoolSkippedInstant = 0;
    const triagePool = healthIndexerSet.size > 0
      ? finalNzbResults.filter((result) => {
        // Skip NZBs already completed in NZBDav — they already have ⚡ Instant badge
        const normTitle = normalizeReleaseTitle(result.title);
        if (normTitle && historyByTitle.has(normTitle)) {
          triagePoolSkippedInstant++;
          completedCandidates.push(result);
          return false;
        }
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
    if (triagePoolSkippedInstant > 0) {
      console.log(`[NZB TRIAGE] Skipped ${triagePoolSkippedInstant} NZBs already completed in NZBDav`);
    }
    console.log(`[NZB TRIAGE] Triage pool size: ${triagePool.length} (from ${finalNzbResults.length} total results)`);
    const getDecisionStatus = (candidate) => {
      const decision = triageDecisions.get(candidate.downloadUrl);
      return decision && decision.status ? String(decision.status).toLowerCase() : null;
    };
    const pendingStatuses = new Set(['unverified', 'pending', 'fetch-error', 'error']);
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
    const triageCandidatesToRun = triageEligibleResults.filter((candidate) => !candidateHasConclusiveDecision(candidate));
    const shouldSkipTriageForRequest = requestLacksIdentifiers || isSpecialRequest;
    const triageWanted = triageCandidatesToRun.length > 0 && !requestedDisable && !shouldSkipTriageForRequest && (requestedEnable || effTriageEnabled);
    const effectiveTriageMode = triageWanted ? effTriageMode : 'disabled';
    const shouldAttemptTriage = triageWanted && effectiveTriageMode === 'blocking';
    const shouldAttemptBackgroundTriage = triageWanted && effectiveTriageMode === 'background';
    let triageOutcome = null;
    let triageCompleteForCache = !shouldAttemptTriage;
    let prefetchCandidate = null;
    let prefetchNzbPayload = null;
    let backgroundTriageSession = null;

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
          nzbPayloadCache: getOrPruneUpfrontPayloadCache(),
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
    } else if (shouldSkipTriageForRequest && effTriageEnabled && !requestedDisable) {
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
          // Save to disk for durability across restarts (RAM cache disabled)
          diskNzbCache.cacheToDisk(candidate.downloadUrl, decision.nzbPayload, {
            title: decision.title || candidate.title,
            size: candidate.size,
            fileName: candidate.title,
          });
          if (!prefetchCandidate && effStreamingMode !== 'native') {
            prefetchCandidate = {
              downloadUrl: candidate.downloadUrl,
              title: candidate.title,
              category: categoryForType,
              requestedEpisode,
              indexerId: candidate.indexerId || candidate.indexer || null,
            };
          }
        }
        if (decision && decision.nzbPayload) {
          delete decision.nzbPayload;
        }
      });
    } else if (triageDecisions && triageDecisions.size > 0) {
      // Triage didn't fully complete (e.g. fetch errors) — save verified
      // payloads to disk before deleting them so prefetch can still use them.
      for (const candidate of triageEligibleResults) {
        const decision = triageDecisions.get(candidate.downloadUrl);
        if (decision && decision.status === 'verified' && typeof decision.nzbPayload === 'string') {
          diskNzbCache.cacheToDisk(candidate.downloadUrl, decision.nzbPayload, {
            title: decision.title || candidate.title,
            size: candidate.size,
            fileName: candidate.title,
          });
          if (!prefetchCandidate && effPrefetchFirstVerified && effStreamingMode !== 'native') {
            prefetchCandidate = {
              downloadUrl: candidate.downloadUrl,
              title: candidate.title,
              category: categoryForType,
              requestedEpisode,
              indexerId: candidate.indexerId || candidate.indexer || null,
            };
          }
        }
      }
      triageDecisions.forEach((decision) => {
        if (decision && decision.nzbPayload) {
          delete decision.nzbPayload;
        }
      });
    }

    // If prefetch is enabled, capture first verified NZB payload even when triage cache completion criteria aren't met
    if (effPrefetchFirstVerified && effStreamingMode !== 'native' && !prefetchCandidate && triageDecisions && triageDecisions.size > 0) {
      for (const candidate of triageEligibleResults) {
        const decision = triageDecisions.get(candidate.downloadUrl);
        if (decision && decision.status === 'verified') {
          // nzbPayload was deleted — check disk cache
          const cachedEntry = diskNzbCache.getFromDisk(candidate.downloadUrl);
          if (cachedEntry) {
            prefetchCandidate = {
              downloadUrl: candidate.downloadUrl,
              title: candidate.title,
              category: categoryForType,
              requestedEpisode,
              indexerId: candidate.indexerId || candidate.indexer || null,
            };
            break;
          }
        }
      }
    }

    // NZBDav cache cleanup is now handled automatically by the cache module

    const triagePendingDownloadUrls = triageEligibleResults
      .filter((candidate) => !candidateHasConclusiveDecision(candidate))
      .map((candidate) => candidate.downloadUrl);
    // In background triage mode, all candidates are pending until bg triage completes
    const bgTriagePending = shouldAttemptBackgroundTriage
      ? triageEligibleResults.map((c) => c.downloadUrl)
      : [];
    const effectivePendingUrls = shouldAttemptBackgroundTriage ? bgTriagePending : triagePendingDownloadUrls;
    const cacheReadyDecisionEntries = Array.from(triageDecisions.entries())
      .map(([downloadUrl, decision]) => {
        const sanitized = sanitizeDecisionForCache(decision);
        return sanitized ? [downloadUrl, sanitized] : null;
      })
      .filter(Boolean);
    const isTriageFullyComplete = !shouldAttemptBackgroundTriage
      && !triageOutcome?.timedOut
      && triagePendingDownloadUrls.length === 0;
    const cacheMeta = streamCacheKey
      ? {
        version: 1,
        storedAt: Date.now(),
        triageComplete: isTriageFullyComplete,
        triagePendingDownloadUrls: effectivePendingUrls,
        finalNzbResults: serializeFinalNzbResults(finalNzbResults),
        triageDecisionsSnapshot: cacheReadyDecisionEntries,
        movieTitle: movieTitle || null,
        releaseYear: releaseYear || null,
      }
      : null;

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
      if (effAutoAdvanceEnabled && contentKey) baseParams.set('contentKey', contentKey);
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
      const passedArchiveCheck = archiveStatuses.some((status) => status === 'rar-stored' || status === 'sevenzip-signature-ok');
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

      const tokenSegment = ADDON_STREAM_TOKEN ? `/${ADDON_STREAM_TOKEN}` : '';
      // Carry the active profile as a URL segment so the callback (stripped by the
      // profile middleware) resolves the same profile's effective config. Empty for
      // the default profile -> byte-identical URLs for existing installs.
      const profileSegment = req.profileName ? `/${req.profileName}` : '';
      const rawFilename = (result.title || 'stream').toString().trim();
      const normalizedFilename = rawFilename
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const fileBase = normalizedFilename || 'stream';
      const hasVideoExt = /\.(mkv|mp4|m4v|avi|mov|wmv|mpg|mpeg|ts|webm)$/i.test(fileBase);
      const fileWithExt = hasVideoExt ? fileBase : `${fileBase}.mkv`;
      const encodedFilename = encodeURIComponent(fileWithExt);
      const streamUrl = `${addonBaseUrl}${tokenSegment}${profileSegment}/nzb/stream/${encodeStreamParams(baseParams)}/${encodedFilename}`;
      const tags = [];
      if (triageTag) tags.push(triageTag);
      if (isInstant && effStreamingMode !== 'native') tags.push('⚡ Instant');
      if (preferredLanguageLabels.length > 0) {
        preferredLanguageLabels.forEach((language) => tags.push(language));
      }
      // quality summary now part of name; keep tags focused on status/language/size
      if (languageLabel) tags.push(`🌐 ${languageLabel}`);
      if (sizeString) tags.push(sizeString);
      const addonLabel = resolveAddonDisplayName(profileEff);

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

      // Add a nested `stream` context so naming templates that expect the
      // canonical template schema work without modification.
      namingContext.stream = {
        proxied: true, // We proxy everything via NZBDav/Stremio
        private: false, // Public Usenet
        resolution: namingContext.resolution,
        upscaled: false, // We don't detect upscaling yet
        quality: namingContext.resolution,
        qualitySummary,
        streamQuality: namingContext.quality,
        resolutionQuality: namingContext.resolution,
        encode: namingContext.codec,
        type: type || 'movie',
        visualTags: (result.hdrList || releaseInfo.hdrList || []),
        audioTags: (result.audioList || releaseInfo.audioList || []),
        audioChannels: [], // Not strictly parsed yet, usually part of audioTags
        seeders: 0, // Usenet doesn't have seeders
        size: result.size || 0, // Raw bytes
        bitrate: Number.isFinite(result.bitrate) && result.bitrate > 0
          ? `${(result.bitrate / 1000000).toFixed(1)} Mbps`
          : null, // derived from size + TMDb runtime; null when runtime unknown
        folderSize: 0,
        indexer: namingContext.indexer,
        languages: releaseLanguageLabels.length > 0 ? releaseLanguageLabels : (sourceLanguageLabel ? [sourceLanguageLabel] : []),
        network: '', // Not strictly tracked
        title: namingContext.title,
        filename: namingContext.filename,
        message: namingContext.health, // Map health status to message
        health: namingContext.health, // Alias for clear naming
        releaseGroup: namingContext.group, // alias for templates that expect releaseGroup
        // Additional mappings
        shortName: namingContext.indexer,
        cached: isInstant || Boolean(triageTag && triageTag.includes('✅')),
        instant: isInstant,
        files: Number.isFinite(result.files) ? result.files : null,
        grabs: Number.isFinite(result.grabs) ? result.grabs : null,
        date: result.publishDateMs ? new Date(result.publishDateMs).toISOString().slice(0, 10) : null,
        usenetGroup: result.group || null,
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
          quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
          resolution_quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
          stream_quality: '{stream.streamQuality::exists["{stream.streamQuality}"||""]}',
          resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
          source: '{stream.source::exists["{stream.source}"||""]}',
          codec: '{stream.encode::exists["{stream.encode}"||""]}',
          group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
          size: '{stream.size::>0["{stream.size::bytes}"||""]}',
          bitrate: '{stream.bitrate::exists["{stream.bitrate}"||""]}',
          languages: '{stream.languages::join(" ")::exists["{stream.languages::join(\" \")}"||""]}',
          indexer: '{stream.indexer::exists["{stream.indexer}"||""]}',
          filename: '{stream.filename::exists["{stream.filename}"||""]}',
          tags: '{tags::exists["{tags}"||""]}',
          files: '{stream.files::exists["{stream.files} files"||""]}',
          grabs: '{stream.grabs::exists["{stream.grabs} grabs"||""]}',
          date: '{stream.date::exists["{stream.date}"||""]}',
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
          bitrate: '{stream.bitrate::exists["📶 {stream.bitrate}"||""]}',
          languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
          indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
          health: '{stream.health::exists["🧪 {stream.health}"||""]}',
          instant: '{stream.instant::istrue["⚡ Instant"||""]}',
          files: '{stream.files::exists["📁 {stream.files} files"||""]}',
          grabs: '{stream.grabs::exists["⬇️ {stream.grabs} grabs"||""]}',
          date: '{stream.date::exists["📅 {stream.date}"||""]}',
          quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
          resolution_quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
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

      // Default stream description template
      const defaultDescriptionPattern = '{stream.title::exists["🎬 {stream.title}\n"||""]}{stream.source::exists["🎥 {stream.source} "||""]}{stream.encode::exists["🎞️ {stream.encode}\n"||"\n"]}{stream.visualTags::join(\' | \')::exists["📺 {stream.visualTags::join(\' | \')}\n"||""]}{stream.audioTags::join(\' \')::exists["🎧 {stream.audioTags::join(\' \')}\n"||""]}{stream.releaseGroup::exists["👥 {stream.releaseGroup}\n"||""]}{stream.size::>0["📦 {stream.size::bytes}\n"||""]}{stream.languages::join(\' \')::exists["🌎 {stream.languages::join(\' \')}\n"||""]}{stream.indexer::exists["🔎 {stream.indexer}"||""]}';
      const effectiveDefaultDescriptionPattern = `{stream.title::exists["🎬 {stream.title}\n"||""]}{stream.streamQuality::exists["✨ {stream.streamQuality}\n"||""]}{stream.source::exists["🎥 {stream.source}\n"||""]}{stream.encode::exists["🎞️ {stream.encode}\n"||""]}{stream.visualTags::join(" | ")::exists["📺 {stream.visualTags::join(\" | \")}\n"||""]}{stream.audioTags::join(" ")::exists["🎧 {stream.audioTags::join(\" \")}\n"||""]}{stream.releaseGroup::exists["👥 {stream.releaseGroup}\n"||""]}{stream.size::>0["📦 {stream.size::bytes}\n"||""]}{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}\n"||""]}{stream.indexer::exists["🔎 {stream.indexer}\n"||""]}{stream.health::exists["🧪 {stream.health}"||""]}`;
      const effectiveDescriptionPattern = buildPatternFromTokenList(profileEff ? profileEff.config.NZB_NAMING_PATTERN : NZB_NAMING_PATTERN, 'long', effectiveDefaultDescriptionPattern);
      const formattedTitle = formatStreamTitle(effectiveDescriptionPattern, namingContext, effectiveDefaultDescriptionPattern);

      const defaultNamePattern = '{addon.name} {stream.health::exists["{stream.health} "||""]}{stream.instant::istrue["⚡ "||""]}{stream.resolution::exists["{stream.resolution}"||""]}';
      const effectiveDefaultNamePattern = '{addon.name} {stream.health::exists["{stream.health} "||""]}{stream.instant::istrue["⚡ "||""]}{stream.resolution::exists["{stream.resolution}"||""]}';
      const effectiveNamePattern = buildPatternFromTokenList(profileEff ? profileEff.config.NZB_DISPLAY_NAME_PATTERN : NZB_DISPLAY_NAME_PATTERN, 'short', effectiveDefaultNamePattern);
      const formattedName = formatStreamTitle(effectiveNamePattern, namingContext, effectiveDefaultNamePattern);

      // Build behavior hints based on streaming mode
      let behaviorHints;
      if (effStreamingMode === 'native') {
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
          // RAR parsers use details.sampleEntries; 7z parsers use details.filenames
          const samples = finding?.details?.sampleEntries || finding?.details?.filenames;
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
      if (effStreamingMode === 'native') {
        // Native mode: Stremio v5 native NZB streaming
        const nntpServers = buildNntpServersArray();
        // On HTTPS, serve the NZB through the addon (encrypted — hides the indexer
        // API key from the client and works with any indexer, not just newznab). On
        // plain HTTP, fall back to the indexer's direct HTTPS link (Stremio refuses
        // to play HTTP addon URLs).
        const nativeNzbUrl = /^https:/i.test(addonBaseUrl)
          ? `${addonBaseUrl}${ADDON_STREAM_TOKEN ? `/${ADDON_STREAM_TOKEN}` : ''}/nzb/fetch/${encodeStreamParams(new URLSearchParams({ downloadUrl: result.downloadUrl, filename: result.title || '' }))}`
          : result.downloadUrl;
        stream = {
          name: formattedName,
          description: formattedTitle,
          nzbUrl: nativeNzbUrl,
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
            // sourceDownloadUrl intentionally omitted — contains indexer API keys
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

    // Background triage: add Smart Play stream at top and start background health check
    // Note: for series, id already contains season:episode (e.g. tt1234:1:2), so no need to append again
    // Show Smart Play when:
    //   1. A new background triage is about to start (shouldAttemptBackgroundTriage), OR
    //   2. Results are fully cached but we're in background triage mode and have verified/instant streams
    //      (the bg session or NZBDav history may still have ready NZBs to serve instantly)
    const hasVerifiedOrInstantStreams = verifiedStreams.length > 0 || instantStreams.length > 0;
    const cachedSmartPlayEligible = !shouldAttemptBackgroundTriage
      && effTriageMode === 'background'
      && effTriageEnabled
      && hasVerifiedOrInstantStreams;
    if ((shouldAttemptBackgroundTriage || cachedSmartPlayEligible) && effStreamingMode !== 'native' && streams.length > 0 && TRIAGE_NNTP_CONFIG) {
      const tokenSegment = ADDON_STREAM_TOKEN ? `/${ADDON_STREAM_TOKEN}` : '';
      // Carry the active profile as a URL segment so the callback (stripped by the
      // profile middleware) resolves the same profile's effective config. Empty for
      // the default profile -> byte-identical URLs for existing installs.
      const profileSegment = req.profileName ? `/${req.profileName}` : '';
      const smartPlayParams = new URLSearchParams({ contentKey, type, id });
      if (requestedEpisode) {
        smartPlayParams.set('season', String(requestedEpisode.season));
        smartPlayParams.set('episode', String(requestedEpisode.episode));
      }
      const tmdbEnglishTitle = Array.isArray(tmdbMetadata?.titles)
        ? tmdbMetadata.titles.find((entry) => {
          const language = String(entry?.language || '').toLowerCase();
          const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
          return language.startsWith('en') && title.length > 0;
        })?.title
        : null;
      const tmdbQueryTitle = (() => {
        const raw = typeof tmdbLocalizedQuery === 'string' ? tmdbLocalizedQuery.trim() : '';
        if (!raw) return null;
        try {
          const parsed = parseReleaseMetadata(raw);
          if (parsed?.parsedTitle) return String(parsed.parsedTitle).trim();
        } catch (_) { /* fallback */ }
        return raw
          .replace(/\bS\d{2}E\d{2}\b/ig, '')
          .replace(/\b\d{4}\b/g, '')
          .trim();
      })();
      const searchTitle = (tmdbEnglishTitle || tmdbQueryTitle || movieTitle || id || '').trim();

      // Build a human-readable filename for the Smart Play URL
      const safeTitle = (searchTitle || 'SmartPlay').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      let smartPlayFilename;
      if (type === 'series' && requestedEpisode) {
        const s = String(requestedEpisode.season).padStart(2, '0');
        const e = String(requestedEpisode.episode).padStart(2, '0');
        smartPlayFilename = `${safeTitle}_S${s}E${e}.mkv`;
      } else {
        smartPlayFilename = releaseYear ? `${safeTitle}_${releaseYear}.mkv` : `${safeTitle}.mkv`;
      }

      const smartPlayUrl = `${addonBaseUrl}${tokenSegment}${profileSegment}/nzb/smartplay/${encodeStreamParams(smartPlayParams)}/${encodeURIComponent(smartPlayFilename)}`;

      // Build Smart Play description with title and episode info
      let smartPlayTitle = searchTitle;
      if (type === 'series' && requestedEpisode) {
        smartPlayTitle = `${searchTitle} S${String(requestedEpisode.season).padStart(2, '0')}E${String(requestedEpisode.episode).padStart(2, '0')}`;
      } else if (releaseYear) {
        smartPlayTitle = `${searchTitle} (${releaseYear})`;
      }

      const addonLabel = resolveAddonDisplayName(profileEff);
      const smartPlayDescription = cachedSmartPlayEligible
        ? `🎬 ${smartPlayTitle}\n✅ Auto-selects the best healthy NZB\n⚡ Health check complete — instant playback`
        : `🎬 ${smartPlayTitle}\n✅ Auto-selects the best healthy NZB\n🔄 Health check running in background...`;
      const smartPlayStream = {
        name: `${addonLabel}\n🎯 Smart Play`,
        description: smartPlayDescription,
        url: smartPlayUrl,
        behaviorHints: {
          notWebReady: true,
          bingeGroup: `usenet-smartplay-${contentKey}`,
        },
        meta: {
          smartPlay: true,
          contentKey,
          triageMode: 'background',
        },
      };
      streams.unshift(smartPlayStream);
      console.log(`[BG-TRIAGE] Smart Play stream added for ${contentKey}`);
    }

    // Log cached streams count (only relevant for NZBDav mode)
    if (effStreamingMode !== 'native') {
      const instantCount = streams.filter((stream) => stream?.meta?.cached).length;
      if (instantCount > 0) {
        console.log(`[STREMIO] ${instantCount}/${streams.length} streams already cached in NZBDav`);
      }
    }

    const requestElapsedMs = Date.now() - requestStartTs;
    const modeLabel = effStreamingMode === 'native' ? 'native NZB' : 'NZB';
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

    // Background triage: start health checking after the response is sent
    if (shouldAttemptBackgroundTriage && effStreamingMode !== 'native' && TRIAGE_NNTP_CONFIG && triageCandidatesToRun.length > 0) {
      // Reuse existing background session if it's still running or has results
      const existingBgSession = backgroundTriage.getSession(contentKey);
      if (existingBgSession) {
        const progress = existingBgSession.getProgress();
        console.log(`[BG-TRIAGE] Reusing existing session for ${contentKey}`, {
          evaluated: progress.evaluated,
          verified: progress.verified,
          blocked: progress.blocked,
          complete: progress.triageComplete,
        });
      } else {
      setImmediate(() => {
        try {
          const triageLogger = (level, message, context) => {
            const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            if (context) logFn(`[BG-TRIAGE] ${message}`, context);
            else logFn(`[BG-TRIAGE] ${message}`);
          };
          const bgTriageOptions = {
            allowedIndexerIds: combinedHealthTokens,
            preferredIndexerIds: combinedHealthTokens,
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
          const queueToNzbdav = async (candidate) => {
            // Route through NZBDav cache to avoid re-queueing duplicates
            const cacheKeyForNzbdav = nzbdavService.buildNzbdavCacheKey(candidate.downloadUrl, candidate.category || categoryForType, requestedEpisode);
            return cache.getOrCreateNzbdavStream(cacheKeyForNzbdav, () => {
              const cachedEntry = diskNzbCache.getFromDisk(candidate.downloadUrl);
              // Check if this NZB is already completed in NZBDav (e.g. from a previous session)
              const normTitle = normalizeReleaseTitle(candidate.title);
              const historySlot = normTitle ? historyByTitle.get(normTitle) : null;
              const existingSlot = historySlot
                ? { nzoId: historySlot.nzoId, jobName: historySlot.jobName, category: historySlot.category }
                : null;
              return nzbdavService.buildNzbdavStream({
                downloadUrl: candidate.downloadUrl,
                category: candidate.category || categoryForType,
                title: candidate.title,
                requestedEpisode,
                existingSlot,
                inlineCachedEntry: cachedEntry,
                indexerId: candidate.indexerId || candidate.indexer || null,
              });
            });
          };
          backgroundTriage.start(contentKey, triagePool, bgTriageOptions, {
            queueToNzbdav,
            getCachedEntry: (url) => diskNzbCache.getFromDisk(url),
            category: categoryForType,
            requestedEpisode,
            prefetchEnabled: effPrefetchFirstVerified,
            smartPlayMode: SMART_PLAY_MODE,
            backupCount: effAutoAdvanceBackupCount,
            initialBatchSize: TRIAGE_MAX_CANDIDATES,
            maxEvaluate: Math.max(12, TRIAGE_MAX_CANDIDATES * 2),
            historyByTitle,
            completedCandidates,
            rankByUrl: resultRankByUrl,
            onDecision: (url, decision) => {
              // Cache verified NZB payloads to disk for durability
              if (decision?.status === 'verified' && typeof decision.nzbPayload === 'string') {
                const matchingCandidate = triagePool.find((c) => c.downloadUrl === url);
                diskNzbCache.cacheToDisk(url, decision.nzbPayload, {
                  title: decision.title || matchingCandidate?.title,
                  size: matchingCandidate?.size,
                  fileName: matchingCandidate?.title,
                });
              }
              // Free the NZB payload string from the decision to avoid RAM bloat
              // (same as blocking triage path does after caching)
              if (decision && decision.nzbPayload) {
                delete decision.nzbPayload;
              }
            },
          });

          // After background triage completes, patch decisions into the stream cache
          // so the next visit shows ✅/⚠️/🚫 badges on individual streams
          if (streamCacheKey) {
            const bgSession = backgroundTriage.getSession(contentKey);
            if (bgSession?.runPromise) {
              bgSession.runPromise.then(() => {
                const decisions = bgSession.decisions;
                if (!decisions || decisions.size === 0) return;
                const patchedEntries = Array.from(decisions.entries())
                  .map(([url, decision]) => {
                    const sanitized = sanitizeDecisionForCache(decision);
                    return sanitized ? [url, sanitized] : null;
                  })
                  .filter(Boolean);
                if (patchedEntries.length === 0) return;
                const updated = cache.updateStreamCacheMeta(streamCacheKey, (meta) => {
                  if (!meta) return;
                  // Merge bg-triage decisions into existing snapshot
                  const existingMap = new Map(Array.isArray(meta.triageDecisionsSnapshot) ? meta.triageDecisionsSnapshot : []);
                  for (const [url, dec] of patchedEntries) {
                    existingMap.set(url, dec);
                  }
                  meta.triageDecisionsSnapshot = Array.from(existingMap.entries());
                  meta.triageComplete = true;
                  meta.triagePendingDownloadUrls = [];
                });
                if (updated) {
                  console.log(`[BG-TRIAGE] Patched ${patchedEntries.length} decisions into stream cache for ${contentKey}`);
                }
              }).catch((err) => {
                console.warn(`[BG-TRIAGE] Failed to patch stream cache: ${err.message}`);
              });
            }
          }

          console.log(`[BG-TRIAGE] Started background health check for ${contentKey} (${triagePool.length} pool, batch=${TRIAGE_MAX_CANDIDATES}, max=${Math.max(12, TRIAGE_MAX_CANDIDATES * 2)})`);
        } catch (err) {
          console.error('[BG-TRIAGE] Failed to start background triage:', err.message);
        }
      });
      } // end else (no existing session)
    }

    // Auto-advance session: create an auto-advance queue from ranked results whenever auto-advance is enabled
    // but NOT in background triage mode (which creates its own auto-advance queue via backgroundTriage.start)
    // Covers: "auto-advance" mode (no triage) and "health-check-auto-advance" mode (blocking triage + auto-advance)
    if (effAutoAdvanceEnabled && !shouldAttemptBackgroundTriage
      && effStreamingMode !== 'native' && finalNzbResults.length > 1) {
      const existingAutoAdvance = autoAdvanceQueue.getSession(contentKey);
      if (!existingAutoAdvance) {
        // When triage ran, put verified NZBs first so auto-advance prefers them
        let orderedResults = finalNzbResults;
        if (triageDecisions && triageDecisions.size > 0) {
          const verified = [];
          const unverified = [];
          const blocked = [];
          for (const r of finalNzbResults) {
            const decision = triageDecisions.get(r.downloadUrl);
            if (decision && decision.status === 'verified') {
              verified.push(r);
            } else if (decision && decision.status === 'blocked') {
              blocked.push(r);
            } else {
              unverified.push(r);
            }
          }
          orderedResults = [...verified, ...unverified, ...blocked];
          if (verified.length > 0 || blocked.length > 0) {
            console.log(`[AUTO-ADVANCE] Reordered candidates: ${verified.length} verified first, then ${unverified.length} unverified, then ${blocked.length} blocked last`);
          }
        }
        const autoAdvanceCandidates = orderedResults.map((r) => {
          const decision = triageDecisions ? triageDecisions.get(r.downloadUrl) : null;
          return {
            downloadUrl: r.downloadUrl,
            title: r.title,
            category: categoryForType,
            size: r.size,
            triageStatus: decision?.status || 'not-run',
          };
        });
        const queueToNzbdavAutoAdvance = async (candidate) => {
          const cacheKeyForNzbdav = nzbdavService.buildNzbdavCacheKey(candidate.downloadUrl, candidate.category || categoryForType, requestedEpisode);
          return cache.getOrCreateNzbdavStream(cacheKeyForNzbdav, () => {
            const cachedEntry = diskNzbCache.getFromDisk(candidate.downloadUrl);
            // Check if this NZB is already completed in NZBDav
            const normTitle = normalizeReleaseTitle(candidate.title);
            const historySlot = normTitle ? historyByTitle.get(normTitle) : null;
            const existingSlot = historySlot
              ? { nzoId: historySlot.nzoId, jobName: historySlot.jobName, category: historySlot.category }
              : null;
            return nzbdavService.buildNzbdavStream({
              downloadUrl: candidate.downloadUrl,
              category: candidate.category || categoryForType,
              title: candidate.title,
              requestedEpisode,
              existingSlot,
              inlineCachedEntry: cachedEntry,
              indexerId: candidate.indexerId || candidate.indexer || null,
            });
          });
        };
        autoAdvanceQueue.createSession(contentKey, autoAdvanceCandidates, {
          queueToNzbdav: queueToNzbdavAutoAdvance,
          getCachedEntry: (url) => diskNzbCache.getFromDisk(url),
          backupCount: effAutoAdvanceBackupCount,
          requestedEpisode,
        });
        console.log(`[AUTO-ADVANCE] Created auto-advance session for ${contentKey} (${autoAdvanceCandidates.length} candidates, backup=${effAutoAdvanceBackupCount})`);
      }
    }

    if (effPrefetchFirstVerified && effStreamingMode !== 'native' && !prefetchCandidate && finalNzbResults.length > 0) {
      // Only prefetch unverified top result if no triage ran (pure auto-advance mode).
      // When triage ran (health-check modes), we only prefetch verified NZBs.
      if (!effTriageEnabled) {
        prefetchCandidate = {
          downloadUrl: finalNzbResults[0].downloadUrl,
          title: finalNzbResults[0].title,
          category: categoryForType,
          requestedEpisode,
          indexerId: finalNzbResults[0].indexerId || finalNzbResults[0].indexer || null,
        };
      }
    }

    if (effPrefetchFirstVerified && effStreamingMode !== 'native' && prefetchCandidate) {
      prunePrefetchedNzbdavJobs();
      // Skip if already completed in NZBDav (survives addon restarts unlike the in-memory map)
      const prefetchNormTitle = normalizeReleaseTitle(prefetchCandidate.title);
      const alreadyInNzbdav = prefetchNormTitle && historyByTitle.has(prefetchNormTitle);
      if (alreadyInNzbdav) {
        console.log(`[PREFETCH] Skipping — already completed in NZBDav: ${prefetchCandidate.title}`);
        // Tell the auto-advance session this URL is already handled
        if (effAutoAdvanceEnabled && contentKey) {
          const fbSession = autoAdvanceQueue.getSession(contentKey);
          if (fbSession) fbSession.markExternallyReady(prefetchCandidate.downloadUrl);
        }
      } else if (prefetchedNzbdavJobs.has(prefetchCandidate.downloadUrl)) {
        // Prefetch already running or completed for this download URL
      } else {
        const jobPromise = new Promise((resolve, reject) => {
          setImmediate(async () => {
            try {
              const cachedEntry = diskNzbCache.getFromDisk(prefetchCandidate.downloadUrl);
              if (cachedEntry) {
                console.log('[CACHE] Using verified NZB payload for prefetch', { downloadUrl: prefetchCandidate.downloadUrl });
              }
              const added = await nzbdavService.addNzbToNzbdav({
                downloadUrl: prefetchCandidate.downloadUrl,
                cachedEntry,
                category: prefetchCandidate.category,
                jobLabel: prefetchCandidate.title,
                indexerId: prefetchCandidate.indexerId || null,
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

        // Mark the prefetch URL as in-flight in the auto-advance session so the
        // pipeline won't try to queue the same NZB if the user clicks before
        // the prefetch completes (prevents duplicate NZBDav entries).
        if (effAutoAdvanceEnabled && contentKey) {
          const fbSession = autoAdvanceQueue.getSession(contentKey);
          if (fbSession) fbSession.markExternallyProcessing(prefetchCandidate.downloadUrl);
        }

        // Capture variables for the async monitor closure
        const prefetchDownloadUrl = prefetchCandidate.downloadUrl;
        const prefetchCategory = prefetchCandidate.category;
        const prefetchTitle = prefetchCandidate.title;
        const prefetchContentKey = contentKey;

        jobPromise
          .then((jobInfo) => {
            prefetchedNzbdavJobs.set(prefetchDownloadUrl, jobInfo);
            console.log(`[PREFETCH] NZB queued to NZBDav (nzoId=${jobInfo.nzoId}, title=${prefetchTitle})`);

            // Monitor NZBDav for completion/failure asynchronously
            nzbdavService.waitForNzbdavHistorySlot(jobInfo.nzoId, prefetchCategory)
              .then((slot) => {
                const jobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || prefetchTitle;
                console.log(`[PREFETCH] NZB completed in NZBDav: ${jobName}`);

                // Always notify the auto-advance session that the prefetched NZB is ready,
                // so it can be served immediately if the user clicks a different (failed) NZB.
                // With faster failover (backupCount > 0), also activate the session to pre-fill backup slots.
                if (effAutoAdvanceEnabled && prefetchContentKey) {
                  const fbSession = autoAdvanceQueue.getSession(prefetchContentKey);
                  if (fbSession) {
                    fbSession.markExternallyReady(prefetchDownloadUrl);
                    if (effAutoAdvanceBackupCount > 0) {
                      console.log(`[PREFETCH] Activating auto-advance session for backup (faster failover)`);
                      fbSession.activate();
                    } else {
                      console.log(`[PREFETCH] Marked prefetched NZB as ready in auto-advance session`);
                    }
                  }
                }
              })
              .catch((monitorError) => {
                console.warn(`[PREFETCH] NZB failed in NZBDav: ${monitorError.failureMessage || monitorError.message}`);
                prefetchedNzbdavJobs.set(prefetchDownloadUrl, {
                  failed: true,
                  failureMessage: monitorError.failureMessage || monitorError.message,
                  createdAt: Date.now(),
                });

                // Mark failed but don't activate session — nobody clicked yet.
                // The pipeline will skip this URL when the user eventually clicks.
                if (effAutoAdvanceEnabled && prefetchContentKey) {
                  const fbSession = autoAdvanceQueue.getSession(prefetchContentKey);
                  if (fbSession) {
                    console.log(`[PREFETCH] Marking failed in auto-advance session for ${prefetchContentKey} (no cascade)`);
                    fbSession.markFailed(prefetchDownloadUrl, { activate: false });
                  }
                }
              });
          })
          .catch((prefetchError) => {
            prefetchedNzbdavJobs.set(prefetchDownloadUrl, {
              failed: true,
              failureMessage: prefetchError.failureMessage || prefetchError.message,
              createdAt: Date.now(),
            });
            console.warn(`[PREFETCH] Failed to queue NZB: ${prefetchError.message}`);

            // Mark failed but don't activate — no user click yet
            if (effAutoAdvanceEnabled && prefetchContentKey) {
              const fbSession = autoAdvanceQueue.getSession(prefetchContentKey);
              if (fbSession) {
                console.log(`[PREFETCH] Marking failed in auto-advance session for ${prefetchContentKey} (no cascade)`);
                fbSession.markFailed(prefetchDownloadUrl, { activate: false });
              }
            }
          });
      }
    }
  } catch (error) {
    console.error('[ERROR] Processing failed:', error.message);
    res.status(error.response?.status || 500).json({
      error: sanitizeErrorForClient(error),
      details: {
        type,
        id,
        timestamp: new Date().toISOString()
      }
    });
  }
}

['/:token/stream/:type/:id.json', '/stream/:type/:id.json'].forEach((route) => {
  app.get(route, streamHandler);
});

// --- Smart Play endpoint ---
// When user clicks Smart Play, wait for the first healthy NZB from the background triage session,
// then proxy the stream. If that stream fails, try the next auto-advance automatically.
async function handleSmartPlay(req, res) {
  if (req.params.encodedParams && !req.query.contentKey) {
    const decoded = decodeStreamParams(req.params.encodedParams);
    if (decoded && typeof decoded === 'object') {
      Object.assign(req.query, decoded);
    }
  }
  // Per-profile protection — the profile travels in the callback URL (stripped by the
  // middleware). Unknown/absent profile -> global protection (don't break playback).
  const profileEff = req.profileName ? profileManager.getEffectiveConfig(req.profileName) : null;
  const effProtection = resolveRequestProtection(profileEff);
  const { contentKey, type = 'movie', id = '' } = req.query;
  if (!contentKey) {
    res.status(400).json({ error: 'Missing contentKey parameter' });
    return;
  }

  const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});

  try {
    // Look up the background triage session
    let bgSession = backgroundTriage.getSession(contentKey);
    if (!bgSession) {
      // No background session — fall through to regular stream handler
      console.warn(`[SMART-PLAY] No background session found for ${contentKey}, falling back to regular stream`);
      return handleNzbdavStream(req, res);
    }

    console.log(`[SMART-PLAY] Waiting for ready NZB for ${contentKey}...`);
    const progress = bgSession.getProgress();
    console.log(`[SMART-PLAY] Triage progress: ${progress.evaluated}/${progress.total} evaluated, ${progress.verified} verified, ${progress.blocked} blocked`);

    // Fast path: if the auto-advance session already has a ready slot (NZB completed in NZBDav),
    // stream it immediately — no history fetch, no waiting.
    const peekedSlot = bgSession.peekReady();
    if (peekedSlot && peekedSlot.viewPath) {
      console.log(`[SMART-PLAY] Instant stream from ready slot: ${peekedSlot.title || peekedSlot.downloadUrl}`);
      if ((req.method || 'GET').toUpperCase() === 'HEAD') {
        const inferredMime = inferMimeType(peekedSlot.fileName || peekedSlot.title || 'stream');
        const totalSize = Number.isFinite(peekedSlot.size) ? peekedSlot.size : undefined;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', inferredMime);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
        if (Number.isFinite(totalSize)) res.setHeader('Content-Length', String(totalSize));
        res.status(200).end();
        return;
      }
      try {
        await nzbdavService.proxyNzbdavStream(req, res, peekedSlot.viewPath, peekedSlot.fileName || '');
        return;
      } catch (proxyErr) {
        // Client disconnected — no point retrying on a dead response
        if (res.headersSent || res.writableEnded || res.destroyed) return;
        console.warn(`[SMART-PLAY] Instant stream failed: ${proxyErr.message}, falling back to waitForReady`);
      }
    }

    // Helper: attempt playback of a mounted (already-completed NZBDav) candidate.
    // Activates verified auto-advance in the background as a silent safety net on success.
    // On handoff failure: suppresses candidate for this session, returns false so caller falls
    // through to verified auto-advance. Returns true if streaming was started.
    const tryMountedCandidate = async (candidate, label) => {
      const rank = bgSession._getRank(candidate.downloadUrl);
      console.log(`[SMART-PLAY] ${label} — trying mounted candidate (rank=${rank}): ${candidate.title}`);
      try {
        const slot = await bgSession.nzbdavOptions.queueToNzbdav(candidate);
        if (slot?.viewPath) {
          // Only activate verified auto-advance as a safety net if the mounted candidate
          // does NOT already outrank the best verified. When mounted is the top choice,
          // activating auto-advance is wasteful — it would download a lower-ranked NZB
          // to NZBDav while the mounted file is already streaming fine.
          if (bgSession.autoAdvanceSession && !bgSession.autoAdvanceSession.activated) {
            const bestVerified = bgSession.getBestVerified();
            const verifiedRank = bestVerified ? bgSession._getRank(bestVerified.downloadUrl) : Infinity;
            if (SMART_PLAY_MODE === 'fastest') {
              // Fastest mode: mounted always wins, never activate auto-advance as safety net
              console.log(`[SMART-PLAY] ${label} — mounted streaming, skipping auto-advance safety net (fastest mode)`);
            } else if (rank <= verifiedRank) {
              // Mounted outranks or ties verified — no need for safety net download
              console.log(`[SMART-PLAY] ${label} — mounted streaming (rank=${rank}), skipping auto-advance safety net (outranks verified rank=${verifiedRank})`);
            } else {
              // Verified outranks mounted — activate auto-advance so the better NZB is ready as backup
              console.log(`[SMART-PLAY] ${label} — mounted streaming (rank=${rank}), activating auto-advance for higher-ranked verified (rank=${verifiedRank})`);
              bgSession.autoAdvanceSession.activate();
            }
          }
          await nzbdavService.proxyNzbdavStream(req, res, slot.viewPath, slot.fileName || '');
          return true;
        }
        console.warn(`[SMART-PLAY] ${label} mounted candidate returned no viewPath, falling back to verified`);
      } catch (mountedErr) {
        if (res.headersSent || res.writableEnded || res.destroyed) return true; // response already committed
        console.warn(`[SMART-PLAY] ${label} mounted candidate failed: ${mountedErr.message}, falling back to verified`);
      }
      // Suppress this mounted candidate for the rest of the session
      bgSession.markMountedFailed(candidate.downloadUrl);
      return false;
    };

    // First mounted decision gate — runs regardless of prefetch mode.
    // top-ranked rule:
    //   1) Compare mounted rank vs best rank among ALL triage-pool candidates.
    //   2) If mounted outranks every triage candidate, play mounted immediately.
    //   3) Otherwise, defer mounted and wait for verified comparison.
    // fastest rule:
    //   - mounted-first immediately.
    let topRankedDeferredForVerification = false;
    if (!peekedSlot) {
      if (SMART_PLAY_MODE === 'top-ranked') {
        const bestMountedNow = bgSession.getBestMountedCandidate();
        if (bestMountedNow) {
          const mountedRank = bgSession._getRank(bestMountedNow.downloadUrl);
          const bestTriageRank = typeof bgSession.getBestTriageRank === 'function'
            ? bgSession.getBestTriageRank()
            : Infinity;
          if (mountedRank < bestTriageRank) {
            const streamed = await tryMountedCandidate(bestMountedNow, 'top-ranked immediate mounted winner');
            if (streamed) return;
            // Mounted failed — fall through to verified path below
          } else {
            topRankedDeferredForVerification = true;
            console.log(`[SMART-PLAY] Top-ranked mode — deferring mounted candidate (rank=${mountedRank}) until verified comparison; best triage rank is ${bestTriageRank}`);
          }
        }
      } else {
        const immediatePlayable = bgSession.getBestPlayableCandidate('fastest');
        if (immediatePlayable.source === 'mounted') {
          const streamed = await tryMountedCandidate(immediatePlayable.candidate, 'fastest immediate mounted winner');
          if (streamed) return;
          // Mounted failed — fall through to verified path below
        }
      }
    }

    // Top-ranked verified decision path (prefetch ON/OFF).
    // If mounted was deferred above, wait for first-pass verified selection then compare.
    if (!peekedSlot && SMART_PLAY_MODE === 'top-ranked') {
      let playable = bgSession.getBestPlayableCandidate('top-ranked');
      const shouldWaitForTopRankedSelection = !playable.bestVerified
        && !bgSession.selectionReady
        && !bgSession.triageComplete
        && (topRankedDeferredForVerification || !effProtection.prefetchFirstVerified);

      if (shouldWaitForTopRankedSelection) {
        console.log(`[SMART-PLAY] Top-ranked mode — waiting for first-pass selection for ${contentKey}...`);
        const triageDeadline = Date.now() + 120000;
        while (!bgSession.selectionReady && !bgSession.closed && Date.now() < triageDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        playable = bgSession.getBestPlayableCandidate('top-ranked');
      }

      if (playable.source === 'mounted') {
        const streamed = await tryMountedCandidate(playable.candidate, 'Top-ranked post-comparison mounted winner');
        if (streamed) return;
        playable = bgSession.getBestPlayableCandidate('top-ranked');
      }

      const bestVerified = playable.bestVerified || bgSession.getBestVerified();
      if (bestVerified) {
        console.log(`[SMART-PLAY] Top-ranked mode — queueing best verified NZB (rank=${bgSession._getRank(bestVerified.downloadUrl)}): ${bestVerified.title}`);
        if (bgSession.autoAdvanceSession) {
          bgSession.autoAdvanceSession.prioritizeCandidate(bestVerified.downloadUrl);
          if (!bgSession.autoAdvanceSession.activated) {
            bgSession.autoAdvanceSession.activate();
          }
        }
      } else {
        console.warn(`[SMART-PLAY] Top-ranked mode — no verified candidates found for ${contentKey}`);
      }
    }

    // Fastest verified fallback activation (on-demand only when prefetch is OFF).
    if (!effProtection.prefetchFirstVerified && !peekedSlot && SMART_PLAY_MODE !== 'top-ranked') {
      if (bgSession.autoAdvanceSession && !bgSession.autoAdvanceSession.activated) {
        console.log(`[SMART-PLAY] Fastest mode — activating auto-advance (first verified wins)`);
        bgSession.autoAdvanceSession.activate();
      } else if (bgSession.triageComplete && bgSession.verifiedUrls?.length === 0) {
        console.warn(`[SMART-PLAY] Fastest mode — no verified candidates found for ${contentKey}`);
      }
      // fall through to waitForReady below
    }

    // Wait for the first ready slot (up to 120s)
    let readySlot;
    try {
      readySlot = await bgSession.waitForReady(240000);
    } catch (waitErr) {
      console.warn(`[SMART-PLAY] Wait failed for ${contentKey}: ${waitErr.message}`);
      // Try to serve failure video
      const failError = new Error(waitErr.message);
      failError.isNzbdavFailure = true;
      failError.failureMessage = waitErr.message;
      const served = await nzbdavService.streamFailureVideo(req, res, failError);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: sanitizeErrorForClient(waitErr) });
      }
      return;
    }

    console.log(`[SMART-PLAY] Ready slot found: ${readySlot.title || readySlot.downloadUrl}`);

    // Stream the ready slot's video
    if ((req.method || 'GET').toUpperCase() === 'HEAD') {
      const inferredMime = inferMimeType(readySlot.fileName || readySlot.title || 'stream');
      const totalSize = Number.isFinite(readySlot.size) ? readySlot.size : undefined;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', inferredMime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
      if (Number.isFinite(totalSize)) {
        res.setHeader('Content-Length', String(totalSize));
      }
      res.status(200).end();
      return;
    }

    try {
      await nzbdavService.proxyNzbdavStream(req, res, readySlot.viewPath, readySlot.fileName || '');
    } catch (proxyError) {
      if (proxyError?.isNzbdavFailure || proxyError?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        // Mark as failed and try the next auto-advance
        console.warn(`[SMART-PLAY] Stream failed for ${readySlot.title}: ${proxyError.message}, trying next auto-advance...`);
        bgSession.markFailed(readySlot.downloadUrl);

        try {
          const nextSlot = await bgSession.waitForReady(60000);
          console.log(`[SMART-PLAY] Auto-advance slot: ${nextSlot.title || nextSlot.downloadUrl}`);
          if (!res.headersSent) {
            await nzbdavService.proxyNzbdavStream(req, res, nextSlot.viewPath, nextSlot.fileName || '');
          }
        } catch (autoAdvanceError) {
          if (!res.headersSent) {
            const served = await nzbdavService.streamFailureVideo(req, res, autoAdvanceError);
            if (!served && !res.headersSent) {
              res.status(502).json({ error: sanitizeErrorForClient(autoAdvanceError) });
            }
          }
        }
      } else {
        throw proxyError;
      }
    }
  } catch (error) {
    if (error.message === 'aborted' || error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      // Normal Stremio behavior — player probes the stream then reconnects
    } else {
      console.error(`[SMART-PLAY] Error for ${contentKey}:`, error.message);
    }
    if (!res.headersSent) {
      if (error?.isNzbdavFailure) {
        const served = await nzbdavService.streamFailureVideo(req, res, error);
        if (!served) res.status(502).json({ error: sanitizeErrorForClient(error) });
      } else {
        res.status(500).json({ error: sanitizeErrorForClient(error) });
      }
    }
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
  // Per-profile protection — profile travels in the callback URL (stripped by the
  // middleware). Unknown/absent profile -> global protection (don't break playback).
  const profileEff = req.profileName ? profileManager.getEffectiveConfig(req.profileName) : null;
  const effProtection = resolveRequestProtection(profileEff);
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

  // Compute cache key outside try so the catch block can cache auto-advance results
  const category = nzbdavService.getNzbdavCategory(type);
  const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
  const cacheKey = nzbdavService.buildNzbdavCacheKey(downloadUrl, category, requestedEpisode);

  try {
    // Check NZBDav stream cache first — a previous auto-advance success may be cached here
    const cachedStream = cache.getCachedNzbdavStream(cacheKey);
    if (cachedStream) {
      if ((req.method || 'GET').toUpperCase() === 'HEAD') {
        const inferredMime = inferMimeType(cachedStream.fileName || title || 'stream');
        const totalSize = Number.isFinite(cachedStream.size) ? cachedStream.size : undefined;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', inferredMime);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
        res.setHeader('Content-Disposition', `inline; filename="${(cachedStream.fileName || 'stream').replace(/[\\/:*?"<>|]+/g, '_')}"`);
        if (Number.isFinite(totalSize)) {
          res.setHeader('Content-Length', String(totalSize));
          res.setHeader('X-Total-Length', String(totalSize));
        }
        res.status(200).end();
        return;
      }
      await nzbdavService.proxyNzbdavStream(req, res, cachedStream.viewPath, cachedStream.fileName || '');
      return;
    }

    let existingSlotHint = historyNzoId
      ? {
        nzoId: historyNzoId,
        jobName: req.query.historyJobName,
        category: req.query.historyCategory
      }
      : null;

    // Check if health check already blocked this NZB — skip straight to auto-advance
    const contentKey = req.query.contentKey || null;
    if (effProtection.autoAdvanceEnabled && contentKey) {
      const bgSession = backgroundTriage.getSession(contentKey);
      const fbSession = autoAdvanceQueue.getSession(contentKey);
      const triageStatus = bgSession?.getTriageStatus(downloadUrl)
        || fbSession?.getTriageStatus(downloadUrl);
      if (triageStatus === 'blocked') {
        const blockedError = new Error(`[NZBDAV] NZB was blocked by health check — skipping to auto-advance`);
        blockedError.isNzbdavFailure = true;
        blockedError.failureMessage = 'Blocked by health check (missing articles)';
        console.log(`[AUTO-ADVANCE] Skipping blocked NZB, going directly to auto-advance: ${title}`);
        throw blockedError;
      }
    }

    let prefetchedSlotHint = null;
    if (!existingSlotHint) {
      prefetchedSlotHint = await resolvePrefetchedNzbdavJob(downloadUrl);
      if (prefetchedSlotHint?.failed) {
        // Prefetch already detected this NZB as failed — skip straight to auto-advance
        const prefetchFailError = new Error(`[NZBDAV] NZB previously failed: ${prefetchedSlotHint.failureMessage || 'unknown'}`);
        prefetchFailError.isNzbdavFailure = true;
        prefetchFailError.failureMessage = prefetchedSlotHint.failureMessage;
        console.log(`[PREFETCH] Skipping known-failed NZB, going directly to auto-advance: ${downloadUrl}`);
        throw prefetchFailError;
      }
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
        // Save to disk cache for durability
        diskNzbCache.cacheToDisk(downloadUrl, nzbString, {
          title,
          size: Number.isFinite(declaredSize) ? declaredSize : undefined,
          fileName: easynewsNzb.fileName,
        });
        // Build inline entry directly (no RAM cache)
        inlineEasynewsEntry = {
          payloadBuffer: Buffer.from(nzbString, 'utf8'),
          metadata: {
            title,
            size: Number.isFinite(declaredSize) ? declaredSize : undefined,
            fileName: easynewsNzb.fileName,
          }
        };
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

      // Don't attempt fallback if response is already destroyed (client disconnected)
      if (res.destroyed || res.writableEnded) {
        console.log('[AUTO-ADVANCE] Response already closed, skipping auto-advance');
        return;
      }

      // Auto-advance: check if there's a background triage session or auto-advance session with backup NZBs
      const contentKey = req.query.contentKey || null;
      const bgSession = effProtection.autoAdvanceEnabled && contentKey ? backgroundTriage.getSession(contentKey) : null;
      const fbSession = effProtection.autoAdvanceEnabled && contentKey && !bgSession ? autoAdvanceQueue.getSession(contentKey) : null;
      const activeSession = bgSession || fbSession;
      if (activeSession && !res.headersSent) {
        console.log(`[AUTO-ADVANCE] Attempting auto-advance for ${contentKey}...`);
        // Mark the clicked URL as failed
        activeSession.markFailed(downloadUrl);
        try {
          const autoAdvanceSlot = await activeSession.waitForReady(60000);
          console.log(`[AUTO-ADVANCE] Using auto-advance: ${autoAdvanceSlot.title || autoAdvanceSlot.downloadUrl}`);

          // If the slot was marked externally ready (e.g. by prefetch), it only has
          // { downloadUrl, external: true } — resolve the actual viewPath/file info
          // by going through the normal buildNzbdavStream path which finds the
          // already-completed NZB in NZBDav history.
          let resolvedSlot = autoAdvanceSlot;
          if (autoAdvanceSlot.external && !autoAdvanceSlot.viewPath) {
            // Look up the prefetched job info for the correct title/nzoId
            const prefetchJob = await resolvePrefetchedNzbdavJob(autoAdvanceSlot.downloadUrl);
            const fbCacheKey = nzbdavService.buildNzbdavCacheKey(
              autoAdvanceSlot.downloadUrl,
              category,
              requestedEpisode
            );
            const existingSlot = prefetchJob?.nzoId
              ? { nzoId: prefetchJob.nzoId, jobName: prefetchJob.jobName, category: prefetchJob.category }
              : null;
            const cachedEntry = diskNzbCache.getFromDisk(autoAdvanceSlot.downloadUrl);
            resolvedSlot = await cache.getOrCreateNzbdavStream(fbCacheKey, () =>
              nzbdavService.buildNzbdavStream({
                downloadUrl: autoAdvanceSlot.downloadUrl,
                category,
                title: prefetchJob?.jobName || autoAdvanceSlot.title || title,
                requestedEpisode,
                existingSlot,
                inlineCachedEntry: cachedEntry,
              })
            );
          }

          // Cache the auto-advance stream data under the original URL's cache key
          // so subsequent byte-range requests resolve instantly without repeating auto-advance
          cache.cacheNzbdavStreamResult(cacheKey, {
            nzoId: resolvedSlot.nzoId || null,
            category: resolvedSlot.category || category,
            jobName: resolvedSlot.jobName || resolvedSlot.title,
            viewPath: resolvedSlot.viewPath,
            size: resolvedSlot.size,
            fileName: resolvedSlot.fileName,
          });

          if (!res.headersSent && !res.destroyed) {
            await nzbdavService.proxyNzbdavStream(req, res, resolvedSlot.viewPath, resolvedSlot.fileName || '');
          }
          return;
        } catch (autoAdvanceErr) {
          // If the auto-advance stream itself failed mid-proxy, mark the auto-advance URL as failed too
          if (autoAdvanceErr?.isNzbdavFailure && autoAdvanceErr?.downloadUrl) {
            activeSession.markFailed(autoAdvanceErr.downloadUrl);
          }
          // Only log real failures, not client-side aborts
          if (autoAdvanceErr?.code !== 'ERR_STREAM_PREMATURE_CLOSE'
            && autoAdvanceErr?.code !== 'ERR_STREAM_UNABLE_TO_PIPE'
            && autoAdvanceErr?.message !== 'aborted') {
            console.warn(`[AUTO-ADVANCE] Auto-advance also failed: ${autoAdvanceErr.message}`);
          }
        }
      }

      if (!res.headersSent) {
        const served = await nzbdavService.streamFailureVideo(req, res, error);
        if (!served && !res.headersSent) {
          res.status(502).json({ error: sanitizeErrorForClient(error) });
        } else if (!served) {
          res.end();
        }
      } else {
        // Headers already sent (mid-stream failure) — just close the connection
        res.end();
      }
      return;
    }

    if (error?.code === 'NO_VIDEO_FILES') {
      console.warn('[NZBDAV] Stream failure due to missing playable files');
      const served = await nzbdavService.streamVideoTypeFailure(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: sanitizeErrorForClient(error) });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    // console.error('[NZBDAV] Stream proxy error:', error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: sanitizeErrorForClient(error) });
    } else {
      res.end();
    }
  }
}

['/:token/nzb/stream/:encodedParams/:filename', '/:token/nzb/stream/:filename', '/nzb/stream/:encodedParams/:filename', '/nzb/stream/:filename', '/:token/nzb/stream', '/nzb/stream'].forEach((route) => {
  app.get(route, handleNzbdavStream);
  app.head(route, handleNzbdavStream);
});

['/:token/nzb/smartplay/:encodedParams/:filename', '/nzb/smartplay/:encodedParams/:filename', '/:token/nzb/smartplay', '/nzb/smartplay'].forEach((route) => {
  app.get(route, handleSmartPlay);
  app.head(route, handleSmartPlay);
});

['/:token/easynews/nzb', '/easynews/nzb'].forEach((route) => {
  app.get(route, handleEasynewsNzbDownload);
});

// Native HTTPS NZB proxy: fetch the NZB server-side and serve it, so Stremio
// downloads it FROM the addon (the encrypted params hide the indexer API key from
// the client) instead of from a direct indexer link. Used by native mode only when
// the addon is on HTTPS. The encoded params are AES-GCM encrypted, so a client can
// only replay addon-generated URLs — no SSRF to arbitrary URLs.
async function handleNzbFetch(req, res) {
  const decoded = req.params.encodedParams ? decodeStreamParams(req.params.encodedParams) : null;
  if (!decoded || !decoded.downloadUrl) {
    res.status(400).json({ error: 'Invalid or missing NZB parameters' });
    return;
  }
  try {
    let buffer = null;
    const cachedEntry = diskNzbCache.getFromDisk(decoded.downloadUrl);
    if (cachedEntry?.payloadBuffer) {
      buffer = cachedEntry.payloadBuffer; // reuse verified payload — no re-download
    } else {
      const response = await axios.get(decoded.downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });
      buffer = Buffer.from(response.data);
    }
    const rawName = (decoded.filename || 'stream').toString();
    const safeName = rawName.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'stream';
    const fileName = /\.nzb$/i.test(safeName) ? safeName : `${safeName}.nzb`;
    res.setHeader('Content-Type', 'application/x-nzb+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    if (req.method === 'HEAD') { res.status(200).end(); return; }
    res.status(200).send(buffer);
  } catch (error) {
    console.warn('[NZB FETCH] Failed to fetch NZB', error?.message || error);
    res.status(502).json({ error: sanitizeErrorForClient(error) || 'Unable to fetch NZB' });
  }
}

['/:token/nzb/fetch/:encodedParams', '/nzb/fetch/:encodedParams'].forEach((route) => {
  app.get(route, handleNzbFetch);
  app.head(route, handleNzbFetch);
});

function startHttpServer() {
  if (serverInstance) {
    return serverInstance;
  }

  const keepAliveTimeoutMs = 65000;
  const headersTimeoutMs = 70000;

  serverInstance = app.listen(currentPort, SERVER_HOST, () => {
    console.log(`Addon running at http://${SERVER_HOST}:${currentPort}`);
  });
  serverInstance.keepAliveTimeout = keepAliveTimeoutMs;
  serverInstance.headersTimeout = headersTimeoutMs;
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

// Startup security checks (v1.7.6+)
if (!ADDON_SHARED_SECRET) {
  console.error('[SECURITY] ✖ ADDON_SHARED_SECRET is NOT set — all endpoints are locked (503).');
  console.error('[SECURITY] ✖ Set ADDON_SHARED_SECRET in your Docker environment or .env file and restart.');
} else if (ADDON_STREAM_TOKEN && ADDON_STREAM_TOKEN !== ADDON_SHARED_SECRET) {
  console.log('[SECURITY] ✓ Admin token and stream token are separate — good.');
} else {
  console.log('[SECURITY] ✓ ADDON_SHARED_SECRET is set.');
}

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
