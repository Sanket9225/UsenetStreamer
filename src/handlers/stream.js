const { ADDON_BASE_URL } = require('../config/environment');
const { ensureAddonConfigured, ensureProwlarrConfigured, ensureNzbdavConfigured, isValidImdbId } = require('../utils/validators');
const { pickFirstDefined, normalizeImdb, normalizeNumericId, extractYear } = require('../utils/parsers');
const { fetchCinemetaMetadata } = require('../services/cinemeta');
const { searchProwlarr } = require('../services/prowlarr');

/**
 * Collect values from multiple sources using extractors
 * @param {Array} metaSources - Array of metadata sources
 * @param {...function} extractors - Extractor functions
 * @returns {Array} Collected values
 */
function collectValues(metaSources, ...extractors) {
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
}

/**
 * Handle stream requests from Stremio
 * @param {object} args - Stream request arguments
 * @param {string} args.type - Content type (movie, series, etc.)
 * @param {string} args.id - Content ID
 * @param {object} args.extra - Extra parameters from Stremio
 * @returns {Promise<object>} Stream response with streams array
 */
async function handleStreamRequest(args) {
  const { type, id } = args;
  const meta = args.extra || {};

  console.log(`[REQUEST] Received request for ${type} ID: ${id}`);

  const primaryId = id.split(':')[0];
  if (!isValidImdbId(id)) {
    throw new Error(`Unsupported ID prefix for Prowlarr ID search: ${primaryId}`);
  }

  ensureAddonConfigured();
  ensureProwlarrConfigured();
  ensureNzbdavConfigured();

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
  let cinemetaMeta = null;

  const needsCinemeta = (!hasTitleInQuery) || (type === 'series' && !hasTvdbInQuery) || (type === 'movie' && !hasTmdbInQuery);
  if (needsCinemeta) {
    cinemetaMeta = await fetchCinemetaMetadata(type, primaryId);
    if (cinemetaMeta) {
      metaSources.push(cinemetaMeta);
    }
  }

  let seasonNum = null;
  let episodeNum = null;
  if (type === 'series' && id.includes(':')) {
    const [, season, episode] = id.split(':');
    const parsedSeason = Number.parseInt(season, 10);
    const parsedEpisode = Number.parseInt(episode, 10);
    seasonNum = Number.isFinite(parsedSeason) ? parsedSeason : null;
    episodeNum = Number.isFinite(parsedEpisode) ? parsedEpisode : null;
  }

  const metaIds = {
    imdb: normalizeImdb(
      pickFirstDefined(
        ...collectValues(
          metaSources,
          (src) => src?.imdb_id,
          (src) => src?.imdb,
          (src) => src?.imdbId,
          (src) => src?.imdbid,
          (src) => src?.ids?.imdb,
          (src) => src?.externals?.imdb
        ),
        primaryId
      )
    ),
    tmdb: normalizeNumericId(
      pickFirstDefined(
        ...collectValues(
          metaSources,
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
          metaSources,
          (src) => src?.tvdb_id,
          (src) => src?.tvdb,
          (src) => src?.tvdbId,
          (src) => src?.ids?.tvdb,
          (src) => src?.externals?.tvdb,
          (src) => src?.tvdbSlug,
          (src) => src?.tvdbid
        )
      )
    )
  };

  console.log('[REQUEST] Normalized identifier set', metaIds);

  const movieTitle = pickFirstDefined(
    ...collectValues(
      metaSources,
      (src) => src?.title,
      (src) => src?.name,
      (src) => src?.originalTitle,
      (src) => src?.original_title
    )
  );

  const releaseYear = extractYear(
    pickFirstDefined(
      ...collectValues(
        metaSources,
        (src) => src?.year,
        (src) => src?.releaseYear,
        (src) => src?.released,
        (src) => src?.releaseInfo?.year
      )
    )
  );

  console.log('[REQUEST] Resolved title/year', { movieTitle, releaseYear });

  // Search Prowlarr
  const finalNzbResults = await searchProwlarr({
    metaIds,
    type,
    movieTitle,
    releaseYear,
    seasonNum,
    episodeNum,
    primaryId
  });

  const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, '');

  const streams = finalNzbResults
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .map((result) => {
      const sizeInGB = result.size ? (result.size / 1073741824).toFixed(2) : null;
      const sizeString = sizeInGB ? `${sizeInGB} GB` : 'Size Unknown';

      const qualityMatch = result.title?.match(/(2160p|4K|UHD|1080p|720p|480p)/i);
      const quality = qualityMatch ? qualityMatch[0] : '';

      const baseParams = new URLSearchParams({
        indexerId: String(result.indexerId),
        type,
        id
      });

      baseParams.set('downloadUrl', result.downloadUrl);
      if (result.guid) baseParams.set('guid', result.guid);
      if (result.size) baseParams.set('size', String(result.size));
      if (result.title) baseParams.set('title', result.title);

      const streamUrl = `${addonBaseUrl}/nzb/stream?${baseParams.toString()}`;
      const name = 'UsenetStreamer';
      const behaviorHints = {
        notWebReady: true,
        bingeGroup: 'usenetstreamer'
      };

      return {
        title: `${result.title}\n${['📰 NZB', quality, sizeString].filter(Boolean).join(' • ')}\n${result.indexer}`,
        name,
        url: streamUrl,
        behaviorHints
      };
    })
    .filter(Boolean);

  console.log(`[STREMIO] Returning ${streams.length} NZB streams`);

  return { streams };
}

module.exports = {
  handleStreamRequest
};
