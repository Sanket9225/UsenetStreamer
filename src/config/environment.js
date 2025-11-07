require('dotenv').config();

// Prowlarr Configuration
const PROWLARR_URL = (process.env.PROWLARR_URL || '').trim();
const PROWLARR_API_KEY = (process.env.PROWLARR_API_KEY || '').trim();
const PROWLARR_STRICT_ID_MATCH = (process.env.PROWLARR_STRICT_ID_MATCH || 'false').toLowerCase() === 'true';

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
const NZBDAV_CACHE_TTL_MS = 3600000;
const NZBDAV_MAX_DIRECTORY_DEPTH = 6;
const NZBDAV_API_TIMEOUT_MS = 80000;
const NZBDAV_HISTORY_TIMEOUT_MS = 60000;
const NZBDAV_STREAM_TIMEOUT_MS = 240000;

// Stream Configuration
const STREAM_HIGH_WATER_MARK = (() => {
  const parsed = Number(process.env.STREAM_HIGH_WATER_MARK);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();

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
  // Prowlarr
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
  NZBDAV_CACHE_TTL_MS,
  NZBDAV_MAX_DIRECTORY_DEPTH,
  NZBDAV_API_TIMEOUT_MS,
  NZBDAV_HISTORY_TIMEOUT_MS,
  NZBDAV_STREAM_TIMEOUT_MS,
  NZBDAV_VIDEO_EXTENSIONS,
  NZBDAV_SUPPORTED_METHODS,

  // Stream
  STREAM_HIGH_WATER_MARK,

  // External Services
  CINEMETA_URL,

  // Assets
  FAILURE_VIDEO_FILENAME
};
