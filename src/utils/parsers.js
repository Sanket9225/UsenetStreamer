const { NZBDAV_VIDEO_EXTENSIONS } = require('../config/environment');
const posixPath = require('path').posix;

/**
 * Check if a result is a torrent (should be filtered out)
 * @param {object} result - Prowlarr search result
 * @returns {boolean} True if result is a torrent
 */
function isTorrentResult(result) {
  const protocol = (result.protocol || result.downloadProtocol || '').toLowerCase();
  if (protocol === 'torrent') {
    return true;
  }

  const guid = (result.guid || '').toLowerCase();
  const downloadUrl = (result.downloadUrl || '').toLowerCase();
  const link = (result.link || '').toLowerCase();

  if (guid.startsWith('magnet:') || downloadUrl.startsWith('magnet:') || link.startsWith('magnet:')) {
    return true;
  }

  if (guid.endsWith('.torrent') || downloadUrl.endsWith('.torrent') || link.endsWith('.torrent')) {
    return true;
  }

  return false;
}

/**
 * Check if a filename is a video file
 * @param {string} fileName - The filename to check
 * @returns {boolean} True if file is a video
 */
function isVideoFileName(fileName = '') {
  const extension = posixPath.extname(fileName.toLowerCase());
  return NZBDAV_VIDEO_EXTENSIONS.has(extension);
}

/**
 * Check if a file matches the requested episode
 * @param {string} fileName - The filename to check
 * @param {object} requestedEpisode - Object with season and episode numbers
 * @returns {boolean} True if file matches episode
 */
function fileMatchesEpisode(fileName, requestedEpisode) {
  if (!requestedEpisode) {
    return true;
  }
  const { season, episode } = requestedEpisode;
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?![0-9])`, 'i'),
    new RegExp(`s0*${season}\\.?e0*${episode}(?![0-9])`, 'i'),
    new RegExp(`0*${season}[xX]0*${episode}(?![0-9])`, 'i'),
    new RegExp(`[eE](?:pisode|p)\\.?\\s*0*${episode}(?![0-9])`, 'i')
  ];
  return patterns.some((regex) => regex.test(fileName));
}

/**
 * Parse episode information from request
 * @param {string} type - Content type (movie, series, etc.)
 * @param {string} id - Content ID
 * @param {object} query - Query parameters
 * @returns {object|null} Object with season and episode or null
 */
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
      const season = extractInt(parts[1]);
      const episode = extractInt(parts[2]);
      if (season && episode) {
        return { season, episode };
      }
    }
  }

  return null;
}

/**
 * Normalize a path for NZBDav
 * @param {string} pathValue - The path to normalize
 * @returns {string} Normalized path
 */
function normalizeNzbdavPath(pathValue) {
  if (!pathValue) {
    return '/';
  }
  const normalized = pathValue.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Extract year from a value
 * @param {*} value - Value to extract year from
 * @returns {number|null} Year or null
 */
function extractYear(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/\d{4}/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize an IMDb ID
 * @param {*} value - Value to normalize
 * @returns {string|null} Normalized IMDb ID or null
 */
function normalizeImdb(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith('tt') ? trimmed : `tt${trimmed}`;
  return /^tt\d+$/.test(withPrefix) ? withPrefix : null;
}

/**
 * Normalize a numeric ID (TMDB, TVDB, etc.)
 * @param {*} value - Value to normalize
 * @returns {string|null} Normalized ID or null
 */
function normalizeNumericId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Pick the first defined value from a list
 * @param {...*} values - Values to check
 * @returns {*} First defined non-empty value or null
 */
function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || null;
}

module.exports = {
  isTorrentResult,
  isVideoFileName,
  fileMatchesEpisode,
  parseRequestedEpisode,
  normalizeNzbdavPath,
  extractYear,
  normalizeImdb,
  normalizeNumericId,
  pickFirstDefined
};
