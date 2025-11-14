const axios = require('axios');
const {
  ADDON_BASE_URL,
  specialCatalogPrefixes,
  EXTERNAL_SPECIAL_PROVIDER_URL
} = require('../config/environment');
const { ensureAddonConfigured, ensureProwlarrConfigured, ensureNzbdavConfigured, isValidImdbId } = require('../utils/validators');
const { pickFirstDefined, normalizeImdb, normalizeNumericId, extractYear } = require('../utils/parsers');
const { fetchCinemetaMetadata } = require('../services/cinemeta');
const { searchIndexer } = require('../services/indexer_manager');
const {
  normalizeReleaseTitle,
  fetchCompletedNzbdavHistory,
  getNzbdavCategory
} = require('../services/nzbdav');
const { filterAndSortStreams, formatStremioTitle } = require('../utils/streamFilters');
const { encodeStreamToken } = require('../utils/streamToken');

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
 * Check if external special provider is configured
 * @returns {boolean} True if configured
 */
function ensureSpecialProviderConfigured() {
  return Boolean(EXTERNAL_SPECIAL_PROVIDER_URL);
}

/**
 * Clean title for special provider searches
 * @param {string} rawTitle - Raw title string
 * @returns {string} Cleaned title
 */
function cleanSpecialSearchTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';

  let cleaned = rawTitle;

  // Remove XXX tags
  cleaned = cleaned.replace(/\bXXX\b/gi, '');

  // Remove codec info (x264, x265, H264, H265, HEVC)
  cleaned = cleaned.replace(/\b(x|h)\.?26[45]\b/gi, '');
  cleaned = cleaned.replace(/\bHEVC\b/gi, '');

  // Remove quality markers (1080p, 720p, 4K, 2160p)
  cleaned = cleaned.replace(/\b(1080p|720p|480p|4K|2160p|UHD)\b/gi, '');

  // Remove common delimiters
  cleaned = cleaned.replace(/[._\-]+/g, ' ');

  // Remove year in brackets [2023]
  cleaned = cleaned.replace(/\[\d{4}\]/g, '');

  // Remove extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Fetch metadata from external special provider
 * @param {string} identifier - Full identifier (prefix:id)
 * @returns {Promise<object|null>} Metadata object with title/name or null
 */
async function fetchSpecialMetadata(identifier) {
  if (!ensureSpecialProviderConfigured()) {
    console.warn('[SPECIAL META] External provider not configured');
    return null;
  }

  if (!identifier || typeof identifier !== 'string') {
    return null;
  }

  // Extract provider ID from identifier (format: prefix:id)
  const parts = identifier.split(':');
  if (parts.length < 2) {
    return null;
  }

  const prefix = parts[0];
  const providerId = parts.slice(1).join(':');

  if (!providerId) {
    console.warn(`[SPECIAL META] Invalid identifier format: ${identifier}`);
    return null;
  }

  try {
    // Determine type based on prefix
    const type = 'movie'; // Special catalogs are typically movie-type content
    const metaUrl = `${EXTERNAL_SPECIAL_PROVIDER_URL}/meta/${type}/${identifier}.json`;

    console.log(`[SPECIAL META] Fetching metadata from ${metaUrl}`);
    const response = await axios.get(metaUrl, { timeout: 10000 });

    const meta = response.data?.meta;
    if (!meta) {
      console.warn(`[SPECIAL META] No metadata returned for ${identifier}`);
      return null;
    }

    const title = meta?.title || meta?.name || null;
    if (title) {
      console.log(`[SPECIAL META] Retrieved title: ${title}`);
      return { title, name: title };
    }

    return null;
  } catch (error) {
    console.warn(`[SPECIAL META] Failed to fetch metadata for ${identifier}: ${error.message}`);
    return null;
  }
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
  const { type, id, config } = args;
  const meta = args.extra || {};

  console.log(`[DEBUG] Full args object:`, JSON.stringify(args, null, 2));
  console.log(`[DEBUG] args.config:`, config);

  // Extract user preferences from config
  const userConfig = config || {};
  const preferredLanguage = userConfig.preferredLanguage || 'No Preference';
  const sortMethod = userConfig.sortMethod || 'Quality First';
  const qualityFilter = userConfig.qualityFilter || 'All';
  const maxResults = parseInt(userConfig.maxResults, 10) || 0;
  const selectedIndexers = userConfig.selectedIndexers || null;
  const selectedCategories = userConfig.selectedCategories || null;

  console.log(`[REQUEST] Received request for ${type} ID: ${id}`);
  console.log(`[CONFIG] Raw config from SDK:`, config);
  console.log(`[CONFIG] User preferences:`, { preferredLanguage, sortMethod, qualityFilter, maxResults, selectedIndexers, selectedCategories });

  // Parse baseIdentifier (handles TVDB and special catalog IDs)
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

  // Check for IMDb ID
  if (/^tt\d+$/i.test(baseIdentifier)) {
    incomingImdbId = baseIdentifier.startsWith('tt') ? baseIdentifier : `tt${baseIdentifier}`;
    baseIdentifier = incomingImdbId;
  }

  // Check for TVDB ID
  const tvdbMatch = baseIdentifier.match(/^tvdb:([0-9]+)(?::.*)?$/i);
  if (tvdbMatch) {
    incomingTvdbId = tvdbMatch[1];
    baseIdentifier = `tvdb:${incomingTvdbId}`;
  }

  // Check for special catalog IDs
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

  const isSpecialRequest = Boolean(incomingSpecialId);

  console.log('[REQUEST] Parsed identifiers:', {
    baseIdentifier,
    incomingImdbId,
    incomingTvdbId,
    incomingSpecialId,
    isSpecialRequest
  });

  const primaryId = id.split(':')[0];
  if (!incomingTvdbId && !isSpecialRequest && !isValidImdbId(id)) {
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

  // Add TVDB to metaSources if present
  if (incomingTvdbId) {
    metaSources.push({ ids: { tvdb: incomingTvdbId }, tvdb_id: incomingTvdbId });
  }

  let cinemetaMeta = null;

  // Skip Cinemeta for TVDB and special catalogs
  const needsCinemeta = !incomingTvdbId && !isSpecialRequest && ((!hasTitleInQuery) || (type === 'series' && !hasTvdbInQuery) || (type === 'movie' && !hasTmdbInQuery));
  if (needsCinemeta) {
    cinemetaMeta = await fetchCinemetaMetadata(type, primaryId);
    if (cinemetaMeta) {
      metaSources.push(cinemetaMeta);
    }
  }

  // Fetch external metadata for special requests
  if (isSpecialRequest) {
    const specialMetadata = await fetchSpecialMetadata(baseIdentifier);
    if (specialMetadata?.title) {
      metaSources.push({ title: specialMetadata.title, name: specialMetadata.title });
      console.log(`[SPECIAL META] Using external metadata: ${specialMetadata.title}`);
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
        ),
        incomingTvdbId
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

  // Fetch NZBDav history for instant playback
  const categoryForType = getNzbdavCategory(type);
  let historyByTitle = new Map();

  try {
    historyByTitle = await fetchCompletedNzbdavHistory([categoryForType]);
    if (historyByTitle.size > 0) {
      console.log(`[NZBDAV] Loaded ${historyByTitle.size} completed NZBs for instant playback`);
    }
  } catch (historyError) {
    console.warn(`[NZBDAV] Unable to load NZBDav history: ${historyError.message}`);
  }

  // Search indexer manager (Prowlarr or NZBHydra)
  const finalNzbResults = await searchIndexer({
    metaIds,
    type,
    movieTitle,
    releaseYear,
    seasonNum,
    episodeNum,
    primaryId,
    selectedIndexers,
    selectedCategories
  });

  // Filter by quality and sort into language groups using video-filename-parser
  const { sortedResults, groupInfo } = filterAndSortStreams(
    finalNzbResults,
    sortMethod,
    preferredLanguage,
    qualityFilter
  );

  console.log(`[FILTER+SORT] Applied quality filter: ${qualityFilter}, sort method: ${sortMethod}`);
  if (groupInfo) {
    console.log(`[GROUPS] Preferred: ${groupInfo.preferredCount}, English: ${groupInfo.englishCount}, Other: ${groupInfo.otherCount}`);
  } else {
    console.log(`[SORT] No language grouping (sorted ${sortedResults.length} items)`);
  }

  // Limit results if maxResults is set
  let limitedResults = sortedResults;
  if (maxResults > 0 && sortedResults.length > maxResults) {
    limitedResults = sortedResults.slice(0, maxResults);
    console.log(`[LIMIT] Limited results from ${sortedResults.length} to ${maxResults}`);
  }

  const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, '');

  let streams = limitedResults
    .map((result) => {
      // Get parsed data from result (added by filterAndSortStreams)
      const parsed = result.parsed || {};

      // Normalize title for history lookup
      const normalizedTitle = normalizeReleaseTitle(result.title);
      const historySlot = normalizedTitle ? historyByTitle.get(normalizedTitle) : null;

      // Create stream parameters object
      const streamParams = {
        indexerId: String(result.indexerId),
        type,
        id,
        downloadUrl: result.downloadUrl,
        // Add clean content title for external players
        contentTitle: movieTitle || result.title,
        contentYear: releaseYear
      };

      if (result.guid) streamParams.guid = result.guid;
      if (result.size) streamParams.size = String(result.size);
      if (result.title) streamParams.title = result.title;

      // Add history params if found
      if (historySlot?.nzoId) {
        streamParams.historyNzoId = historySlot.nzoId;
        if (historySlot.jobName) streamParams.historyJobName = historySlot.jobName;
        if (historySlot.category) streamParams.historyCategory = historySlot.category;
      }

      // Encode parameters into a token for external player compatibility
      const token = encodeStreamToken(streamParams);
      const streamUrl = `${addonBaseUrl}/nzb/stream/${token}`;
      const name = 'UsenetStreamer';
      const behaviorHints = {
        notWebReady: true,
        bingeGroup: 'usenetstreamer'
      };

      // Check if this is an instant stream (cached or in history)
      const cacheEntry = null; // This would need to be implemented if you have a cache
      const isInstant = cacheEntry?.status === 'ready' || Boolean(historySlot);

      if (isInstant) {
        behaviorHints.cached = true;
        if (historySlot) {
          behaviorHints.cachedFromHistory = true;
        }
      }

      // Format clean 3-line title using parser data
      // Line 1: 🎬 {Resolution} • {Audio Codec} {Atmos} {Channels}
      // Line 2: {Emoji} {HDR/DV} • {Source} • {Release Group}
      // Line 3: 💾 {Size} • 📡 {Indexer}
      const { line1, line2, line3 } = formatStremioTitle(parsed, result.size, result.indexer);

      // Build tags array
      const tags = [];

      // Add instant badge FIRST if applicable
      if (isInstant) {
        tags.unshift('⚡ Instant');
      }

      // Combine lines with newlines, omit empty lines
      const titleLines = [line1, line2, line3].filter(line => line && line.trim());

      // Add tags if any
      if (tags.length > 0) {
        titleLines.push(tags.join(' • '));
      }

      const formattedTitle = titleLines.join('\n');

      return {
        title: formattedTitle,
        name,
        url: streamUrl,
        behaviorHints
      };
    })
    .filter(Boolean);

  console.log(`[STREMIO] Created ${streams.length} stream objects (before separators)`);

  // Insert visual separators between language groups
  if (groupInfo) {
    const separators = [];
    let offset = 0;

    // Group 1 separator: Preferred Language
    if (groupInfo.preferredCount > 0) {
      const preferredSeparator = {
        name: 'UsenetStreamer',
        title: `━━━━━ ⭐ ${groupInfo.preferredLanguage} (${groupInfo.preferredCount}) ━━━━━`,
        url: 'https://stremio.com',
        behaviorHints: {
          notWebReady: true
        }
      };
      separators.push({ index: 0, separator: preferredSeparator });
      offset++;
    }

    // Group 2 separator: English
    if (groupInfo.englishCount > 0) {
      const englishIndex = groupInfo.group1End + offset;
      const englishSeparator = {
        name: 'UsenetStreamer',
        title: `━━━━━ 🇬🇧 English (${groupInfo.englishCount}) ━━━━━`,
        url: 'https://stremio.com',
        behaviorHints: {
          notWebReady: true
        }
      };
      separators.push({ index: englishIndex, separator: englishSeparator });
      offset++;
    }

    // Group 3 separator: Other Languages
    if (groupInfo.otherCount > 0) {
      const otherIndex = groupInfo.group2End + offset;
      const otherSeparator = {
        name: 'UsenetStreamer',
        title: `━━━━━ 🌍 Other Languages (${groupInfo.otherCount}) ━━━━━`,
        url: 'https://stremio.com',
        behaviorHints: {
          notWebReady: true
        }
      };
      separators.push({ index: otherIndex, separator: otherSeparator });
    }

    // Insert separators in reverse order to maintain correct indices
    for (let i = separators.length - 1; i >= 0; i--) {
      const { index, separator } = separators[i];
      streams.splice(index, 0, separator);
    }

    console.log(`[STREMIO] Added ${separators.length} language group separators`);
  }

  console.log(`[STREMIO] ===== Returning ${streams.length} total items to Stremio =====\n`);

  return { streams };
}

module.exports = {
  handleStreamRequest,
  ensureSpecialProviderConfigured,
  cleanSpecialSearchTitle,
  fetchSpecialMetadata
};
