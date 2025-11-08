const axios = require('axios');
const { CINEMETA_URL } = require('../config/environment');

/**
 * Fetch metadata from Cinemeta
 * @param {string} type - Content type (movie, series, etc.)
 * @param {string} primaryId - IMDb ID
 * @returns {Promise<object|null>} Metadata object or null
 */
async function fetchCinemetaMetadata(type, primaryId) {
  const cinemetaPath = type === 'series' ? `series/${primaryId}.json` : `${type}/${primaryId}.json`;
  const cinemetaUrl = `${CINEMETA_URL}/${cinemetaPath}`;

  try {
    console.log(`[CINEMETA] Fetching metadata from ${cinemetaUrl}`);
    const response = await axios.get(cinemetaUrl, { timeout: 10000 });
    const meta = response.data?.meta || null;

    if (meta) {
      console.log('[CINEMETA] Received metadata identifiers', {
        imdb: meta?.ids?.imdb || meta?.imdb_id,
        tvdb: meta?.ids?.tvdb || meta?.tvdb_id,
        tmdb: meta?.ids?.tmdb || meta?.tmdb_id
      });
    } else {
      console.warn(`[CINEMETA] No metadata payload returned for ${cinemetaUrl}`);
    }

    return meta;
  } catch (error) {
    console.warn(`[CINEMETA] Failed to fetch metadata for ${primaryId}: ${error.message}`);
    return null;
  }
}

module.exports = {
  fetchCinemetaMetadata
};
