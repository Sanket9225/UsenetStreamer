const { PROWLARR_URL, PROWLARR_API_KEY, NZBDAV_URL, NZBDAV_API_KEY, NZBDAV_WEBDAV_URL, ADDON_BASE_URL } = require('../config/environment');

/**
 * Ensure NZBDav is properly configured
 * @throws {Error} If NZBDav configuration is missing
 */
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

/**
 * Ensure Prowlarr is properly configured
 * @throws {Error} If Prowlarr configuration is missing
 */
function ensureProwlarrConfigured() {
  if (!PROWLARR_URL) {
    throw new Error('PROWLARR_URL is not configured');
  }
  if (!PROWLARR_API_KEY) {
    throw new Error('PROWLARR_API_KEY is not configured');
  }
}

/**
 * Ensure addon base URL is configured
 * @throws {Error} If addon base URL is missing
 */
function ensureAddonConfigured() {
  if (!ADDON_BASE_URL) {
    throw new Error('ADDON_BASE_URL is not configured');
  }
}

/**
 * Check if an IMDb ID is valid
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid IMDb ID
 */
function isValidImdbId(id) {
  const primaryId = id?.split(':')[0];
  return /^tt\d+$/.test(primaryId);
}

module.exports = {
  ensureNzbdavConfigured,
  ensureProwlarrConfigured,
  ensureAddonConfigured,
  isValidImdbId
};
