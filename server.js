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
const {
  testIndexerConnection,
  testNzbdavConnection,
  testUsenetConnection,
  testNewznabConnection,
  testNewznabSearch,
} = require('./connectionTests');
const { parseStringPromise: parseXmlString } = require('xml2js');
const { triageAndRank } = require('./nzbTriageRunner');
const { preWarmNntpPool } = require('./nzbTriage');
const {
  getPublishMetadataFromResult,
  areReleasesWithinDays,
} = require('./publishInfo');
const { parseReleaseMetadata, LANGUAGE_FILTERS, LANGUAGE_SYNONYMS } = require('./releaseMetadata');

runtimeEnv.applyRuntimeEnv();

const app = express();
const port = Number(process.env.PORT || 7000);
const ADDON_VERSION = '1.3.1';

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
  res.json({
    values,
    manifestUrl: computeManifestUrl(),
    runtimeEnvPath: runtimeEnv.RUNTIME_ENV_FILE,
    debugNewznabSearch: DEBUG_NEWZNAB_SEARCH,
  });
});

function scheduleRestart() {
  setTimeout(() => {
    console.log('[ADMIN] Restarting service to apply configuration changes...');
    process.exit(0);
  }, 300);
}
adminApiRouter.post('/config', (req, res) => {
  const payload = req.body || {};
  const incoming = payload.values;
  if (!incoming || typeof incoming !== 'object') {
    res.status(400).json({ error: 'Invalid payload: expected "values" object' });
    return;
  }

  const updates = {};
  // Clear all numbered Newznab keys by default; incoming values will repopulate existing ones
  for (let i = 1; i <= 20; i += 1) {
    const idx = String(i).padStart(2, '0');
    updates[`NEWZNAB_ENDPOINT_${idx}`] = null;
    updates[`NEWZNAB_API_KEY_${idx}`] = null;
    updates[`NEWZNAB_API_PATH_${idx}`] = null;
    updates[`NEWZNAB_NAME_${idx}`] = null;
    updates[`NEWZNAB_INDEXER_ENABLED_${idx}`] = null;
  }
  ADMIN_CONFIG_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      const value = incoming[key];
      if (value === null || value === undefined) {
        updates[key] = '';
      } else if (typeof value === 'boolean') {
        updates[key] = value ? 'true' : 'false';
      } else {
        updates[key] = String(value);
      }
    }
  });

  try {
    runtimeEnv.updateRuntimeEnv(updates);
    runtimeEnv.applyRuntimeEnv();
    clearAllCaches('admin-config-save');
  } catch (error) {
    console.error('[ADMIN] Failed to update configuration', error);
    res.status(500).json({ error: 'Failed to persist configuration changes' });
    return;
  }

  res.json({ success: true, manifestUrl: computeManifestUrl(), restarting: true });
  scheduleRestart();
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

function extractTokenFromRequest(req) {
  const pathMatch = (req.path || '').match(/^\/([^\/]+)\/(manifest\.json|stream|nzb)(?:\b|\/)/i);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1].trim();
  }
  if (req.params && typeof req.params.token === 'string') {
    return req.params.token.trim();
  }
  const authHeader = req.headers['authorization'] || req.headers['x-addon-token'];
  if (typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^token$/i.test(parts[0])) {
      return parts[1].trim();
    }
    return authHeader.trim();
  }
  return '';
}

function ensureSharedSecret(req, res, next) {
  if (!ADDON_SHARED_SECRET) {
    next();
    return;
  }
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const providedToken = extractTokenFromRequest(req);
  if (!providedToken || providedToken !== ADDON_SHARED_SECRET) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing addon token' });
    return;
  }
  next();
}

app.use('/admin/api', (req, res, next) => ensureSharedSecret(req, res, next), adminApiRouter);
app.use('/admin', adminStatic);
app.use('/:token/admin', (req, res, next) => {
  ensureSharedSecret(req, res, (err) => {
    if (err) return;
    adminStatic(req, res, next);
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/assets/')) return next();
  if (req.path.startsWith('/admin') && !req.path.startsWith('/admin/api')) return next();
  if (/^\/[^/]+\/admin/.test(req.path) && !/^\/[^/]+\/admin\/api/.test(req.path)) return next();
  return ensureSharedSecret(req, res, next);
});

// Additional authentication middleware is registered after admin routes are defined

// Configure indexer manager (Prowlarr or NZBHydra)
const INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'prowlarr').trim().toLowerCase();
const INDEXER_MANAGER_URL = (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || '').trim();
const INDEXER_MANAGER_API_KEY = (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || '').trim();
const INDEXER_MANAGER_STRICT_ID_MATCH = (process.env.INDEXER_MANAGER_STRICT_ID_MATCH || process.env.PROWLARR_STRICT_ID_MATCH || 'false').toLowerCase() === 'true';
const INDEXER_MANAGER_INDEXERS = (() => {
  const fallback = INDEXER_MANAGER === 'nzbhydra' ? '' : '-1';
  const raw = (process.env.INDEXER_MANAGER_INDEXERS || process.env.PROWLARR_INDEXER_IDS || '').trim();
  if (!raw) return fallback;
  const joined = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .join(',');
  return joined || fallback;
})();
const INDEXER_MANAGER_LABEL = INDEXER_MANAGER === 'nzbhydra' ? 'NZBHydra' : 'Prowlarr';
const INDEXER_LOG_PREFIX = `[${INDEXER_MANAGER_LABEL.toUpperCase()}]`;
const INDEXER_MANAGER_CACHE_MINUTES = (() => {
  const raw = Number(process.env.INDEXER_MANAGER_CACHE_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
})();
const INDEXER_MANAGER_BASE_URL = INDEXER_MANAGER_URL.replace(/\/+$/, '');
const ADDON_SHARED_SECRET = (process.env.ADDON_SHARED_SECRET || '').trim();
// Optional: temporarily skip manager calls after failures (backoff)
const INDEXER_MANAGER_BACKOFF_ENABLED = toBoolean(process.env.INDEXER_MANAGER_BACKOFF_ENABLED, true);
const INDEXER_MANAGER_BACKOFF_SECONDS = toPositiveInt(process.env.INDEXER_MANAGER_BACKOFF_SECONDS, 120);
let indexerManagerUnavailableUntil = 0;
const DEBUG_NEWZNAB_SEARCH = ['1','true','yes','on'].includes(String(process.env.DEBUG_NEWZNAB_SEARCH || '').trim().toLowerCase());

function maskApiKey(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '****';
  return `${s.slice(0,3)}***${s.slice(-2)}`;
}

// Optional Newznab (direct) support in addition to the indexer manager
const NEWZNAB_ENABLED = toBoolean(process.env.NEWZNAB_ENABLED, false);
const NEWZNAB_FILTER_NZB_ONLY = toBoolean(process.env.NEWZNAB_FILTER_NZB_ONLY, true);
// Parse NEWZNAB_ENDPOINT_01, NEWZNAB_API_KEY_01, etc.
function parseNumberedNewznabConfigs(env) {
  const configs = [];
  for (let i = 1; i <= 20; ++i) {
    const idx = String(i).padStart(2, '0');
    const endpoint = env[`NEWZNAB_ENDPOINT_${idx}`];
    if (!endpoint) continue;
    const enabled = toBoolean(env[`NEWZNAB_INDEXER_ENABLED_${idx}`], true);
    configs.push({
      url: stripTrailingSlashes(endpoint),
      apiKey: env[`NEWZNAB_API_KEY_${idx}`] || '',
      apiPath: normalizeApiPath(env[`NEWZNAB_API_PATH_${idx}`] || '/api'),
      name: (env[`NEWZNAB_NAME_${idx}`] || '').trim() || null,
      enabled,
    });
  }
  return configs.filter((c) => c.enabled !== false);
}
const newznabConfigs = (() => {
  const configs = parseNumberedNewznabConfigs(process.env);
  console.log('[NEWZNAB] Startup config check', {
    enabled: NEWZNAB_ENABLED,
    configs,
    filterNzbOnly: NEWZNAB_FILTER_NZB_ONLY,
  });
  if (!NEWZNAB_ENABLED || configs.length === 0) {
    console.log('[NEWZNAB] Direct Newznab support is disabled or no endpoints configured');
    return [];
  }
  console.log('[NEWZNAB] Configured endpoints', configs.map(c => ({ url: c.url, hasKey: !!c.apiKey, apiPath: c.apiPath, name: c.name || undefined })));
  return configs;
})();

function decodeBase64Value(value) {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch (error) {
    console.warn('[SPECIAL META] Failed to decode base64 value');
    return '';
  }
}

function stripTrailingSlashes(value) {
  if (!value) return '';
  let result = value;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

function normalizeApiPath(p) {
  if (!p || typeof p !== 'string') return '/api';
  let v = p.trim();
  if (!v) return '/api';
  // If a full URL accidentally provided, take just pathname
  try {
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      v = u.pathname;
    }
  } catch (_) {}
  if (!v.startsWith('/')) v = '/' + v;
  // Remove trailing slashes
  while (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1);
  return v || '/api';
}

function toFiniteNumber(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function toPositiveInt(value, defaultValue) {
  const parsed = toFiniteNumber(value, undefined);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseCommaList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePathList(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => (path.isAbsolute(segment) ? segment : path.resolve(process.cwd(), segment)));
}

const SORT_MODE_OPTIONS = new Set(['quality_then_size', 'language_quality_size']);

const LANGUAGE_PREFERENCE_ALIASES = {
  en: 'English',
  'en-us': 'English',
  'en-gb': 'English',
  'en-au': 'English',
  ta: 'Tamil',
  hi: 'Hindi',
  'hi-in': 'Hindi',
  ml: 'Malayalam',
  kn: 'Kannada',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
  bn: 'Bengali',
  ne: 'Nepali',
  ur: 'Urdu',
  tl: 'Tagalog',
  fil: 'Filipino',
  ms: 'Malay',
  zh: 'Chinese',
  'zh-cn': 'Chinese',
  'zh-hans': 'Chinese',
  'zh-hant': 'Taiwanese',
  'zh-tw': 'Taiwanese',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  'de-de': 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  'es-es': 'Spanish',
  'es-419': 'Latino',
  'es-mx': 'Latino',
  'es-ar': 'Latino',
  pt: 'Portuguese',
  'pt-br': 'Portuguese',
  'pt-pt': 'Portuguese',
  ru: 'Russian',
  uk: 'Ukrainian',
  pl: 'Polish',
  cs: 'Czech',
  tr: 'Turkish',
  el: 'Greek',
  nl: 'Dutch',
  sv: 'Swedish',
  no: 'Norwegian',
  nb: 'Norwegian',
  nn: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  ro: 'Romanian',
  hu: 'Hungarian',
  th: 'Thai',
  id: 'Indonesian',
  vi: 'Vietnamese',
  ar: 'Arabic',
  he: 'Hebrew',
  iw: 'Hebrew',
  lt: 'Lithuanian',
  mn: 'Mongolian',
  hy: 'Armenian',
  ka: 'Georgian',
  'la': 'Latino',
};

const LANGUAGE_ALIAS_MAP = (() => {
  const map = new Map();
  LANGUAGE_FILTERS.forEach((language) => {
    if (!language) return;
    map.set(language.toLowerCase(), language);
  });
  if (LANGUAGE_SYNONYMS) {
    Object.entries(LANGUAGE_SYNONYMS).forEach(([language, tokens]) => {
      if (!language || !Array.isArray(tokens)) return;
      tokens.forEach((token) => {
        if (!token) return;
        map.set(token.toLowerCase(), language);
      });
    });
  }
  Object.entries(LANGUAGE_PREFERENCE_ALIASES).forEach(([alias, language]) => {
    if (!language) return;
    map.set(alias.toLowerCase(), language);
  });
  return map;
})();

const DEFAULT_MAX_RESULT_SIZE_GB = 30;

function normalizeSortMode(value, fallback = 'quality_then_size') {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (SORT_MODE_OPTIONS.has(normalized)) {
      return normalized;
    }
  }
  return fallback;
}

function resolvePreferredLanguage(value, fallback = '') {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  const direct = LANGUAGE_ALIAS_MAP.get(normalized);
  if (direct) return direct;
  if (normalized.includes('-')) {
    const short = normalized.split('-')[0];
    const shortMatch = LANGUAGE_ALIAS_MAP.get(short);
    if (shortMatch) return shortMatch;
  }
  return fallback;
}

function toSizeBytesFromGb(value) {
  const numeric = toFiniteNumber(value, null);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric * 1024 * 1024 * 1024;
}

function collectConfigValues(keys) {
  const values = {};
  keys.forEach((key) => {
    values[key] = process.env[key] ?? '';
  });
  return values;
}

function computeManifestUrl() {
  const baseUrl = (process.env.ADDON_BASE_URL || '').trim();
  if (!baseUrl) return '';
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const tokenSegment = ADDON_SHARED_SECRET ? `/${ADDON_SHARED_SECRET}` : '';
  return `${normalizedBase}${tokenSegment}/manifest.json`;
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

const INDEXER_SORT_MODE = normalizeSortMode(process.env.NZB_SORT_MODE, 'quality_then_size');
const INDEXER_PREFERRED_LANGUAGE = resolvePreferredLanguage(process.env.NZB_PREFERRED_LANGUAGE, '');
const INDEXER_MAX_RESULT_SIZE_BYTES = toSizeBytesFromGb(
  process.env.NZB_MAX_RESULT_SIZE_GB && process.env.NZB_MAX_RESULT_SIZE_GB !== ''
    ? process.env.NZB_MAX_RESULT_SIZE_GB
    : DEFAULT_MAX_RESULT_SIZE_GB
);
const TRIAGE_ENABLED = toBoolean(process.env.NZB_TRIAGE_ENABLED, false);
const TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 35000);
const TRIAGE_MAX_CANDIDATES = toPositiveInt(process.env.NZB_TRIAGE_MAX_CANDIDATES, 25);
const TRIAGE_DOWNLOAD_CONCURRENCY = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_CONCURRENCY, 8);
const TRIAGE_PRIORITY_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXERS);
const TRIAGE_HEALTH_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_HEALTH_INDEXERS);
const TRIAGE_SERIALIZED_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_SERIALIZED_INDEXERS);
const TRIAGE_ARCHIVE_DIRS = parsePathList(process.env.NZB_TRIAGE_ARCHIVE_DIRS);
const TRIAGE_NNTP_CONFIG = buildTriageNntpConfig();
const TRIAGE_MAX_DECODED_BYTES = toPositiveInt(process.env.NZB_TRIAGE_MAX_DECODED_BYTES, 32 * 1024);
const TRIAGE_NNTP_MAX_CONNECTIONS = toPositiveInt(process.env.NZB_TRIAGE_MAX_CONNECTIONS, 60);
const TRIAGE_MAX_PARALLEL_NZBS = toPositiveInt(process.env.NZB_TRIAGE_MAX_PARALLEL_NZBS, 16);
const TRIAGE_STAT_SAMPLE_COUNT = toPositiveInt(process.env.NZB_TRIAGE_STAT_SAMPLE_COUNT, 2);
const TRIAGE_ARCHIVE_SAMPLE_COUNT = toPositiveInt(process.env.NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT, 1);
const TRIAGE_REUSE_POOL = toBoolean(process.env.NZB_TRIAGE_REUSE_POOL, true);
const TRIAGE_NNTP_KEEP_ALIVE_MS = toPositiveInt(process.env.NZB_TRIAGE_NNTP_KEEP_ALIVE_MS, 0);

const TRIAGE_BASE_OPTIONS = {
  archiveDirs: TRIAGE_ARCHIVE_DIRS,
  maxDecodedBytes: TRIAGE_MAX_DECODED_BYTES,
  nntpMaxConnections: TRIAGE_NNTP_MAX_CONNECTIONS,
  maxParallelNzbs: TRIAGE_MAX_PARALLEL_NZBS,
  statSampleCount: TRIAGE_STAT_SAMPLE_COUNT,
  archiveSampleCount: TRIAGE_ARCHIVE_SAMPLE_COUNT,
  reuseNntpPool: TRIAGE_REUSE_POOL,
  nntpKeepAliveMs: TRIAGE_NNTP_KEEP_ALIVE_MS,
  healthCheckTimeoutMs: TRIAGE_TIME_BUDGET_MS,
};

if (TRIAGE_REUSE_POOL && TRIAGE_NNTP_CONFIG) {
  preWarmNntpPool({
    nntpConfig: { ...TRIAGE_NNTP_CONFIG },
    nntpMaxConnections: TRIAGE_NNTP_MAX_CONNECTIONS,
    reuseNntpPool: TRIAGE_REUSE_POOL,
    nntpKeepAliveMs: TRIAGE_NNTP_KEEP_ALIVE_MS,
  })
    .then(() => {
      // console.log('[NZB TRIAGE] Pre-warmed NNTP pool with shared configuration');
    })
    .catch((err) => {
      console.warn('[NZB TRIAGE] Unable to pre-warm NNTP pool', err?.message || err);
    });
}

const NEWZNAB_NUMBERED_KEYS = (() => {
  const list = [];
  for (let i = 1; i <= 20; i += 1) {
    const idx = String(i).padStart(2, '0');
    list.push(`NEWZNAB_ENDPOINT_${idx}`);
    list.push(`NEWZNAB_API_KEY_${idx}`);
    list.push(`NEWZNAB_API_PATH_${idx}`);
    list.push(`NEWZNAB_NAME_${idx}`);
    list.push(`NEWZNAB_INDEXER_ENABLED_${idx}`);
  }
  return list;
})();

const ADMIN_CONFIG_KEYS = [
  'PORT',
  'ADDON_BASE_URL',
  'ADDON_SHARED_SECRET',
  'INDEXER_MANAGER',
  'INDEXER_MANAGER_URL',
  'INDEXER_MANAGER_API_KEY',
  'INDEXER_MANAGER_STRICT_ID_MATCH',
  'INDEXER_MANAGER_INDEXERS',
  'INDEXER_MANAGER_CACHE_MINUTES',
  // Newznab direct support
  'NEWZNAB_ENABLED',
  // Numbered per-indexer fields only
  ...NEWZNAB_NUMBERED_KEYS,
  'NEWZNAB_FILTER_NZB_ONLY',
  'NZB_SORT_MODE',
  'NZB_PREFERRED_LANGUAGE',
  'NZB_MAX_RESULT_SIZE_GB',
  'NZBDAV_URL',
  'NZBDAV_API_KEY',
  'NZBDAV_WEBDAV_URL',
  'NZBDAV_WEBDAV_USER',
  'NZBDAV_WEBDAV_PASS',
  'NZBDAV_CATEGORY',
  'NZBDAV_CATEGORY_MOVIES',
  'NZBDAV_CATEGORY_SERIES',
  'NZB_TRIAGE_HEALTH_INDEXERS',
  'SPECIAL_PROVIDER_ID',
  'SPECIAL_PROVIDER_URL',
  'SPECIAL_PROVIDER_SECRET',
  'NZB_TRIAGE_ENABLED',
  'NZB_TRIAGE_TIME_BUDGET_MS',
  'NZB_TRIAGE_MAX_CANDIDATES',
  'NZB_TRIAGE_PRIORITY_INDEXERS',
  'NZB_TRIAGE_SERIALIZED_INDEXERS',
  'NZB_TRIAGE_DOWNLOAD_CONCURRENCY',
  'NZB_TRIAGE_MAX_CONNECTIONS',
  'NZB_TRIAGE_MAX_PARALLEL_NZBS',
  'NZB_TRIAGE_STAT_SAMPLE_COUNT',
  'NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT',
  'NZB_TRIAGE_MAX_DECODED_BYTES',
  'NZB_TRIAGE_NNTP_HOST',
  'NZB_TRIAGE_NNTP_PORT',
  'NZB_TRIAGE_NNTP_TLS',
  'NZB_TRIAGE_NNTP_USER',
  'NZB_TRIAGE_NNTP_PASS',
  'NZB_TRIAGE_ARCHIVE_DIRS',
  'NZB_TRIAGE_REUSE_POOL',
  'NZB_TRIAGE_NNTP_KEEP_ALIVE_MS',
];

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
  const preferredLanguage = query.preferredLanguage ?? query.language ?? query.lang;
  return {
    maxSizeBytes,
    indexers,
    disabled,
    enabled,
    sortMode: typeof sortMode === 'string' ? sortMode : null,
    preferredLanguage: typeof preferredLanguage === 'string' ? preferredLanguage : null,
  };
}

const OBFUSCATED_SPECIAL_PROVIDER_URL = 'aHR0cHM6Ly9kaXJ0eS1waW5rLmVycy5wdw==';
const OBFUSCATED_SPECIAL_ID_PREFIX = 'cG9ybmRi';
const SPECIAL_ID_PREFIX = decodeBase64Value(OBFUSCATED_SPECIAL_ID_PREFIX) || String.fromCharCode(112, 111, 114, 110, 100, 98);
const specialCatalogPrefixes = new Set(['pt', SPECIAL_ID_PREFIX]);
const EXTERNAL_SPECIAL_PROVIDER_URL = (() => {
  const configured = (process.env.EXTERNAL_SPECIAL_ADDON_URL || process.env.EXTERNAL_ADDON_URL || '').trim();
  if (configured) {
    return stripTrailingSlashes(configured);
  }
  const decoded = decodeBase64Value(OBFUSCATED_SPECIAL_PROVIDER_URL);
  return decoded ? stripTrailingSlashes(decoded) : '';
})();

// Configure NZBDav
const ADDON_BASE_URL = (process.env.ADDON_BASE_URL || '').trim();
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

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';
const pipelineAsync = promisify(pipeline);

const STREAM_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.STREAM_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 5 * 60 * 1000;
})();
const STREAM_CACHE_MAX_ENTRIES = toPositiveInt(process.env.STREAM_CACHE_MAX_ENTRIES, 200);
const STREAM_CACHE_MAX_BYTES = toPositiveInt(process.env.STREAM_CACHE_MAX_BYTES, 25 * 1024 * 1024);
const streamResponseCache = new Map();
let streamCacheBytes = 0;

const VERIFIED_NZB_CACHE_MAX_BYTES = toPositiveInt(process.env.VERIFIED_NZB_CACHE_MAX_BYTES, 200 * 1024 * 1024);
const VERIFIED_NZB_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.VERIFIED_NZB_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 60 * 60 * 1000;
})();
const verifiedNzbCacheByUrl = new Map();
let verifiedNzbCacheBytes = 0;


const posixPath = path.posix;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function estimateCacheEntrySize(payload, meta) {
  try {
    return Buffer.byteLength(JSON.stringify({ payload, meta }));
  } catch (error) {
    return 0;
  }
}

function cleanupStreamCache(now = Date.now()) {
  if (streamResponseCache.size === 0) return;
  if (STREAM_CACHE_TTL_MS > 0) {
    for (const [key, entry] of streamResponseCache.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        streamResponseCache.delete(key);
        streamCacheBytes -= entry.size;
      }
    }
  }
  while (
    (STREAM_CACHE_MAX_BYTES > 0 && streamCacheBytes > STREAM_CACHE_MAX_BYTES)
    || (STREAM_CACHE_MAX_ENTRIES > 0 && streamResponseCache.size > STREAM_CACHE_MAX_ENTRIES)
  ) {
    const oldestKey = streamResponseCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = streamResponseCache.get(oldestKey);
    streamResponseCache.delete(oldestKey);
    if (oldest) streamCacheBytes -= oldest.size;
  }
}

function clearStreamResponseCache(reason = 'manual') {
  if (streamResponseCache.size > 0) {
    console.log('[CACHE] Cleared stream response cache', { reason, entries: streamResponseCache.size });
  }
  streamResponseCache.clear();
  streamCacheBytes = 0;
}

function getStreamCacheEntry(cacheKey) {
  if (!cacheKey || STREAM_CACHE_MAX_ENTRIES <= 0) return null;
  cleanupStreamCache();
  const entry = streamResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    streamResponseCache.delete(cacheKey);
    streamCacheBytes -= entry.size;
    return null;
  }
  return entry;
}

function setStreamCacheEntry(cacheKey, payload, meta = null) {
  if (!cacheKey || STREAM_CACHE_MAX_ENTRIES <= 0) return;
  const size = estimateCacheEntrySize(payload, meta);
  if (size <= 0 || (STREAM_CACHE_MAX_BYTES > 0 && size > STREAM_CACHE_MAX_BYTES)) return;
  const expiresAt = STREAM_CACHE_TTL_MS > 0 ? Date.now() + STREAM_CACHE_TTL_MS : null;
  const existing = streamResponseCache.get(cacheKey);
  if (existing) {
    streamCacheBytes -= existing.size;
    streamResponseCache.delete(cacheKey);
  }
  streamResponseCache.set(cacheKey, { payload, meta, expiresAt, size });
  streamCacheBytes += size;
  cleanupStreamCache();
}

function cleanupVerifiedNzbCache(now = Date.now()) {
  if (verifiedNzbCacheByUrl.size === 0) return;
  if (VERIFIED_NZB_CACHE_TTL_MS > 0) {
    for (const [url, entry] of verifiedNzbCacheByUrl.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        verifiedNzbCacheByUrl.delete(url);
        verifiedNzbCacheBytes -= entry.size;
      }
    }
  }
  while (VERIFIED_NZB_CACHE_MAX_BYTES > 0 && verifiedNzbCacheBytes > VERIFIED_NZB_CACHE_MAX_BYTES) {
    const oldestKey = verifiedNzbCacheByUrl.keys().next().value;
    if (!oldestKey) break;
    const oldest = verifiedNzbCacheByUrl.get(oldestKey);
    verifiedNzbCacheByUrl.delete(oldestKey);
    if (oldest) verifiedNzbCacheBytes -= oldest.size;
  }
}

function getVerifiedNzbCacheEntry(downloadUrl) {
  if (!downloadUrl || VERIFIED_NZB_CACHE_MAX_BYTES <= 0) return null;
  cleanupVerifiedNzbCache();
  const entry = verifiedNzbCacheByUrl.get(downloadUrl);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    verifiedNzbCacheByUrl.delete(downloadUrl);
    verifiedNzbCacheBytes -= entry.size;
    return null;
  }
  entry.lastAccess = Date.now();
  return entry;
}

function cacheVerifiedNzbPayload(downloadUrl, nzbPayload, metadata = {}) {
  if (!downloadUrl || typeof nzbPayload !== 'string' || nzbPayload.length === 0) return;
  if (VERIFIED_NZB_CACHE_MAX_BYTES <= 0) return;
  const payloadBuffer = Buffer.from(nzbPayload, 'utf8');
  const size = payloadBuffer.length;
  if (size > VERIFIED_NZB_CACHE_MAX_BYTES) return;
  const expiresAt = VERIFIED_NZB_CACHE_TTL_MS > 0 ? Date.now() + VERIFIED_NZB_CACHE_TTL_MS : null;
  const existing = verifiedNzbCacheByUrl.get(downloadUrl);
  if (existing) {
    verifiedNzbCacheBytes -= existing.size;
  }
  verifiedNzbCacheByUrl.set(downloadUrl, {
    downloadUrl,
    payloadBuffer,
    size,
    metadata: {
      title: metadata.title || null,
      sizeBytes: metadata.size || null,
      fileName: metadata.fileName || null,
    },
    expiresAt,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  });
  verifiedNzbCacheBytes += size;
  cleanupVerifiedNzbCache();
}

function clearVerifiedNzbCache(reason = 'manual') {
  if (verifiedNzbCacheByUrl.size > 0) {
    console.log('[CACHE] Cleared verified NZB cache', { reason, entries: verifiedNzbCacheByUrl.size });
  }
  verifiedNzbCacheByUrl.clear();
  verifiedNzbCacheBytes = 0;
}

function buildVerifiedNzbFileName(entry, fallbackTitle = null) {
  const preferred = entry?.metadata?.fileName || entry?.metadata?.title || fallbackTitle || 'verified-nzb';
  const sanitized = preferred
    .toString()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'verified-nzb';
  return sanitized.toLowerCase().endsWith('.nzb') ? sanitized : `${sanitized}.nzb`;
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
  return results.map((result) => ({
    downloadUrl: result.downloadUrl,
    title: result.title,
    size: result.size,
    indexerId: result.indexerId,
    indexer: result.indexer,
    guid: result.guid,
    _sourceType: result._sourceType,
    age: result.age,
    ageDays: result.ageDays,
    publishDateMs: result.publishDateMs,
    publishDateIso: result.publishDateIso,
  }));
}

function restoreFinalNzbResults(serialized) {
  if (!Array.isArray(serialized)) return [];
  return serialized
    .filter((entry) => entry && entry.downloadUrl)
    .map((entry) => ({ ...entry }));
}

function annotateNzbResult(result, sortIndex = 0) {
  if (!result || typeof result !== 'object') return null;
  const release = parseReleaseMetadata(result.title || '');
  const normalizedTitle = normalizeReleaseTitle(result.title) || result.normalizedTitle || result.downloadUrl;
  return {
    ...result,
    normalizedTitle,
    release: {
      resolution: release.resolution || null,
      qualityLabel: release.qualityLabel || null,
      qualityScore: release.qualityScore || 0,
      languages: Array.isArray(release.languages) ? release.languages : [],
    },
    _sortIndex: sortIndex,
  };
}

function applyMaxSizeFilter(results, maxSizeBytes) {
  if (!Number.isFinite(maxSizeBytes) || maxSizeBytes <= 0) {
    return results.slice();
  }
  return results.filter((result) => {
    const size = Number(result?.size);
    return !Number.isFinite(size) || size <= maxSizeBytes;
  });
}

function resultMatchesPreferredLanguage(result, preferredLanguage) {
  if (!preferredLanguage) return false;
  let languages = Array.isArray(result?.release?.languages) ? result.release.languages : [];
  if (!languages.length && result?.title) {
    const fallback = parseReleaseMetadata(result.title);
    if (fallback?.languages?.length) {
      languages = fallback.languages;
      result.release = Object.assign({}, result.release, {
        languages: fallback.languages,
        resolution: result.release?.resolution || fallback.resolution || null,
        qualityLabel: result.release?.qualityLabel || fallback.qualityLabel || null,
        qualityScore: Number.isFinite(result.release?.qualityScore)
          ? result.release.qualityScore
          : fallback.qualityScore,
      });
    }
  }
  if (!languages.length) return false;
  return languages.some((language) => language && language.toLowerCase() === preferredLanguage.toLowerCase());
}

function compareQualityThenSize(a, b) {
  const qualityDiff = (b?.release?.qualityScore || 0) - (a?.release?.qualityScore || 0);
  if (qualityDiff !== 0) return qualityDiff;
  const sizeDiff = (Number(b?.size) || 0) - (Number(a?.size) || 0);
  if (sizeDiff !== 0) return sizeDiff;
  const dateDiff = (b?.publishDateMs || 0) - (a?.publishDateMs || 0);
  if (dateDiff !== 0) return dateDiff;
  return (a?._sortIndex || 0) - (b?._sortIndex || 0);
}

function sortAnnotatedResults(results, sortMode, preferredLanguage) {
  const activeMode = normalizeSortMode(sortMode, INDEXER_SORT_MODE);
  const activeLanguage = resolvePreferredLanguage(preferredLanguage, INDEXER_PREFERRED_LANGUAGE);
  const working = results.slice();
  if (activeMode === 'language_quality_size' && activeLanguage) {
    const preferredBucket = [];
    const secondaryBucket = [];
    working.forEach((result) => {
      if (resultMatchesPreferredLanguage(result, activeLanguage)) {
        preferredBucket.push(result);
      } else {
        secondaryBucket.push(result);
      }
    });
    preferredBucket.sort(compareQualityThenSize);
    secondaryBucket.sort(compareQualityThenSize);
    return preferredBucket.concat(secondaryBucket);
  }
  return working.sort(compareQualityThenSize);
}

function prepareSortedResults(results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const annotated = results
    .map((result, index) => annotateNzbResult(result, index))
    .filter(Boolean);
  const filtered = applyMaxSizeFilter(annotated, options.maxSizeBytes ?? INDEXER_MAX_RESULT_SIZE_BYTES);
  return sortAnnotatedResults(filtered, options.sortMode, options.preferredLanguage);
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

const nzbdavStreamCache = new Map();
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

function ensureNzbdavConfigured() {
  if (!NZBDAV_URL) {
    throw new Error('NZBDAV_URL is not configured');
  }
  if (!NZBDAV_API_KEY) {
    throw new Error('NZBDAV_API_KEY is not configured');
  }
  if (!NZBDAV_WEBDAV_URL) {
    throw new Error('NZBDAV_WEBDAV_URL is not configured');
  }
}

function ensureIndexerManagerConfigured() {
  if (INDEXER_MANAGER === 'none') return; // manager disabled
  if (!INDEXER_MANAGER_URL) {
    throw new Error('INDEXER_MANAGER_URL is not configured');
  }
  if (!INDEXER_MANAGER_API_KEY) {
    throw new Error('INDEXER_MANAGER_API_KEY is not configured');
  }
}

function ensureAddonConfigured() {
  if (!ADDON_BASE_URL) {
    throw new Error('ADDON_BASE_URL is not configured');
  }
}

const isUsingProwlarr = () => INDEXER_MANAGER === 'prowlarr';
const isUsingNzbhydra = () => INDEXER_MANAGER === 'nzbhydra';
const PROWLARR_SEARCH_LIMIT = 1000;
const TRIAGE_DECISION_SHARING_WINDOW_DAYS = 14;

function buildProwlarrIndexerIdList() {
  if (!INDEXER_MANAGER_INDEXERS) return null;
  if (INDEXER_MANAGER_INDEXERS === '-1') return ['-1'];
  const tokens = INDEXER_MANAGER_INDEXERS.split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return tokens.length > 0 ? tokens : null;
}

function buildProwlarrSearchParams(plan) {
  return {
    limit: String(PROWLARR_SEARCH_LIMIT),
    offset: '0',
    type: plan.type,
    query: plan.query,
    indexerIdsList: buildProwlarrIndexerIdList()
  };
}

async function executeProwlarrSearch(plan) {
  const params = buildProwlarrSearchParams(plan);
  const urlSearchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'indexerIdsList' && Array.isArray(value)) {
      value.forEach((id) => {
        if (id !== undefined && id !== null && String(id).length > 0) {
          urlSearchParams.append('indexerIds', String(id));
        }
      });
    } else {
      urlSearchParams.append(key, String(value));
    }
  });
  const serializedParams = urlSearchParams.toString();
  const requestUrl = `${INDEXER_MANAGER_BASE_URL}/api/v1/search`;
  const fullUrl = serializedParams ? `${requestUrl}?${serializedParams}` : requestUrl;
  console.log('[PROWLARR] Requesting search', {
    url: fullUrl,
  });
  const response = await axios.get(fullUrl, {
    headers: { 'X-Api-Key': INDEXER_MANAGER_API_KEY },
    timeout: 60000
  });
  return Array.isArray(response.data) ? response.data : [];
}

function annotateNzbResult(result) {
  const publishMeta = getPublishMetadataFromResult(result);
  const ageDays = publishMeta.ageDays ?? (Number.isFinite(result.age) ? Number(result.age) : null);
  const publishDateMs = publishMeta.publishDateMs ?? result.publishDateMs ?? null;
  const publishDateIso = publishMeta.publishDateIso || result.publishDateIso || result.publishDate || result.publish_date || null;
  const resolvedAge = Number.isFinite(result.age)
    ? Number(result.age)
    : (ageDays !== null ? Math.round(ageDays) : undefined);

  return {
    ...result,
    publishDateMs,
    publishDateIso,
    ageDays,
    age: resolvedAge,
  };
}

function canShareDecision(decisionPublishDateMs, candidatePublishDateMs) {
  if (!TRIAGE_DECISION_SHARING_WINDOW_DAYS || TRIAGE_DECISION_SHARING_WINDOW_DAYS <= 0) {
    return true;
  }
  if (!decisionPublishDateMs || !candidatePublishDateMs) {
    return true;
  }
  return areReleasesWithinDays(
    decisionPublishDateMs,
    candidatePublishDateMs,
    TRIAGE_DECISION_SHARING_WINDOW_DAYS,
  );
}

function mapHydraSearchType(planType) {
  if (planType === 'tvsearch' || planType === 'movie' || planType === 'search' || planType === 'book') {
    return planType;
  }
  return 'search';
}

function applyTokenToHydraParams(token, params) {
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) {
    return;
  }
  const key = match[1].trim().toLowerCase();
  const rawValue = match[2].trim();

  switch (key) {
    case 'imdbid': {
      const value = rawValue.replace(/^tt/i, '');
      if (value) params.imdbid = value;
      break;
    }
    case 'tmdbid':
      if (rawValue) params.tmdbid = rawValue;
      break;
    case 'tvdbid':
      if (rawValue) params.tvdbid = rawValue;
      break;
    case 'season':
      if (rawValue) params.season = rawValue;
      break;
    case 'episode':
      if (rawValue) params.ep = rawValue;
      break;
    default:
      break;
  }
}

function buildHydraSearchParams(plan) {
  const params = {
    apikey: INDEXER_MANAGER_API_KEY,
    t: mapHydraSearchType(plan.type),
    o: 'json'
  };

  if (INDEXER_MANAGER_INDEXERS) {
    params.indexers = INDEXER_MANAGER_INDEXERS;
  }

  if (INDEXER_MANAGER_CACHE_MINUTES > 0) {
    params.cachetime = String(INDEXER_MANAGER_CACHE_MINUTES);
  }

  if (Array.isArray(plan.tokens)) {
    plan.tokens.forEach((token) => applyTokenToHydraParams(token, params));
  }

  if (plan.rawQuery) {
    params.q = plan.rawQuery;
  } else if ((!plan.tokens || plan.tokens.length === 0) && plan.query) {
    params.q = plan.query;
  }

  return params;
}

function extractHydraAttrMap(item) {
  const attrMap = {};
  const attrSources = [];

  const collectSource = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => attrSources.push(entry));
    } else {
      attrSources.push(source);
    }
  };

  collectSource(item.attr);
  collectSource(item.attrs);
  collectSource(item.attributes);
  collectSource(item['newznab:attr']);
  collectSource(item['newznab:attrs']);

  attrSources.forEach((attr) => {
    if (!attr) return;
    const entry = attr['@attributes'] || attr.attributes || attr.$ || attr;
    const rawName =
      entry.name ??
      entry.Name ??
      entry['@name'] ??
      entry['@Name'] ??
      entry.key ??
      entry.Key ??
      entry['@key'] ??
      entry['@Key'] ??
      entry.field ??
      entry.Field ??
      '';
    const name = rawName.toString().trim().toLowerCase();
    if (!name) return;
    const value =
      entry.value ??
      entry.Value ??
      entry['@value'] ??
      entry['@Value'] ??
      entry.val ??
      entry.Val ??
      entry.content ??
      entry.Content ??
      entry['#text'] ??
      entry.text ??
      entry['@text'];
    if (value !== undefined && value !== null) {
      attrMap[name] = value;
    }
  });

  return attrMap;
}

function normalizeHydraResults(data) {
  if (!data) return [];

  const resolveItems = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.item) return resolveItems(payload.item);
    return [payload];
  };

  const channel = data.channel || data.rss?.channel || data['rss']?.channel;
  const items = resolveItems(channel || data.item || []);

  const results = [];

  for (const item of items) {
    if (!item) continue;
    const title = item.title || item['title'] || null;

    let downloadUrl = null;
    const enclosure = item.enclosure || item['enclosure'];
    if (enclosure) {
      const enclosureObj = Array.isArray(enclosure) ? enclosure[0] : enclosure;
      downloadUrl = enclosureObj?.url || enclosureObj?.['@url'] || enclosureObj?.href || enclosureObj?.link;
    }
    if (!downloadUrl) {
      downloadUrl = item.link || item['link'];
    }
    if (!downloadUrl) {
      const guid = item.guid || item['guid'];
      if (typeof guid === 'string') {
        downloadUrl = guid;
      } else if (guid && typeof guid === 'object') {
        downloadUrl = guid._ || guid['#text'] || guid.url || guid.href;
      }
    }
    if (!downloadUrl) {
      continue;
    }

    const attrMap = extractHydraAttrMap(item);
    const resolveFirst = (...candidates) => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        if (Array.isArray(candidate)) {
          const inner = resolveFirst(...candidate);
          if (inner !== undefined && inner !== null) return inner;
          continue;
        }
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          return trimmed;
        }
        return candidate;
      }
      return undefined;
    };

    const enclosureObj = Array.isArray(enclosure) ? enclosure?.[0] : enclosure;
    const enclosureLength = enclosureObj?.length || enclosureObj?.['@length'] || enclosureObj?.['$']?.length || enclosureObj?.['@attributes']?.length;

    const sizeValue = resolveFirst(
      attrMap.size,
      attrMap.filesize,
      attrMap['contentlength'],
      attrMap['content-length'],
      attrMap.length,
      attrMap.nzbsize,
      item.size,
      item.Size,
      enclosureLength
    );
    const parsedSize = sizeValue !== undefined ? Number.parseInt(String(sizeValue), 10) : NaN;
    const indexer = resolveFirst(
      attrMap.indexername,
      attrMap.indexer,
      attrMap['hydraindexername'],
      attrMap['hydraindexer'],
      item.hydraIndexerName,
      item.hydraindexername,
      item.hydraIndexer,
      item.hydraindexer,
      item.indexer,
      item.Indexer
    );
    const indexerId = resolveFirst(attrMap.indexerid, attrMap['hydraindexerid'], item.hydraIndexerId, item.hydraindexerid, indexer) || 'nzbhydra';

    const guidRaw = item.guid || item['guid'];
    let guidValue = null;
    if (typeof guidRaw === 'string') {
      guidValue = guidRaw;
    } else if (guidRaw && typeof guidRaw === 'object') {
      guidValue = guidRaw._ || guidRaw['#text'] || guidRaw.url || guidRaw.href || null;
    }

    const publishDateCandidate = resolveFirst(
      item.pubDate,
      item.pubdate,
      item.PublishDate,
      attrMap.pubdate,
      attrMap['pub-date'],
      attrMap.publishdate,
      attrMap['publish-date'],
      attrMap.usenetdate,
      attrMap['usenet-date'],
    );
    results.push({
      title: title || downloadUrl,
      downloadUrl,
      guid: guidValue,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
      indexer,
      indexerId,
      publishDate: publishDateCandidate || undefined,
      pubDate: publishDateCandidate || undefined,
      publish_date: attrMap.publishdate || undefined,
      age: resolveFirst(attrMap.age, attrMap.age_days, attrMap['age-days']),
      ageDays: resolveFirst(attrMap.age_days, attrMap['age-days']),
      ageHours: resolveFirst(attrMap.agehours, attrMap['age-hours']),
      ageMinutes: resolveFirst(attrMap.ageminutes, attrMap['age-minutes']),
    });
  }

  return results;
}

async function executeNzbhydraSearch(plan) {
  const params = buildHydraSearchParams(plan);
  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api`, {
    params,
    timeout: 60000
  });
  return normalizeHydraResults(response.data);
}

function executeIndexerPlan(plan) {
  if (INDEXER_MANAGER === 'none') {
    return Promise.resolve([]);
  }
  if (isUsingNzbhydra()) {
    return executeNzbhydraSearch(plan);
  }
  return executeProwlarrSearch(plan);
}

function executeManagerPlanWithBackoff(plan) {
  if (INDEXER_MANAGER === 'none') return Promise.resolve([]);
  if (INDEXER_MANAGER_BACKOFF_ENABLED && Date.now() < indexerManagerUnavailableUntil) {
    const remaining = Math.ceil((indexerManagerUnavailableUntil - Date.now()) / 1000);
    console.warn(`[${INDEXER_MANAGER_LABEL}] Skipping manager call due to backoff (${remaining}s remaining)`);
    return Promise.resolve([]);
  }
  return executeIndexerPlan(plan).catch((err) => {
    if (INDEXER_MANAGER_BACKOFF_ENABLED) {
      indexerManagerUnavailableUntil = Date.now() + (INDEXER_MANAGER_BACKOFF_SECONDS * 1000);
      console.warn(`[${INDEXER_MANAGER_LABEL}] Marking manager unavailable for ${INDEXER_MANAGER_BACKOFF_SECONDS}s`, err?.message || err);
    }
    throw err;
  });
}

function normalizeNewznabItems(data) {
  // 1) Handle plain array responses (Prowlarr-like JSON arrays)
  if (Array.isArray(data)) {
    const items = [];
    for (const it of data) {
      if (!it) continue;
      const title = it.Title || it.title || it.Name || it.name || null;
      const downloadUrl = it.DownloadUrl || it.downloadUrl || it.Link || it.link || null;
      if (!downloadUrl) continue;
      const size = Number(it.Size || it.size);
      const publishDate = it.PublishDate || it.publishDate || it.pubDate || it.pubdate || null;
      const idx = it.Indexer || it.indexer || it.IndexerName || it.indexerName || null;
      const idxId = it.IndexerId || it.indexerId || idx || null;
      const guid = it.Guid || it.guid || null;
      items.push({
        title: title || downloadUrl,
        downloadUrl,
        guid,
        size: Number.isFinite(size) ? size : undefined,
        indexer: idx || undefined,
        indexerId: idxId || undefined,
        publishDate: publishDate || undefined,
      });
    }
    return items;
  }

  // 2) Fallback: reuse Hydra normalizer for Newznab RSS/JSON variants
  try {
    return normalizeHydraResults(data);
  } catch (_) {
    return [];
  }
}

function buildNewznabSearchParams(plan, apiKey) {
  const params = {
    apikey: apiKey || undefined,
    t: mapHydraSearchType(plan.type),
    // Request default XML (omit 'o=json') to maximize compatibility
  };

  // Prefer identifier tokens for strict Newznab semantics
  if (Array.isArray(plan.tokens) && plan.tokens.length > 0) {
    // Reuse the same token-applier used for Hydra; it maps {ImdbId:tt123} -> imdbid=123, etc.
    const mapped = {};
    plan.tokens.forEach((token) => applyTokenToHydraParams(token, mapped));
    // Patch: always prefix imdbid with 'tt' if present and not already
    if (mapped.imdbid && !String(mapped.imdbid).startsWith('tt')) {
      mapped.imdbid = 'tt' + String(mapped.imdbid);
    }
    Object.assign(params, mapped);
  }

  // If no tokens or we also want a text fallback for generic 'search'
  if (!params.imdbid && !params.tmdbid && !params.tvdbid) {
    if (plan.rawQuery) params.q = plan.rawQuery;
    else if (plan.query) params.q = plan.query;
  }

  return params;
}

async function executeNewznabSearch(plan) {
  if (!NEWZNAB_ENABLED || newznabConfigs.length === 0) return [];
  const tParam = mapHydraSearchType(plan.type);
  console.log('[NEWZNAB] Dispatching plan', {
    planType: plan.type,
    query: plan.query,
    rawQuery: plan.rawQuery,
    endpoints: newznabConfigs.map((c) => c.url),
  });
  const tasks = newznabConfigs.map(async ({ url, apiKey, apiPath, name }) => {
    const params = buildNewznabSearchParams(plan, apiKey);
    try {
      const requestUrl = `${stripTrailingSlashes(url)}${apiPath}`;
      if (DEBUG_NEWZNAB_SEARCH) {
        const debugParams = { ...params, apikey: params.apikey ? maskApiKey(params.apikey) : undefined };
        console.log('[NEWZNAB][SEARCH][REQ]', { url: requestUrl, params: debugParams });
      }
      const resp = await axios.get(requestUrl, { params, timeout: 30000, validateStatus: () => true });
      if (DEBUG_NEWZNAB_SEARCH) {
        const ct = resp.headers?.['content-type'] || resp.headers?.['Content-Type'] || '';
        let bodyPreview = '';
        try { bodyPreview = JSON.stringify(resp.data).slice(0, 400); } catch (_) { bodyPreview = '(unserializable)'; }
        console.log('[NEWZNAB][SEARCH][RESP]', { url: requestUrl, status: resp.status, contentType: ct, body: bodyPreview });
      }
      if (resp.status === 401 || resp.status === 403) {
        console.warn('[NEWZNAB] Unauthorized (check API key)', { url: requestUrl });
        return [];
      }
      if (resp.status >= 400) {
        console.warn('[NEWZNAB] Non-200 status', { url: requestUrl, status: resp.status });
        return [];
      }
      let parsed = resp.data;
      if (typeof parsed === 'string' && parsed.trim().startsWith('<')) {
        try {
          parsed = await parseXmlString(parsed, { explicitArray: false, explicitRoot: true, attrkey: '@attributes' });
        } catch (e) {
          console.warn('[NEWZNAB] Failed to parse XML response', { url: requestUrl, message: e?.message });
          return [];
        }
      }
      const items = normalizeNewznabItems(parsed);
      console.log('[NEWZNAB] Endpoint results', { url: requestUrl, count: Array.isArray(items) ? items.length : 0 });
      const label = name || url;
      return (Array.isArray(items) ? items : []).map((it) => ({ ...it, indexer: it.indexer || label, indexerId: it.indexerId || label }));
    } catch (err) {
      console.warn('[NEWZNAB] Search failed', { url, message: err?.message });
      return [];
    }
  });
  const arrays = await Promise.all(tasks);
  const flat = arrays.flat();
  console.log('[NEWZNAB] Aggregated endpoint results', { total: flat.length });
  if (NEWZNAB_FILTER_NZB_ONLY) {
    return flat.filter((r) => {
      const u = String(r.downloadUrl || '');
      if (!u) return false;
      if (/\.(nzb)(?:$|\?)/i.test(u)) return true;
      if (/\/getnzb(?:\/|\b)/i.test(u)) return true; // common newznab path
      if (/(^|[?&])t=getnzb(?:&|$)/i.test(u)) return true; // query param variant
      return false;
    });
  }
  return flat;
}

function getNzbdavCategory(type) {
  let baseCategory;
  let suffixKey;

  if (type === 'series' || type === 'tv') {
    baseCategory = NZBDAV_CATEGORY_SERIES;
    suffixKey = 'TV';
  } else if (type === 'movie') {
    baseCategory = NZBDAV_CATEGORY_MOVIES;
    suffixKey = 'MOVIE';
  } else {
    baseCategory = NZBDAV_CATEGORY_DEFAULT;
    suffixKey = 'DEFAULT';
  }

  if (NZBDAV_CATEGORY_OVERRIDE) {
    return `${NZBDAV_CATEGORY_OVERRIDE}_${suffixKey}`;
  }

  return baseCategory;
}

function buildNzbdavApiParams(mode, extra = {}) {
  return {
    mode,
    apikey: NZBDAV_API_KEY,
    ...extra
  };
}

function extractNzbdavQueueId(payload) {
  return payload?.nzo_id
    || payload?.nzoId
    || payload?.NzoId
    || (Array.isArray(payload?.nzo_ids) && payload.nzo_ids[0])
    || (Array.isArray(payload?.queue) && payload.queue[0]?.nzo_id)
    || null;
}

async function addNzbToNzbdav({ downloadUrl, cachedEntry = null, category, jobLabel }) {
  ensureNzbdavConfigured();

  if (!category) {
    throw new Error('Missing NZBDav category');
  }
  if (!downloadUrl && !cachedEntry) {
    throw new Error('Missing NZB source');
  }

  const jobLabelDisplay = jobLabel || 'untitled';
  if (cachedEntry?.payloadBuffer) {
    try {
      console.log(`[NZBDAV] Queueing cached NZB payload via addfile (${jobLabelDisplay})`);
      const form = new FormData();
      const uploadName = buildVerifiedNzbFileName(cachedEntry, jobLabel);
      form.append('nzbfile', cachedEntry.payloadBuffer, {
        filename: uploadName,
        contentType: 'application/x-nzb+xml'
      });

      const headers = {
        ...form.getHeaders(),
      };
      if (NZBDAV_API_KEY) {
        headers['x-api-key'] = NZBDAV_API_KEY;
      }

      const params = buildNzbdavApiParams('addfile', {
        cat: category,
        nzbname: jobLabel || undefined,
        output: 'json'
      });

      const response = await axios.post(`${NZBDAV_URL}/api`, form, {
        params,
        timeout: NZBDAV_API_TIMEOUT_MS,
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: (status) => status < 500,
      });

      if (!response.data?.status) {
        const errorMessage = response.data?.error || `addfile returned status ${response.status}`;
        throw new Error(errorMessage);
      }

      const nzoId = extractNzbdavQueueId(response.data);
      if (!nzoId) {
        throw new Error('addfile succeeded but no nzo_id returned');
      }

      console.log(`[NZBDAV] NZB queued with id ${nzoId} (uploaded payload)`);
      return { nzoId };
    } catch (error) {
      if (!downloadUrl) {
        throw new Error(`[NZBDAV] Failed to upload cached NZB: ${error.message}`);
      }
      console.warn(`[NZBDAV] addfile failed, falling back to addurl: ${error.message}`);
    }
  }

  if (!downloadUrl) {
    throw new Error('Unable to queue NZB: no download URL available');
  }

  console.log(`[NZBDAV] Queueing NZB via addurl for category=${category} (${jobLabelDisplay})`);

  const params = buildNzbdavApiParams('addurl', {
    name: downloadUrl,
    cat: category,
    nzbname: jobLabel || undefined,
    output: 'json'
  });

  const headers = {};
  if (NZBDAV_API_KEY) {
    headers['x-api-key'] = NZBDAV_API_KEY;
  }

  const response = await axios.get(`${NZBDAV_URL}/api`, {
    params,
    timeout: NZBDAV_API_TIMEOUT_MS,
    headers,
    validateStatus: (status) => status < 500
  });

  if (!response.data?.status) {
    const errorMessage = response.data?.error || `addurl returned status ${response.status}`;
    throw new Error(`[NZBDAV] Failed to queue NZB: ${errorMessage}`);
  }

  const nzoId = extractNzbdavQueueId(response.data);

  if (!nzoId) {
    throw new Error('[NZBDAV] addurl succeeded but no nzo_id returned');
  }

  console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
  return { nzoId };
}

async function waitForNzbdavHistorySlot(nzoId, category) {
  ensureNzbdavConfigured();
  const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const params = buildNzbdavApiParams('history', {
      start: '0',
      limit: '50',
      category
    });

    const headers = {};
    if (NZBDAV_API_KEY) {
      headers['x-api-key'] = NZBDAV_API_KEY;
    }

    const response = await axios.get(`${NZBDAV_URL}/api`, {
      params,
      timeout: NZBDAV_HISTORY_TIMEOUT_MS,
      headers,
      validateStatus: (status) => status < 500
    });

    if (!response.data?.status) {
      const errorMessage = response.data?.error || `history returned status ${response.status}`;
      throw new Error(`[NZBDAV] Failed to query history: ${errorMessage}`);
    }

    const history = response.data?.history || response.data?.History;
    const slots = history?.slots || history?.Slots || [];
    const slot = slots.find((entry) => {
      const entryId = entry?.nzo_id || entry?.nzoId || entry?.NzoId;
      return entryId === nzoId;
    });

    if (slot) {
      const status = (slot.status || slot.Status || '').toString().toLowerCase();
      if (status === 'completed') {
        console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
        return slot;
      }
      if (status === 'failed') {
        const failMessage = slot.fail_message || slot.failMessage || slot.FailMessage || 'Unknown NZBDav error';
        const failureError = new Error(`[NZBDAV] NZB failed: ${failMessage}`);
        failureError.isNzbdavFailure = true;
        failureError.failureMessage = failMessage;
        failureError.nzoId = nzoId;
        failureError.category = category;
        throw failureError;
      }
    }

    await sleep(NZBDAV_POLL_INTERVAL_MS);
  }

  throw new Error('[NZBDAV] Timeout while waiting for NZB to become streamable');
}

const getWebdavClient = (() => {
  let clientPromise = null;
  return async () => {
    if (clientPromise) return clientPromise;

    clientPromise = (async () => {
      const { createClient } = await import('webdav');

      const trimmedBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, '');
      const rootSegment = (NZBDAV_WEBDAV_ROOT || '').replace(/^\/+/, '').replace(/\/+$/, '');
      const baseUrl = rootSegment ? `${trimmedBase}/${rootSegment}` : trimmedBase;

      const authOptions = {};
      if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
        authOptions.username = NZBDAV_WEBDAV_USER;
        authOptions.password = NZBDAV_WEBDAV_PASS;
      }

      return createClient(baseUrl, authOptions);
    })();

    return clientPromise;
  };
})();

async function listWebdavDirectory(directory) {
  const client = await getWebdavClient();
  const normalizedPath = normalizeNzbdavPath(directory);
  const relativePath = normalizedPath === '/' ? '/' : normalizedPath.replace(/^\/+/, '');

  try {
    const entries = await client.getDirectoryContents(relativePath, { deep: false });
    return entries.map((entry) => ({
      name: entry?.basename ?? entry?.filename ?? '',
      isDirectory: entry?.type === 'directory',
      size: entry?.size ?? null,
      href: entry?.filename ?? entry?.href ?? null
    }));
  } catch (error) {
    throw new Error(`[NZBDAV] Failed to list ${relativePath}: ${error.message}`);
  }
}

function isVideoFileName(fileName = '') {
  const extension = posixPath.extname(fileName.toLowerCase());
  return NZBDAV_VIDEO_EXTENSIONS.has(extension);
}

function fileMatchesEpisode(fileName, requestedEpisode) {
  if (!requestedEpisode) {
    return true;
  }
  const { season, episode } = requestedEpisode;
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?![0-9])`, 'i'),
    new RegExp(`s0*${season}\.?e0*${episode}(?![0-9])`, 'i'),
    new RegExp(`0*${season}[xX]0*${episode}(?![0-9])`, 'i'),
    new RegExp(`[eE](?:pisode|p)\.?\s*0*${episode}(?![0-9])`, 'i')
  ];
  return patterns.some((regex) => regex.test(fileName));
}

function parseRequestedEpisode(type, id, query = {}) {
  const extractInt = (value) => {
    if (value === undefined || value === null) return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const seasonFromQuery = extractInt(query.season ?? query.Season ?? query.S);
  const episodeFromQuery = extractInt(query.episode ?? query.Episode ?? query.E);

  if (seasonFromQuery && episodeFromQuery) {
    return { season: seasonFromQuery, episode: episodeFromQuery };
  }

  if (type === 'series' && typeof id === 'string' && id.includes(':')) {
    const parts = id.split(':');
    if (parts.length >= 3) {
      const episode = extractInt(parts[parts.length - 1]);
      const season = extractInt(parts[parts.length - 2]);
      if (season && episode) {
        return { season, episode };
      }
    }
  }

  return null;
}

function ensureSpecialProviderConfigured() {
  if (!EXTERNAL_SPECIAL_PROVIDER_URL) {
    throw new Error('External metadata provider URL is not configured');
  }
}

function cleanSpecialSearchTitle(rawTitle) {
  if (!rawTitle) return null;
  const lines = rawTitle
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.length > 1 ? lines[1] : lines[0];
  if (!candidate) return null;

  const withoutTags = candidate.replace(/\bXXX.*$/i, '').replace(/\[[^\]]+\]/g, '');
  const withoutCodec = withoutTags.replace(/\b\d{3,4}p\b/gi, '');
  const normalized = withoutCodec
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return normalized || null;
}

async function fetchSpecialMetadata(identifier) {
  ensureSpecialProviderConfigured();
  const trimmedBase = stripTrailingSlashes(EXTERNAL_SPECIAL_PROVIDER_URL);
  const requestUrl = `${trimmedBase}/stream/movie/${encodeURIComponent(identifier)}.json`;
  console.log('[SPECIAL META] Fetching metadata for external catalog request');

  const response = await axios.get(requestUrl, { timeout: 10000 });
  const streams = response.data?.streams;
  const firstTitle = Array.isArray(streams) && streams.length > 0 ? streams[0]?.title : null;

  const cleanedTitle = cleanSpecialSearchTitle(firstTitle);
  if (!cleanedTitle) {
    throw new Error('External metadata provider returned no usable title');
  }

  return {
    title: cleanedTitle
  };
}

function normalizeNzbdavPath(pathValue) {
  if (!pathValue) {
    return '/';
  }
  const normalized = pathValue.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function inferMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || 'application/octet-stream';
}

function normalizeReleaseTitle(title) {
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

function normalizeIndexerToken(value) {
  if (value === undefined || value === null) return null;
  const token = String(value).trim().toLowerCase();
  return token.length > 0 ? token : null;
}

function nzbMatchesIndexer(result, tokenSet) {
  if (!tokenSet || tokenSet.size === 0) return true;
  const idToken = normalizeIndexerToken(result?.indexerId);
  if (idToken && tokenSet.has(idToken)) return true;
  const nameToken = normalizeIndexerToken(result?.indexer);
  if (nameToken && tokenSet.has(nameToken)) return true;
  return false;
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

async function fetchCompletedNzbdavHistory(categories = []) {
  ensureNzbdavConfigured();
  const categoryList = Array.isArray(categories) && categories.length > 0
    ? Array.from(new Set(categories.filter((value) => value !== undefined && value !== null && String(value).trim() !== '')))
    : [null];

  const results = new Map();

  for (const category of categoryList) {
    try {
      const params = buildNzbdavApiParams('history', {
        start: '0',
        limit: String(NZBDAV_HISTORY_FETCH_LIMIT),
        category: category || undefined
      });

      const headers = {};
      if (NZBDAV_API_KEY) {
        headers['x-api-key'] = NZBDAV_API_KEY;
      }

      const response = await axios.get(`${NZBDAV_URL}/api`, {
        params,
        timeout: NZBDAV_HISTORY_TIMEOUT_MS,
        headers,
        validateStatus: (status) => status < 500
      });

      if (!response.data?.status) {
        const errorMessage = response.data?.error || `history returned status ${response.status}`;
        throw new Error(errorMessage);
      }

      const history = response.data?.history || response.data?.History;
      const slots = history?.slots || history?.Slots || [];

      for (const slot of slots) {
        const status = (slot?.status || slot?.Status || '').toString().toLowerCase();
        if (status !== 'completed') {
          continue;
        }

        const jobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || slot?.nzb_name || slot?.NzbName;
        const nzoId = slot?.nzo_id || slot?.nzoId || slot?.NzoId;
        if (!jobName || !nzoId) {
          continue;
        }

        const normalized = normalizeReleaseTitle(jobName);
        if (!normalized) {
          continue;
        }

        if (!results.has(normalized)) {
          results.set(normalized, {
            nzoId,
            jobName,
            category: slot?.category || slot?.Category || category || null,
            size: slot?.size || slot?.Size || null,
            slot
          });
        }
      }
    } catch (error) {
      console.warn(`[NZBDAV] Failed to fetch history for category ${category || 'all'}: ${error.message}`);
    }
  }

  return results;
}

function buildNzbdavCacheKey(downloadUrl, category, requestedEpisode = null) {
  const keyParts = [downloadUrl, category];
  if (requestedEpisode && Number.isFinite(requestedEpisode.season) && Number.isFinite(requestedEpisode.episode)) {
    keyParts.push(`${requestedEpisode.season}x${requestedEpisode.episode}`);
  }
  return keyParts.join('|');
}

async function safeStat(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    return null;
  }
}

async function streamFileResponse(req, res, absolutePath, emulateHead, logPrefix, existingStats = null) {
  const stats = existingStats || (await safeStat(absolutePath));
  if (!stats || !stats.isFile()) {
    return false;
  }

  const totalSize = stats.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', stats.mtime.toUTCString());
  res.setHeader('Content-Type', 'application/octet-stream');

  if (emulateHead) {
    res.setHeader('Content-Length', totalSize);
    res.status(200).end();
    console.log(`[${logPrefix}] Served HEAD for ${absolutePath}`);
    return true;
  }

  let start = 0;
  let end = totalSize - 1;
  let statusCode = 200;

  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const [, rangeSpec] = rangeHeader.split('=');
    const [rangeStart, rangeEnd] = rangeSpec.split('-');

    if (rangeStart) {
      const parsedStart = Number.parseInt(rangeStart, 10);
      if (Number.isFinite(parsedStart) && parsedStart >= 0) {
        start = parsedStart;
      }
    }

    if (rangeEnd) {
      const parsedEnd = Number.parseInt(rangeEnd, 10);
      if (Number.isFinite(parsedEnd) && parsedEnd >= 0) {
        end = parsedEnd;
      }
    }

    if (!rangeEnd) {
      end = totalSize - 1;
    }

    if (start >= totalSize) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`);
      res.end();
      return true;
    }

    if (end >= totalSize || end < start) {
      end = totalSize - 1;
    }

    statusCode = 206;
  }

  const chunkSize = end - start + 1;
  const readStream = fs.createReadStream(absolutePath, {
    start,
    end,
    highWaterMark: STREAM_HIGH_WATER_MARK
  });

  if (statusCode === 206) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', chunkSize);
    console.log(`[${logPrefix}] Serving partial bytes ${start}-${end} from ${absolutePath}`);
  } else {
    res.status(200);
    res.setHeader('Content-Length', totalSize);
    console.log(`[${logPrefix}] Serving full file from ${absolutePath}`);
  }

  try {
    await pipelineAsync(readStream, res);
  } catch (error) {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.warn(`[${logPrefix}] Stream closed early for ${absolutePath}: ${error.message}`);
      return true;
    }
    console.error(`[${logPrefix}] Pipeline error for ${absolutePath}:`, error.message);
    throw error;
  }

  return true;
}

async function streamFailureVideo(req, res, failureError) {
  const stats = await safeStat(FAILURE_VIDEO_PATH);
  if (!stats || !stats.isFile()) {
    console.error(`[FAILURE STREAM] Failure video not found at ${FAILURE_VIDEO_PATH}`);
    return false;
  }

  const emulateHead = (req.method || 'GET').toUpperCase() === 'HEAD';
  const failureMessage = failureError?.failureMessage || failureError?.message || 'NZBDav download failed';

  if (!res.headersSent) {
    res.setHeader('X-NZBDav-Failure', failureMessage);
  }

  console.warn(`[FAILURE STREAM] Serving fallback video due to NZBDav failure: ${failureMessage}`);
  return streamFileResponse(req, res, FAILURE_VIDEO_PATH, emulateHead, 'FAILURE STREAM', stats);
}

async function findBestVideoFile({ category, jobName, requestedEpisode }) {
  const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`);
  const queue = [{ path: rootPath, depth: 0 }];
  const visited = new Set();
  let bestMatch = null;
  let bestEpisodeMatch = null;

  while (queue.length > 0) {
    const { path: currentPath, depth } = queue.shift();
    if (depth > NZBDAV_MAX_DIRECTORY_DEPTH) {
      continue;
    }
    if (visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    let entries;
    try {
      entries = await listWebdavDirectory(currentPath);
    } catch (error) {
      console.error(`[NZBDAV] Failed to list ${currentPath}:`, error.message);
      continue;
    }

    for (const entry of entries) {
      const entryName = entry?.name || entry?.Name;
      const isDirectory = entry?.isDirectory ?? entry?.IsDirectory;
      const entrySize = Number(entry?.size ?? entry?.Size ?? 0);
      const nextPath = normalizeNzbdavPath(`${currentPath}/${entryName}`);

      if (isDirectory) {
        queue.push({ path: nextPath, depth: depth + 1 });
        continue;
      }

      if (!entryName || !isVideoFileName(entryName)) {
        continue;
      }

      const matchesEpisode = fileMatchesEpisode(entryName, requestedEpisode);
      const candidate = {
        name: entryName,
        size: entrySize,
        matchesEpisode,
        absolutePath: nextPath,
        viewPath: nextPath.replace(/^\/+/, '')
      };

      if (matchesEpisode) {
        if (!bestEpisodeMatch || candidate.size > bestEpisodeMatch.size) {
          bestEpisodeMatch = candidate;
        }
      }

      if (!bestMatch || candidate.size > bestMatch.size) {
        bestMatch = candidate;
      }
    }
  }

  return bestEpisodeMatch || bestMatch;
}

function cleanupNzbdavCache() {
  if (NZBDAV_CACHE_TTL_MS <= 0) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of nzbdavStreamCache.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      nzbdavStreamCache.delete(key);
    }
  }
}

function clearNzbdavStreamCache(reason = 'manual') {
  if (nzbdavStreamCache.size > 0) {
    console.log('[CACHE] Cleared NZBDav stream cache', { reason, entries: nzbdavStreamCache.size });
  }
  nzbdavStreamCache.clear();
}

function clearAllCaches(reason = 'manual') {
  clearStreamResponseCache(reason);
  clearVerifiedNzbCache(reason);
  clearNzbdavStreamCache(reason);
}

async function getOrCreateNzbdavStream(cacheKey, builder) {
  cleanupNzbdavCache();
  const existing = nzbdavStreamCache.get(cacheKey);

  if (existing) {
    if (existing.status === 'ready') {
      return existing.data;
    }
    if (existing.status === 'pending') {
      return existing.promise;
    }
    if (existing.status === 'failed') {
      throw existing.error;
    }
  }

  const promise = (async () => {
    const data = await builder();
    nzbdavStreamCache.set(cacheKey, {
      status: 'ready',
      data,
      expiresAt: NZBDAV_CACHE_TTL_MS > 0 ? Date.now() + NZBDAV_CACHE_TTL_MS : null
    });
    return data;
  })();

  nzbdavStreamCache.set(cacheKey, { status: 'pending', promise });

  try {
    return await promise;
  } catch (error) {
    if (error?.isNzbdavFailure) {
      nzbdavStreamCache.set(cacheKey, {
        status: 'failed',
        error,
        expiresAt: NZBDAV_CACHE_TTL_MS > 0 ? Date.now() + NZBDAV_CACHE_TTL_MS : null
      });
    } else {
      nzbdavStreamCache.delete(cacheKey);
    }
    throw error;
  }
}

async function buildNzbdavStream({ downloadUrl, category, title, requestedEpisode, existingSlot = null }) {
  let reuseError = null;
  const attempts = [];
  if (existingSlot?.nzoId) {
    attempts.push('reuse');
  }
  attempts.push('queue');

  for (const mode of attempts) {
    try {
      let slot = null;
      let nzoId = null;
      let slotCategory = category;
      let slotJobName = title;

      if (mode === 'reuse') {
        const reuseCategory = existingSlot?.category || category;
        slot = await waitForNzbdavHistorySlot(existingSlot.nzoId, reuseCategory);
        nzoId = existingSlot.nzoId;
        slotCategory = slot?.category || slot?.Category || reuseCategory;
        slotJobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || existingSlot?.jobName || title;
        console.log(`[NZBDAV] Reusing completed NZB ${slotJobName} (${nzoId})`);
      } else {
        const cachedNzbEntry = getVerifiedNzbCacheEntry(downloadUrl);
        if (cachedNzbEntry) {
          console.log('[CACHE] Using verified NZB payload', { downloadUrl });
        }
        const added = await addNzbToNzbdav({
          downloadUrl,
          cachedEntry: cachedNzbEntry,
          category,
          jobLabel: title,
        });
        nzoId = added.nzoId;
        slot = await waitForNzbdavHistorySlot(nzoId, category);
        slotCategory = slot?.category || slot?.Category || category;
        slotJobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || title;
      }

      if (!slotJobName) {
        throw new Error('[NZBDAV] Unable to determine job name from history');
      }

      const bestFile = await findBestVideoFile({
        category: slotCategory,
        jobName: slotJobName,
        requestedEpisode
      });

      if (!bestFile) {
        throw new Error('[NZBDAV] No playable video files found after mounting NZB');
      }

      console.log(`[NZBDAV] Selected file ${bestFile.viewPath} (${bestFile.size} bytes)`);

      return {
        nzoId,
        category: slotCategory,
        jobName: slotJobName,
        viewPath: bestFile.viewPath,
        size: bestFile.size,
        fileName: bestFile.name
      };
    } catch (error) {
      if (mode === 'reuse') {
        reuseError = error;
        console.warn(`[NZBDAV] Reuse attempt failed for NZB ${existingSlot?.nzoId || 'unknown'}: ${error.message}`);
        continue;
      }
      if (error?.isNzbdavFailure) {
        error.downloadUrl = downloadUrl;
        error.category = category;
        error.title = title;
      }
      throw error;
    }
  }

  if (reuseError) {
    if (reuseError?.isNzbdavFailure) {
      reuseError.downloadUrl = downloadUrl;
      reuseError.category = category;
      reuseError.title = title;
    }
    throw reuseError;
  }

  const fallbackError = new Error('[NZBDAV] Unable to prepare NZB stream');
  fallbackError.downloadUrl = downloadUrl;
  fallbackError.category = category;
  fallbackError.title = title;
  throw fallbackError;
}

async function proxyNzbdavStream(req, res, viewPath, fileNameHint = '') {
  const originalMethod = (req.method || 'GET').toUpperCase();
  if (!NZBDAV_SUPPORTED_METHODS.has(originalMethod)) {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const emulateHead = originalMethod === 'HEAD';
  const proxiedMethod = emulateHead ? 'GET' : originalMethod;

  const normalizedPath = normalizeNzbdavPath(viewPath);
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const webdavBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, '');
  const targetUrl = `${webdavBase}${encodedPath}`;
  const headers = {};

  console.log(`[NZBDAV] Streaming ${normalizedPath} via WebDAV`);

  const coerceToString = (value) => {
    if (Array.isArray(value)) {
      return value.find((item) => typeof item === 'string' && item.trim().length > 0) || '';
    }
    return typeof value === 'string' ? value : '';
  };

  let derivedFileName = typeof fileNameHint === 'string' ? fileNameHint.trim() : '';
  if (!derivedFileName) {
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      try {
        derivedFileName = decodeURIComponent(lastSegment);
      } catch (decodeError) {
        derivedFileName = lastSegment;
      }
    }
  }
  if (!derivedFileName) {
    derivedFileName = coerceToString(req.query?.title || '').trim();
  }
  if (!derivedFileName) {
    derivedFileName = 'stream';
  }

  const sanitizedFileName = derivedFileName.replace(/[\\/:*?"<>|]+/g, '_') || 'stream';

  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  if (req.headers.accept) headers.Accept = req.headers.accept;
  if (req.headers['accept-language']) headers['Accept-Language'] = req.headers['accept-language'];
  if (req.headers['accept-encoding']) headers['Accept-Encoding'] = req.headers['accept-encoding'];
  if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
  if (!headers['Accept-Encoding']) headers['Accept-Encoding'] = 'identity';
  if (emulateHead && !headers.Range) {
    headers.Range = 'bytes=0-0';
  }

  let totalFileSize = null;
  if (!req.headers.range && !emulateHead) {
    const headConfig = {
      url: targetUrl,
      method: 'HEAD',
      headers: {
  'User-Agent': headers['User-Agent'] || `UsenetStreamer/${ADDON_VERSION}`
      },
      timeout: 30000,
      validateStatus: (status) => status < 500
    };

    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
      headConfig.auth = {
        username: NZBDAV_WEBDAV_USER,
        password: NZBDAV_WEBDAV_PASS
      };
    }

    try {
      const headResponse = await axios.request(headConfig);
      const headHeadersLower = Object.keys(headResponse.headers || {}).reduce((map, key) => {
        map[key.toLowerCase()] = headResponse.headers[key];
        return map;
      }, {});
      const headContentLength = headHeadersLower['content-length'];
      if (headContentLength) {
        totalFileSize = Number(headContentLength);
        console.log(`[NZBDAV] HEAD reported total size ${totalFileSize} bytes for ${normalizedPath}`);
      }
    } catch (headError) {
      console.warn('[NZBDAV] HEAD request failed; continuing without pre-fetched size:', headError.message);
    }
  }

  const requestConfig = {
    url: targetUrl,
    method: proxiedMethod,
    headers,
    responseType: 'stream',
    timeout: NZBDAV_STREAM_TIMEOUT_MS,
    validateStatus: (status) => status < 500
  };

  if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
    requestConfig.auth = {
      username: NZBDAV_WEBDAV_USER,
      password: NZBDAV_WEBDAV_PASS
    };
  }

  console.log(`[NZBDAV] Proxying ${proxiedMethod}${emulateHead ? ' (HEAD emulation)' : ''} ${targetUrl}`);

  const nzbdavResponse = await axios.request(requestConfig);

  let responseStatus = nzbdavResponse.status;
  const responseHeadersLower = Object.keys(nzbdavResponse.headers || {}).reduce((map, key) => {
    map[key.toLowerCase()] = nzbdavResponse.headers[key];
    return map;
  }, {});

  const incomingContentRange = responseHeadersLower['content-range'];
  if (incomingContentRange && responseStatus === 200) {
    responseStatus = 206;
  }

  res.status(responseStatus);

  const headerBlocklist = new Set(['transfer-encoding', 'www-authenticate', 'set-cookie', 'cookie', 'authorization']);

  Object.entries(nzbdavResponse.headers || {}).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (headerBlocklist.has(lowerKey)) {
      return;
    }
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  });

  const incomingDisposition = nzbdavResponse.headers?.['content-disposition'];
  const hasFilenameInDisposition = typeof incomingDisposition === 'string' && /filename=/i.test(incomingDisposition);
  if (!hasFilenameInDisposition) {
    res.setHeader('Content-Disposition', `inline; filename="${sanitizedFileName}"`);
  }

  const inferredMime = inferMimeType(sanitizedFileName);
  if (!res.getHeader('Content-Type') || res.getHeader('Content-Type') === 'application/octet-stream') {
    res.setHeader('Content-Type', inferredMime);
  }

  const acceptRangesHeader = res.getHeader('Accept-Ranges');
  if (!acceptRangesHeader) {
    res.setHeader('Accept-Ranges', 'bytes');
  }

  const contentLengthHeader = res.getHeader('Content-Length');
  if (incomingContentRange) {
    const match = incomingContentRange.match(/bytes\s+(\d+)-(\d+)\s*\/\s*(\d+|\*)/i);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const totalSize = match[3] !== '*' ? Number(match[3]) : null;
      const chunkLength = Number.isFinite(start) && Number.isFinite(end) ? end - start + 1 : null;
      console.log('[NZBDAV] Calculated chunk length:', { start, end, chunkLength, totalSize });
      if (Number.isFinite(chunkLength) && chunkLength > 0) {
        res.setHeader('Content-Length', String(chunkLength));
        console.log(`[NZBDAV] ✅ Set Content-Length: ${chunkLength} (from Content-Range: bytes ${start}-${end}/${totalSize || '*'})`);
      } else {
        console.error('[NZBDAV] ❌ Failed to calculate valid chunk length!');
      }
      if (Number.isFinite(totalSize)) {
        res.setHeader('X-Total-Length', String(totalSize));
      }
    } else {
      console.error('[NZBDAV] ❌ Failed to parse Content-Range header!');
    }
  } else if ((!contentLengthHeader || Number(contentLengthHeader) === 0) && Number.isFinite(totalFileSize)) {
    res.setHeader('Content-Length', String(totalFileSize));
    console.log(`[NZBDAV] Set Content-Length: ${totalFileSize} (from HEAD request)`);
  } else if (!contentLengthHeader || Number(contentLengthHeader) === 0) {
    console.warn('[NZBDAV] Warning: No Content-Length or Content-Range header available');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');

  if (emulateHead || !nzbdavResponse.data || typeof nzbdavResponse.data.pipe !== 'function') {
    if (nzbdavResponse.data && typeof nzbdavResponse.data.destroy === 'function') {
      nzbdavResponse.data.destroy();
    }
    res.end();
    return;
  }

  try {
    await pipelineAsync(nzbdavResponse.data, res);
  } catch (error) {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.warn('[NZBDAV] Stream closed early by client');
      return;
    }
    console.error('[NZBDAV] Error while piping stream:', error.message);
    throw error;
  }
}

// Manifest endpoint
function manifestHandler(req, res) {
  ensureAddonConfigured();

  res.json({
    id: 'com.usenet.streamer',
    version: ADDON_VERSION,
    name: 'UsenetStreamer',
    description: 'Usenet-powered instant streams for Stremio via Prowlarr/NZBHydra and NZBDav',
    logo: `${ADDON_BASE_URL.replace(/\/$/, '')}/assets/icon.png`,
    resources: ['stream'],
    types: ['movie', 'series', 'channel', 'tv'],
    catalogs: [],
    idPrefixes: ['tt', 'tvdb', 'pt', SPECIAL_ID_PREFIX]
  });
}

if (ADDON_SHARED_SECRET) {
  app.get('/:token/manifest.json', manifestHandler);
} else {
  app.get('/manifest.json', manifestHandler);
  app.get('/:token/manifest.json', manifestHandler);
}

async function streamHandler(req, res) {
  const { type, id } = req.params;
  console.log(`[REQUEST] Received request for ${type} ID: ${id}`);

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

  if (/^tt\d+$/i.test(baseIdentifier)) {
    incomingImdbId = baseIdentifier.startsWith('tt') ? baseIdentifier : `tt${baseIdentifier}`;
    baseIdentifier = incomingImdbId;
  } else if (/^tvdb:/i.test(baseIdentifier)) {
    const tvdbMatch = baseIdentifier.match(/^tvdb:([0-9]+)(?::.*)?$/i);
    if (tvdbMatch) {
      incomingTvdbId = tvdbMatch[1];
      baseIdentifier = `tvdb:${incomingTvdbId}`;
    }
  } else {
    const lowerIdentifier = baseIdentifier.toLowerCase();
    for (const prefix of specialCatalogPrefixes) {
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
  }

  const isSpecialRequest = Boolean(incomingSpecialId);

  if (!incomingImdbId && !incomingTvdbId && !isSpecialRequest) {
    res.status(400).json({ error: `Unsupported ID prefix for indexer manager search: ${baseIdentifier}` });
    return;
  }

  try {
    ensureAddonConfigured();
    ensureIndexerManagerConfigured();
    ensureNzbdavConfigured();

    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const streamCacheKey = STREAM_CACHE_MAX_ENTRIES > 0
      ? buildStreamCacheKey({ type, id, requestedEpisode, query: req.query || {} })
      : null;
    let cachedStreamEntry = null;
    let cachedSearchMeta = null;
    if (streamCacheKey) {
      cachedStreamEntry = getStreamCacheEntry(streamCacheKey);
      if (cachedStreamEntry) {
        const cacheMeta = cachedStreamEntry.meta;
        if (cacheMeta?.version === 1 && Array.isArray(cacheMeta.finalNzbResults)) {
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
    let triageDecisions = cachedSearchMeta
      ? restoreTriageDecisions(cachedSearchMeta.triageDecisionsSnapshot)
      : new Map();
    if (cachedSearchMeta) {
      finalNzbResults = restoreFinalNzbResults(cachedSearchMeta.finalNzbResults);
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
    if (incomingTvdbId) {
      metaSources.push({ ids: { tvdb: incomingTvdbId }, tvdb_id: incomingTvdbId });
    }
    let specialMetadata = null;
    if (isSpecialRequest) {
      try {
        specialMetadata = await fetchSpecialMetadata(baseIdentifier);
        if (specialMetadata?.title) {
          metaSources.push({ title: specialMetadata.title, name: specialMetadata.title });
          console.log('[SPECIAL META] Resolved title for external catalog request', { title: specialMetadata.title });
        }
      } catch (error) {
        console.error('[SPECIAL META] Failed to resolve metadata:', error.message);
        res.status(502).json({ error: 'Failed to resolve external metadata' });
        return;
      }
    }
    let cinemetaMeta = null;

    const needsCinemeta = !INDEXER_MANAGER_STRICT_ID_MATCH && !incomingTvdbId && !isSpecialRequest && (
      (!hasTitleInQuery) ||
      (type === 'series' && !hasTvdbInQuery) ||
      (type === 'movie' && !hasTmdbInQuery)
    );
    if (needsCinemeta) {
      const cinemetaPath = type === 'series' ? `series/${baseIdentifier}.json` : `${type}/${baseIdentifier}.json`;
      const cinemetaUrl = `${CINEMETA_URL}/${cinemetaPath}`;
      try {
        console.log(`[CINEMETA] Fetching metadata from ${cinemetaUrl}`);
        const cinemetaResponse = await axios.get(cinemetaUrl, { timeout: 10000 });
        cinemetaMeta = cinemetaResponse.data?.meta || null;
        if (cinemetaMeta) {
          metaSources.push(cinemetaMeta);
          console.log('[CINEMETA] Received metadata identifiers', {
            imdb: cinemetaMeta?.ids?.imdb || cinemetaMeta?.imdb_id,
            tvdb: cinemetaMeta?.ids?.tvdb || cinemetaMeta?.tvdb_id,
            tmdb: cinemetaMeta?.ids?.tmdb || cinemetaMeta?.tmdb_id
          });
        } else {
          console.warn(`[CINEMETA] No metadata payload returned for ${cinemetaUrl}`);
        }
      } catch (error) {
        console.warn(`[CINEMETA] Failed to fetch metadata for ${baseIdentifier}: ${error.message}`);
      }
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
        (src) => src?.title,
        (src) => src?.name,
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

    if (!movieTitle && specialMetadata?.title) {
      movieTitle = specialMetadata.title;
    }

    if (!releaseYear && specialMetadata?.year) {
      const specialYear = extractYear(specialMetadata.year);
      if (specialYear) {
        releaseYear = specialYear;
      }
    }

    console.log('[REQUEST] Resolved title/year', { movieTitle, releaseYear });

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
        searchPlans.push({ type: planType, query, rawQuery: rawQuery ? rawQuery : null, tokens: normalizedTokens });
        return true;
      };

      if (metaIds.imdb) {
        addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
      }

      if (type === 'series' && metaIds.tvdb) {
        addPlan('tvsearch', { tokens: [`{TvdbId:${metaIds.tvdb}}`] });
      }

      if (type === 'movie' && metaIds.tmdb) {
        addPlan('movie', { tokens: [`{TmdbId:${metaIds.tmdb}}`] });
      }

      if (searchPlans.length === 0 && metaIds.imdb) {
        addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
      }

      const textQueryParts = [];
      if (movieTitle) {
        textQueryParts.push(movieTitle);
      }
      if (type === 'movie' && Number.isFinite(releaseYear)) {
        textQueryParts.push(String(releaseYear));
      } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
        textQueryParts.push(`S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
      }

    const shouldForceTextSearch = isSpecialRequest;
      const shouldAddTextSearch = shouldForceTextSearch || (!INDEXER_MANAGER_STRICT_ID_MATCH && !incomingTvdbId);

      if (shouldAddTextSearch) {
        const fallbackIdentifier = incomingImdbId || baseIdentifier;
        const textQueryCandidate = textQueryParts.join(' ').trim();
        const textQueryFallback = (textQueryCandidate || fallbackIdentifier).trim();
        if (textQueryFallback) {
          const addedTextPlan = addPlan('search', { rawQuery: textQueryFallback });
          if (addedTextPlan) {
            console.log(`${INDEXER_LOG_PREFIX} Added text search plan`, { query: textQueryFallback });
          } else {
            console.log(`${INDEXER_LOG_PREFIX} Text search plan already present`, { query: textQueryFallback });
          }
        } else {
          console.log(`${INDEXER_LOG_PREFIX} Skipping text search plan; insufficient metadata`);
        }
      } else {
        const reason = INDEXER_MANAGER_STRICT_ID_MATCH ? 'strict ID matching enabled' : 'tvdb identifier provided';
        console.log(`${INDEXER_LOG_PREFIX} ${reason}; skipping text-based search`);
      }

      if (INDEXER_MANAGER_INDEXERS) {
        console.log(`${INDEXER_LOG_PREFIX} Using configured indexers`, INDEXER_MANAGER_INDEXERS);
      } else {
        console.log(`${INDEXER_LOG_PREFIX} Using manager default indexer selection`);
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
      const planSummaries = [];

      const planExecutions = searchPlans.map((plan) => {
        console.log(`${INDEXER_LOG_PREFIX} Dispatching plan`, plan);
        return Promise.allSettled([
          executeManagerPlanWithBackoff(plan),
          executeNewznabSearch(plan),
        ]).then((settled) => {
          const mgrSet = settled[0];
          const nzbSet = settled[1];
          const mgr = mgrSet && mgrSet.status === 'fulfilled' ? (Array.isArray(mgrSet.value) ? mgrSet.value : []) : [];
          const nzb = nzbSet && nzbSet.status === 'fulfilled' ? (Array.isArray(nzbSet.value) ? nzbSet.value : []) : [];
          const data = [...mgr, ...nzb];
          const errors = [];
          if (mgrSet && mgrSet.status === 'rejected') errors.push(`manager: ${mgrSet.reason?.message || mgrSet.reason}`);
          if (nzbSet && nzbSet.status === 'rejected') errors.push(`newznab: ${nzbSet.reason?.message || nzbSet.reason}`);
          if (data.length > 0 || errors.length === 0) {
            return { plan, status: 'fulfilled', data, errors, mgrCount: mgr.length, nzbCount: nzb.length };
          }
          return { plan, status: 'rejected', error: new Error(errors.join('; ')) };
        });
      });

      const planResultsSettled = await Promise.all(planExecutions);

      for (const result of planResultsSettled) {
        const { plan } = result;
        if (result.status === 'rejected') {
          console.error(`${INDEXER_LOG_PREFIX} ❌ Search plan failed`, {
            message: result.error.message,
            type: plan.type,
            query: plan.query
          });
          planSummaries.push({
            planType: plan.type,
            query: plan.query,
            total: 0,
            filtered: 0,
            uniqueAdded: 0,
            error: result.error.message
          });
          continue;
        }

        const planResults = Array.isArray(result.data) ? result.data : [];
        const mgrCount = Number.isFinite(result.mgrCount) ? result.mgrCount : null;
        const nzbCount = Number.isFinite(result.nzbCount) ? result.nzbCount : null;
        console.log(`${INDEXER_LOG_PREFIX} ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`, {
          managerCount: mgrCount,
          newznabCount: nzbCount,
          errors: result.errors && result.errors.length ? result.errors : undefined,
        });

        const filteredResults = planResults.filter((item) => {
          if (!item || typeof item !== 'object') {
            return false;
          }
          if (!item.downloadUrl) {
            return false;
          }
          return true;
        });

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
          uniqueAdded: addedCount
        });
        console.log(`${INDEXER_LOG_PREFIX} ✅ Plan summary`, planSummaries[planSummaries.length - 1]);
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

      const dedupedNzbResults = usingStrictIdMatching
        ? aggregatedResults.map((entry) => entry.result)
        : Array.from(resultsByKey.values()).map((entry) => entry.result);

      finalNzbResults = dedupedNzbResults
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

  console.log(`${INDEXER_LOG_PREFIX} Final NZB selection: ${finalNzbResults.length} results`);
    }

    const triageOverrides = extractTriageOverrides(req.query || {});
    finalNzbResults = prepareSortedResults(finalNzbResults, {
      sortMode: triageOverrides.sortMode,
      preferredLanguage: triageOverrides.preferredLanguage,
      maxSizeBytes: triageOverrides.maxSizeBytes,
    });
    const allowedCacheStatuses = new Set(['verified', 'blocked']);
    const requestedDisable = triageOverrides.disabled === true;
    const requestedEnable = triageOverrides.enabled === true;
    const overrideIndexerTokens = (triageOverrides.indexers && triageOverrides.indexers.length > 0)
      ? triageOverrides.indexers
      : null;
    // Use TRIAGE_PRIORITY_INDEXERS as the primary setting for which indexers to health-check
    // If TRIAGE_HEALTH_INDEXERS is set, use it as fallback for backward compatibility
    const healthIndexerTokens = overrideIndexerTokens ?? (TRIAGE_PRIORITY_INDEXERS.length > 0 ? TRIAGE_PRIORITY_INDEXERS : TRIAGE_HEALTH_INDEXERS);
    const serializedIndexerTokens = TRIAGE_SERIALIZED_INDEXERS.length > 0
      ? TRIAGE_SERIALIZED_INDEXERS
      : healthIndexerTokens;
    const healthIndexerSet = new Set((healthIndexerTokens || []).map((token) => normalizeIndexerToken(token)).filter(Boolean));
    const triagePool = healthIndexerSet.size > 0
      ? finalNzbResults.filter((result) => nzbMatchesIndexer(result, healthIndexerSet))
      : [];
    const triageEligibleResults = prioritizeTriageCandidates(
      triagePool,
      TRIAGE_MAX_CANDIDATES
    );
    const candidateHasConclusiveDecision = (candidate) => {
      const decision = triageDecisions.get(candidate.downloadUrl);
      if (decision && allowedCacheStatuses.has(decision.status)) {
        return true;
      }
      const normalizedTitle = normalizeReleaseTitle(candidate.title);
      if (normalizedTitle) {
        const derived = triageTitleMap.get(normalizedTitle);
        if (
          derived
          && allowedCacheStatuses.has(derived.status)
          && canShareDecision(derived.publishDateMs, candidate.publishDateMs)
        ) {
          return true;
        }
      }
      return false;
    };
    const triageCandidatesToRun = triageEligibleResults.filter((candidate) => !candidateHasConclusiveDecision(candidate));
    const shouldAttemptTriage = triageCandidatesToRun.length > 0 && !requestedDisable && (requestedEnable || TRIAGE_ENABLED);
    let triageOutcome = null;
    let triageCompleteForCache = !shouldAttemptTriage;

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
          allowedIndexerIds: healthIndexerTokens,
          preferredIndexerIds: healthIndexerTokens, // Use same indexers for filtering and ranking
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
          // console.log(`[NZB TRIAGE] Evaluated ${triageOutcome.evaluatedCount}/${triageOutcome.candidatesConsidered} candidate NZBs in ${triageOutcome.elapsedMs} ms (timedOut=${triageOutcome.timedOut})`);
          if (triageDecisions.size > 0) {
            const statusCounts = {};
            let loggedSamples = 0;
            const sampleLimit = 5;
            triageDecisions.forEach((decision, downloadUrl) => {
              const status = decision?.status || 'unknown';
              statusCounts[status] = (statusCounts[status] || 0) + 1;
              if (loggedSamples < sampleLimit) {
                /* console.log('[NZB TRIAGE] Decision sample', {
                  status,
                  blockers: decision?.blockers || [],
                  warnings: decision?.warnings || [],
                  fileCount: decision?.fileCount ?? null,
                  nzbIndex: decision?.nzbIndex ?? null,
                  downloadUrl
                }); */
                loggedSamples += 1;
              }
            });
            if (triageDecisions.size > sampleLimit) {
              // console.log(`[NZB TRIAGE] (${triageDecisions.size - sampleLimit}) additional decisions omitted from sample log`);
            }
            // console.log('[NZB TRIAGE] Decision status breakdown', statusCounts);
          } else {
            // console.log('[NZB TRIAGE] No decisions were produced by the triage runner');
          }
        } catch (triageError) {
          console.warn(`[NZB TRIAGE] Health check failed: ${triageError.message}`);
        }
      }
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
          cacheVerifiedNzbPayload(candidate.downloadUrl, decision.nzbPayload, {
            title: decision.title || candidate.title,
            size: candidate.size,
            fileName: candidate.title,
          });
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

    cleanupNzbdavCache();

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

    const categoryForType = getNzbdavCategory(type);
    let historyByTitle = new Map();
    try {
      historyByTitle = await fetchCompletedNzbdavHistory([categoryForType]);
      if (historyByTitle.size > 0) {
        console.log(`[NZBDAV] Loaded ${historyByTitle.size} completed NZBs for instant playback detection (category=${categoryForType})`);
      }
    } catch (historyError) {
      console.warn(`[NZBDAV] Unable to load NZBDav history for instant detection: ${historyError.message}`);
    }

    const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, '');

    let triageLogCount = 0;
    let triageLogSuppressed = false;
    const activePreferredLanguage = resolvePreferredLanguage(triageOverrides.preferredLanguage, INDEXER_PREFERRED_LANGUAGE);

    const instantStreams = [];
    const regularStreams = [];

    finalNzbResults.forEach((result) => {
        const sizeInGB = result.size ? (result.size / 1073741824).toFixed(2) : null;
        const sizeString = sizeInGB ? `${sizeInGB} GB` : 'Size Unknown';
        const releaseInfo = result.release || {};
        const releaseLanguages = Array.isArray(releaseInfo.languages) ? releaseInfo.languages : [];
        const qualityMatch = result.title?.match(/(2160p|4K|UHD|1080p|720p|480p)/i);
        const quality = releaseInfo.resolution || (qualityMatch ? qualityMatch[0] : '') || releaseInfo.qualityLabel || '';
        const languageLabel = releaseLanguages.length > 0 ? releaseLanguages.join(', ') : null;
        const preferredLanguageHit = activePreferredLanguage
          ? resultMatchesPreferredLanguage(result, activePreferredLanguage)
          : false;

        const baseParams = new URLSearchParams({
          indexerId: String(result.indexerId),
          type,
          id
        });

        baseParams.set('downloadUrl', result.downloadUrl);
        if (result.guid) baseParams.set('guid', result.guid);
        if (result.size) baseParams.set('size', String(result.size));
        if (result.title) baseParams.set('title', result.title);

        const cacheKey = buildNzbdavCacheKey(result.downloadUrl, categoryForType, requestedEpisode);
        const cacheEntry = nzbdavStreamCache.get(cacheKey);
        const normalizedTitle = normalizeReleaseTitle(result.title);
        const historySlot = normalizedTitle ? historyByTitle.get(normalizedTitle) : null;
        const isInstant = cacheEntry?.status === 'ready' || Boolean(historySlot);

        const directTriageInfo = triageDecisions.get(result.downloadUrl);
        const fallbackTitleKey = normalizedTitle;
        const fallbackTriageInfo = !directTriageInfo && fallbackTitleKey ? triageTitleMap.get(fallbackTitleKey) : null;
        const fallbackAllowed = fallbackTriageInfo
          ? canShareDecision(fallbackTriageInfo.publishDateMs, result.publishDateMs)
          : false;
        const triageInfo = directTriageInfo || (fallbackAllowed ? fallbackTriageInfo : null);
        const triageApplied = Boolean(directTriageInfo);
        const triageDerivedFromTitle = Boolean(!directTriageInfo && fallbackAllowed && fallbackTriageInfo);
        const triageStatus = triageInfo?.status || (triageApplied ? 'unknown' : 'not-run');
        let triagePriority = 1;
        let triageTag = null;

        if (triageStatus === 'verified') {
          triagePriority = 0;
          triageTag = '✅';
        } else if (triageStatus === 'unverified') {
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
          'rar5-unsupported',
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
        const missingArticlesSuccess = archiveStatuses.includes('segment-ok');
        let missingArticlesStatus = 'not-run';
        if (triageInfo) {
          if (missingArticlesFailure) missingArticlesStatus = 'failed';
          else if (missingArticlesSuccess) missingArticlesStatus = 'passed';
          else if (archiveFindings.length > 0) missingArticlesStatus = 'inconclusive';
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
        const streamUrl = `${addonBaseUrl}${tokenSegment}/nzb/stream?${baseParams.toString()}`;
        const tags = [];
        if (triageTag) tags.push(triageTag);
        if (isInstant) tags.push('⚡ Instant');
        if (preferredLanguageHit && activePreferredLanguage) tags.push(`${activePreferredLanguage}`);
        if (quality) tags.push(quality);
        if (languageLabel) tags.push(`🌐 ${languageLabel}`);
        if (sizeString) tags.push(sizeString);
        const name = 'UsenetStreamer';
        const behaviorHints = {
          notWebReady: true,
          externalPlayer: {
            isRequired: false,
            name: 'NZBDav Instant Stream'
          }
        };

        if (isInstant) {
          behaviorHints.cached = true;
          if (historySlot) {
            behaviorHints.cachedFromHistory = true;
          }
        }

        if (triageApplied && triageLogCount < 10) {
          /* console.log('[NZB TRIAGE] Stream candidate status', {
            title: result.title,
            downloadUrl: result.downloadUrl,
            status: triageStatus,
            triageApplied,
            triagePriority,
            blockers: triageInfo?.blockers || [],
            warnings: triageInfo?.warnings || [],
            archiveFindings: triageInfo?.archiveFindings || [],
            archiveCheckStatus,
            missingArticlesStatus,
            timedOut: Boolean(triageOutcome?.timedOut)
          }); */
          triageLogCount += 1;
        } else if (!triageApplied) {
          // Skip logging for streams that were never part of the triage batch
        } else if (!triageLogSuppressed) {
          // console.log('[NZB TRIAGE] Additional stream triage logs suppressed');
          triageLogSuppressed = true;
        }

        const stream = {
          title: `${result.title}\n${tags.filter(Boolean).join(' • ')}\n${result.indexer}`,
          name,
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
            cachedFromSession: cacheEntry?.status === 'ready',
            languages: releaseLanguages,
            resolution: releaseInfo.resolution || null,
            preferredLanguageMatch: preferredLanguageHit,
            preferredLanguageName: preferredLanguageHit ? activePreferredLanguage : null,
          }
        };
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

        if (isInstant) {
          instantStreams.push(stream);
        } else {
          regularStreams.push(stream);
        }
      });

    const streams = instantStreams.concat(regularStreams);

    const instantCount = streams.filter((stream) => stream?.meta?.cached).length;
    if (instantCount > 0) {
      console.log(`[STREMIO] ${instantCount}/${streams.length} streams already cached in NZBDav`);
    }

    console.log(`[STREMIO] Returning ${streams.length} NZB streams`);

    const responsePayload = { streams };
    if (streamCacheKey && cacheMeta) {
      setStreamCacheEntry(streamCacheKey, responsePayload, cacheMeta);
    }

    res.json(responsePayload);
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

if (ADDON_SHARED_SECRET) {
  app.get('/:token/stream/:type/:id.json', streamHandler);
} else {
  app.get('/stream/:type/:id.json', streamHandler);
  app.get('/:token/stream/:type/:id.json', streamHandler);
}

async function handleNzbdavStream(req, res) {
  const { downloadUrl, type = 'movie', id = '', title = 'NZB Stream' } = req.query;

  if (!downloadUrl) {
    res.status(400).json({ error: 'downloadUrl query parameter is required' });
    return;
  }

  try {
    const category = getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const cacheKey = buildNzbdavCacheKey(downloadUrl, category, requestedEpisode);
    const existingSlotHint = req.query.historyNzoId
      ? {
          nzoId: req.query.historyNzoId,
          jobName: req.query.historyJobName,
          category: req.query.historyCategory
        }
      : null;

    const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
      buildNzbdavStream({ downloadUrl, category, title, requestedEpisode, existingSlot: existingSlotHint })
    );

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

    await proxyNzbdavStream(req, res, streamData.viewPath, streamData.fileName || '');
  } catch (error) {
    if (error?.isNzbdavFailure) {
      console.warn('[NZBDAV] Stream failure detected:', error.failureMessage || error.message);
      const served = await streamFailureVideo(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.failureMessage || error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    console.error('[NZBDAV] Stream proxy error:', error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: error.message });
    } else {
      res.end();
    }
  }
}

if (ADDON_SHARED_SECRET) {
  app.get('/:token/nzb/stream', handleNzbdavStream);
  app.head('/:token/nzb/stream', handleNzbdavStream);
} else {
  app.get('/:token/nzb/stream', handleNzbdavStream);
  app.head('/:token/nzb/stream', handleNzbdavStream);
  app.get('/nzb/stream', handleNzbdavStream);
  app.head('/nzb/stream', handleNzbdavStream);
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Addon running at http://0.0.0.0:${port}`);
});

// Graceful shutdown and better crash diagnostics in production
process.on('SIGTERM', () => {
  console.log('[LIFECYCLE] Received SIGTERM — shutting down gracefully');
  try {
    server.close(() => {
      console.log('[LIFECYCLE] HTTP server closed');
      process.exit(0);
    });
    // Fallback exit in case close hangs
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (err) {
    console.warn('[LIFECYCLE] Error during graceful shutdown', err?.message || err);
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('[LIFECYCLE] Received SIGINT — shutting down');
  try {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (_) {
    process.exit(0);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && (err.stack || err.message || err));
  // Keep process alive to allow orchestrator to decide; avoid tight crash loops
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  // Keep process alive to allow orchestrator to decide
});

