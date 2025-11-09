const {
  INDEXER_MANAGER,
  INDEXER_MANAGER_STRICT_ID_MATCH,
  INDEXER_MANAGER_LABEL
} = require('../config/environment');
const { isTorrentResult } = require('../utils/parsers');

/**
 * Check if using Prowlarr as the indexer manager
 * @returns {boolean}
 */
function isUsingProwlarr() {
  return INDEXER_MANAGER === 'prowlarr';
}

/**
 * Check if using NZBHydra as the indexer manager
 * @returns {boolean}
 */
function isUsingNzbhydra() {
  return INDEXER_MANAGER === 'nzbhydra';
}

/**
 * Derive a unique key for a search result (for deduplication)
 * @param {object} result - Search result
 * @returns {string|null} Unique key or null
 */
function deriveResultKey(result) {
  if (!result) return null;
  const indexerId = result.indexerId || result.IndexerId || 'unknown';
  const indexer = result.indexer || result.Indexer || '';
  const title = (result.title || result.Title || '').trim();
  const size = result.size || result.Size || 0;
  return `${indexerId}|${indexer}|${title}|${size}`;
}

/**
 * Search indexer for content using the configured indexer manager (Prowlarr or NZBHydra)
 * @param {object} params - Search parameters
 * @param {object} params.metaIds - Object with imdb, tmdb, tvdb IDs
 * @param {string} params.type - Content type (movie, series, etc.)
 * @param {string} params.movieTitle - Title of the content
 * @param {number} params.releaseYear - Release year
 * @param {number} params.seasonNum - Season number (for series)
 * @param {number} params.episodeNum - Episode number (for series)
 * @param {string} params.primaryId - Primary IMDb ID
 * @param {Array<number>} params.selectedIndexers - Array of indexer IDs to search (optional, defaults to all)
 * @param {object} params.selectedCategories - Object mapping indexer IDs to category IDs (optional)
 * @returns {Promise<Array>} Array of search results
 */
async function searchIndexer({ metaIds, type, movieTitle, releaseYear, seasonNum, episodeNum, primaryId, selectedIndexers, selectedCategories }) {
  // Import the appropriate implementation
  let implementation;
  if (isUsingNzbhydra()) {
    implementation = require('./nzbhydra');
  } else {
    implementation = require('./prowlarr');
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

  const searchPlans = [];
  const seenPlans = new Set();

  const addPlan = (planType, { tokens = [], rawQuery = null } = {}) => {
    let query = rawQuery;
    if (!query) {
      const tokenList = [...tokens];
      if (planType === 'tvsearch') {
        if (seasonToken) tokenList.push(seasonToken);
        if (episodeToken) tokenList.push(episodeToken);
      }
      query = tokenList.filter(Boolean).join(' ');
    }
    if (!query) {
      return false;
    }
    const planKey = `${planType}|${query}`;
    if (seenPlans.has(planKey)) {
      return false;
    }
    seenPlans.add(planKey);
    searchPlans.push({ type: planType, query, tokens });
    return true;
  };

  // Add ID-based searches
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

  // Add text-based search if not in strict mode
  if (!INDEXER_MANAGER_STRICT_ID_MATCH) {
    const textQueryParts = [];
    if (movieTitle) {
      textQueryParts.push(movieTitle);
    }
    if (type === 'movie' && Number.isFinite(releaseYear)) {
      textQueryParts.push(String(releaseYear));
    } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
      textQueryParts.push(`S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
    }

    const textQueryFallback = (textQueryParts.join(' ').trim() || primaryId).trim();
    const addedTextPlan = addPlan('search', { rawQuery: textQueryFallback, tokens: [] });
    if (addedTextPlan) {
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Added text search plan`, { query: textQueryFallback });
    } else {
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Text search plan already present`, { query: textQueryFallback });
    }
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Strict ID matching enabled; skipping text-based search`);
  }

  const usingStrictIdMatching = INDEXER_MANAGER_STRICT_ID_MATCH;
  const resultsByKey = usingStrictIdMatching ? null : new Map();
  const aggregatedResults = usingStrictIdMatching ? [] : null;
  const planSummaries = [];

  const planExecutions = searchPlans.map(async (plan) => {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Dispatching plan`, plan);

    try {
      const data = await implementation.executeSearch(plan, { selectedIndexers, selectedCategories, type });
      return { plan, status: 'fulfilled', data };
    } catch (error) {
      console.error(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Search plan failed:`, error.message);
      return { plan, status: 'rejected', error };
    }
  });

  const planResultsSettled = await Promise.all(planExecutions);

  for (const result of planResultsSettled) {
    const { plan } = result;
    if (result.status === 'rejected') {
      console.error(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ❌ Search plan failed`, {
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
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`);

    const filteredResults = planResults.filter((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      if (!item.downloadUrl) {
        return false;
      }
      return !isTorrentResult(item);
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
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Plan summary`, planSummaries[planSummaries.length - 1]);
  }

  const aggregationCount = usingStrictIdMatching ? aggregatedResults.length : resultsByKey.size;
  if (aggregationCount === 0) {
    console.warn(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ⚠ All ${searchPlans.length} search plans returned no NZB results`);
  } else if (usingStrictIdMatching) {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Aggregated NZB results with strict ID matching`, {
      plansRun: searchPlans.length,
      totalResults: aggregationCount
    });
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Aggregated unique NZB results`, {
      plansRun: searchPlans.length,
      uniqueResults: aggregationCount
    });
  }

  const dedupedNzbResults = usingStrictIdMatching
    ? aggregatedResults.map((entry) => entry.result)
    : Array.from(resultsByKey.values()).map((entry) => entry.result);

  const finalNzbResults = dedupedNzbResults
    .filter((result, index) => {
      if (!result.downloadUrl || !result.indexerId) {
        console.warn(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Skipping NZB result ${index} missing required fields`, {
          hasDownloadUrl: !!result.downloadUrl,
          hasIndexerId: !!result.indexerId,
          title: result.title
        });
        return false;
      }
      return true;
    })
    .map((result) => ({ ...result, _sourceType: 'nzb' }));

  console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Final NZB selection: ${finalNzbResults.length} results`);

  return finalNzbResults;
}

module.exports = {
  isUsingProwlarr,
  isUsingNzbhydra,
  deriveResultKey,
  searchIndexer
};
