require('dotenv').config();

// Helper functions for parsing environment variables
function toFiniteNumber(value, defaultValue = undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toPositiveInt(value, defaultValue) {
  const num = toFiniteNumber(value, defaultValue);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : defaultValue;
}

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return defaultValue;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return defaultValue;
}

function parseCommaList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function parsePathList(value) {
  if (!value || typeof value !== 'string') return [];
  const separator = process.platform === 'win32' ? ';' : ':';
  return value.split(separator).map(s => s.trim()).filter(s => s.length > 0);
}

function decodeBase64Value(value) {
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

// Indexer Manager Configuration (Prowlarr or NZBHydra)
const INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'prowlarr').trim().toLowerCase();
const INDEXER_MANAGER_URL = (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || '').trim();
const INDEXER_MANAGER_API_KEY = (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || '').trim();
const INDEXER_MANAGER_STRICT_ID_MATCH = toBoolean(
  process.env.INDEXER_MANAGER_STRICT_ID_MATCH || process.env.PROWLARR_STRICT_ID_MATCH,
  false
);
const INDEXER_MANAGER_LABEL = INDEXER_MANAGER === 'nzbhydra' ? 'NZBHydra' : 'Prowlarr';
const INDEXER_MANAGER_CACHE_MINUTES = toPositiveInt(process.env.INDEXER_MANAGER_CACHE_MINUTES, 10);
const INDEXER_MANAGER_BASE_URL = stripTrailingSlashes(INDEXER_MANAGER_URL);

// Legacy Prowlarr exports (for backward compatibility)
const PROWLARR_URL = INDEXER_MANAGER_URL;
const PROWLARR_API_KEY = INDEXER_MANAGER_API_KEY;
const PROWLARR_STRICT_ID_MATCH = INDEXER_MANAGER_STRICT_ID_MATCH;

// Addon Configuration
const ADDON_BASE_URL = (process.env.ADDON_BASE_URL || '').trim();
const MANIFEST_AUTH_PASSWORD = (process.env.MANIFEST_AUTH_PASSWORD || '').trim();
const PORT = Number(process.env.PORT || 7000);

// NZBDav Configuration
const NZBDAV_URL = (process.env.NZBDAV_URL || '').trim();
const NZBDAV_API_KEY = (process.env.NZBDAV_API_KEY || '').trim();
const NZBDAV_CATEGORY_MOVIES = process.env.NZBDAV_CATEGORY_MOVIES || 'Movies';
const NZBDAV_CATEGORY_SERIES = process.env.NZBDAV_CATEGORY_SERIES || 'Tv';
const NZBDAV_CATEGORY_DEFAULT = process.env.NZBDAV_CATEGORY_DEFAULT || 'Movies';
const NZBDAV_WEBDAV_USER = (process.env.NZBDAV_WEBDAV_USER || '').trim();
const NZBDAV_WEBDAV_PASS = (process.env.NZBDAV_WEBDAV_PASS || '').trim();
const NZBDAV_WEBDAV_URL = (process.env.NZBDAV_WEBDAV_URL || NZBDAV_URL).trim();
const NZBDAV_WEBDAV_ROOT = '/';

// NZBDav Timeouts and Limits
const NZBDAV_POLL_INTERVAL_MS = 2000;
const NZBDAV_POLL_TIMEOUT_MS = 80000;
const NZBDAV_CACHE_TTL_MINUTES = (() => {
  const raw = toFiniteNumber(process.env.NZBDAV_CACHE_TTL_MINUTES);
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (raw === 0) return 0;
  return 1440; // default 24 hours
})();
const NZBDAV_CACHE_TTL_MS = NZBDAV_CACHE_TTL_MINUTES > 0 ? NZBDAV_CACHE_TTL_MINUTES * 60 * 1000 : 0;
const NZBDAV_HISTORY_FETCH_LIMIT = (() => {
  const raw = toFiniteNumber(process.env.NZBDAV_HISTORY_FETCH_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 400;
})();
const NZBDAV_MAX_DIRECTORY_DEPTH = 6;
const NZBDAV_API_TIMEOUT_MS = 80000;
const NZBDAV_HISTORY_TIMEOUT_MS = 60000;
const NZBDAV_STREAM_TIMEOUT_MS = 240000;

// Stream Configuration
const STREAM_HIGH_WATER_MARK = (() => {
  const parsed = Number(process.env.STREAM_HIGH_WATER_MARK);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();

// External Metadata Provider Support
const OBFUSCATED_SPECIAL_PROVIDER_URL = 'aHR0cHM6Ly9kaXJ0eS1waW5rLmVycy5wdw==';
const OBFUSCATED_SPECIAL_ID_PREFIX = 'cG9ybmRi';
const SPECIAL_ID_PREFIX = decodeBase64Value(OBFUSCATED_SPECIAL_ID_PREFIX) || 'porndb';
const specialCatalogPrefixes = new Set(['pt', SPECIAL_ID_PREFIX]);
const EXTERNAL_SPECIAL_PROVIDER_URL = (() => {
  const envUrl = (process.env.EXTERNAL_SPECIAL_ADDON_URL || process.env.EXTERNAL_ADDON_URL || '').trim();
  if (envUrl) return stripTrailingSlashes(envUrl);
  const decoded = decodeBase64Value(OBFUSCATED_SPECIAL_PROVIDER_URL);
  return decoded ? stripTrailingSlashes(decoded) : '';
})();

// NZB Triage Configuration
function buildTriageNntpConfig() {
  const host = (process.env.NZB_TRIAGE_NNTP_HOST || '').trim();
  const port = toPositiveInt(process.env.NZB_TRIAGE_NNTP_PORT, 563);
  const user = (process.env.NZB_TRIAGE_NNTP_USER || '').trim();
  const pass = (process.env.NZB_TRIAGE_NNTP_PASS || '').trim();
  const tls = toBoolean(process.env.NZB_TRIAGE_NNTP_TLS, true);

  if (!host || !user || !pass) return null;

  return { host, port, user, pass, tls };
}

const TRIAGE_ENABLED = toBoolean(process.env.NZB_TRIAGE_ENABLED, false);
const TRIAGE_TIME_BUDGET_MS = toPositiveInt(process.env.NZB_TRIAGE_TIME_BUDGET_MS, 30000);
const TRIAGE_MAX_CANDIDATES = toPositiveInt(process.env.NZB_TRIAGE_MAX_CANDIDATES, 25);
const TRIAGE_PREFERRED_SIZE_GB = toFiniteNumber(process.env.NZB_TRIAGE_PREFERRED_SIZE_GB, 20);
const TRIAGE_PREFERRED_SIZE_BYTES = TRIAGE_PREFERRED_SIZE_GB > 0 ? TRIAGE_PREFERRED_SIZE_GB * 1024 * 1024 * 1024 : null;
const TRIAGE_PRIORITY_INDEXERS = parseCommaList(process.env.NZB_TRIAGE_PRIORITY_INDEXERS || '');
const TRIAGE_DOWNLOAD_CONCURRENCY = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_CONCURRENCY, 8);
const TRIAGE_DOWNLOAD_TIMEOUT_MS = toPositiveInt(process.env.NZB_TRIAGE_DOWNLOAD_TIMEOUT_MS, 10000);
const TRIAGE_MAX_CONNECTIONS = toPositiveInt(process.env.NZB_TRIAGE_MAX_CONNECTIONS, 60);
const TRIAGE_STAT_TIMEOUT_MS = toPositiveInt(process.env.NZB_TRIAGE_STAT_TIMEOUT_MS, 10000);
const TRIAGE_FETCH_TIMEOUT_MS = toPositiveInt(process.env.NZB_TRIAGE_FETCH_TIMEOUT_MS, 10000);
const TRIAGE_MAX_PARALLEL_NZBS = toPositiveInt(process.env.NZB_TRIAGE_MAX_PARALLEL_NZBS, 16);
const TRIAGE_STAT_SAMPLE_COUNT = toPositiveInt(process.env.NZB_TRIAGE_STAT_SAMPLE_COUNT, 6);
const TRIAGE_ARCHIVE_SAMPLE_COUNT = toPositiveInt(process.env.NZB_TRIAGE_ARCHIVE_SAMPLE_COUNT, 4);
const TRIAGE_MAX_DECODED_BYTES = toPositiveInt(process.env.NZB_TRIAGE_MAX_DECODED_BYTES, 32768);
const TRIAGE_ARCHIVE_DIRS = parsePathList(process.env.NZB_TRIAGE_ARCHIVE_DIRS || '');
const TRIAGE_NNTP_CONFIG = buildTriageNntpConfig();

// External Services
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';

// Asset Paths
const FAILURE_VIDEO_FILENAME = 'failure_video.mp4';

// Video Extensions
const NZBDAV_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg'
]);

const NZBDAV_SUPPORTED_METHODS = new Set(['GET', 'HEAD']);

module.exports = {
  // Helper functions
  toFiniteNumber,
  toPositiveInt,
  toBoolean,
  parseCommaList,
  parsePathList,

  // Indexer Manager
  INDEXER_MANAGER,
  INDEXER_MANAGER_URL,
  INDEXER_MANAGER_API_KEY,
  INDEXER_MANAGER_STRICT_ID_MATCH,
  INDEXER_MANAGER_LABEL,
  INDEXER_MANAGER_CACHE_MINUTES,
  INDEXER_MANAGER_BASE_URL,

  // Prowlarr (legacy, for backward compatibility)
  PROWLARR_URL,
  PROWLARR_API_KEY,
  PROWLARR_STRICT_ID_MATCH,

  // Addon
  ADDON_BASE_URL,
  MANIFEST_AUTH_PASSWORD,
  PORT,

  // NZBDav
  NZBDAV_URL,
  NZBDAV_API_KEY,
  NZBDAV_CATEGORY_MOVIES,
  NZBDAV_CATEGORY_SERIES,
  NZBDAV_CATEGORY_DEFAULT,
  NZBDAV_WEBDAV_USER,
  NZBDAV_WEBDAV_PASS,
  NZBDAV_WEBDAV_URL,
  NZBDAV_WEBDAV_ROOT,
  NZBDAV_POLL_INTERVAL_MS,
  NZBDAV_POLL_TIMEOUT_MS,
  NZBDAV_CACHE_TTL_MINUTES,
  NZBDAV_CACHE_TTL_MS,
  NZBDAV_HISTORY_FETCH_LIMIT,
  NZBDAV_MAX_DIRECTORY_DEPTH,
  NZBDAV_API_TIMEOUT_MS,
  NZBDAV_HISTORY_TIMEOUT_MS,
  NZBDAV_STREAM_TIMEOUT_MS,
  NZBDAV_VIDEO_EXTENSIONS,
  NZBDAV_SUPPORTED_METHODS,

  // Stream
  STREAM_HIGH_WATER_MARK,

  // External Metadata Provider
  SPECIAL_ID_PREFIX,
  specialCatalogPrefixes,
  EXTERNAL_SPECIAL_PROVIDER_URL,

  // NZB Triage
  TRIAGE_ENABLED,
  TRIAGE_TIME_BUDGET_MS,
  TRIAGE_MAX_CANDIDATES,
  TRIAGE_PREFERRED_SIZE_GB,
  TRIAGE_PREFERRED_SIZE_BYTES,
  TRIAGE_PRIORITY_INDEXERS,
  TRIAGE_DOWNLOAD_CONCURRENCY,
  TRIAGE_DOWNLOAD_TIMEOUT_MS,
  TRIAGE_MAX_CONNECTIONS,
  TRIAGE_STAT_TIMEOUT_MS,
  TRIAGE_FETCH_TIMEOUT_MS,
  TRIAGE_MAX_PARALLEL_NZBS,
  TRIAGE_STAT_SAMPLE_COUNT,
  TRIAGE_ARCHIVE_SAMPLE_COUNT,
  TRIAGE_MAX_DECODED_BYTES,
  TRIAGE_ARCHIVE_DIRS,
  TRIAGE_NNTP_CONFIG,

  // External Services
  CINEMETA_URL,

  // Assets
  FAILURE_VIDEO_FILENAME
};
