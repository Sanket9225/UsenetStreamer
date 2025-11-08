const axios = require('axios');
const { PROWLARR_URL, PROWLARR_API_KEY, PROWLARR_STRICT_ID_MATCH } = require('../config/environment');
const { isTorrentResult } = require('../utils/parsers');
const { ensureProwlarrConfigured } = require('../utils/validators');

/**
 * Search Prowlarr for content
 * @param {object} params - Search parameters
 * @param {object} params.metaIds - Object with imdb, tmdb, tvdb IDs
 * @param {string} params.type - Content type (movie, series, etc.)
 * @param {string} params.movieTitle - Title of the content
 * @param {number} params.releaseYear - Release year
 * @param {number} params.seasonNum - Season number (for series)
 * @param {number} params.episodeNum - Episode number (for series)
 * @param {string} params.primaryId - Primary IMDb ID
 * @returns {Promise<Array>} Array of search results
 */
async function searchProwlarr({ metaIds, type, movieTitle, releaseYear, seasonNum, episodeNum, primaryId }) {
  ensureProwlarrConfigured();

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
    searchPlans.push({ type: planType, query });
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
  if (!PROWLARR_STRICT_ID_MATCH) {
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
    const addedTextPlan = addPlan('search', { rawQuery: textQueryFallback });
    if (addedTextPlan) {
      console.log('[PROWLARR] Added text search plan', { query: textQueryFallback });
    } else {
      console.log('[PROWLARR] Text search plan already present', { query: textQueryFallback });
    }
  } else {
    console.log('[PROWLARR] Strict ID matching enabled; skipping text-based search');
  }

  const baseSearchParams = {
    limit: '100',
    offset: '0',
    indexerIds: '-1'
  };

  const deriveResultKey = (result) => {
    if (!result) return null;
    const indexerId = result.indexerId || result.IndexerId || 'unknown';
    const indexer = result.indexer || result.Indexer || '';
    const title = (result.title || result.Title || '').trim();
    const size = result.size || result.Size || 0;
    return `${indexerId}|${indexer}|${title}|${size}`;
  };

  const usingStrictIdMatching = PROWLARR_STRICT_ID_MATCH;
  const resultsByKey = usingStrictIdMatching ? null : new Map();
  const aggregatedResults = usingStrictIdMatching ? [] : null;
  const planSummaries = [];

  const planExecutions = searchPlans.map((plan) => {
    console.log('[PROWLARR] Dispatching plan', plan);
    return axios
      .get(`${PROWLARR_URL}/api/v1/search`, {
        params: { ...baseSearchParams, type: plan.type, query: plan.query },
        headers: { 'X-Api-Key': PROWLARR_API_KEY },
        timeout: 60000
      })
      .then((response) => ({ plan, status: 'fulfilled', data: response.data }))
      .catch((error) => ({ plan, status: 'rejected', error }));
  });

  const planResultsSettled = await Promise.all(planExecutions);

  for (const result of planResultsSettled) {
    const { plan } = result;
    if (result.status === 'rejected') {
      console.error('[PROWLARR] ❌ Search plan failed', {
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
    console.log(`[PROWLARR] ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`);

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
    console.log('[PROWLARR] ✅ Plan summary', planSummaries[planSummaries.length - 1]);
  }

  const aggregationCount = usingStrictIdMatching ? aggregatedResults.length : resultsByKey.size;
  if (aggregationCount === 0) {
    console.warn(`[PROWLARR] ⚠ All ${searchPlans.length} search plans returned no NZB results`);
  } else if (usingStrictIdMatching) {
    console.log('[PROWLARR] ✅ Aggregated NZB results with strict ID matching', {
      plansRun: searchPlans.length,
      totalResults: aggregationCount
    });
  } else {
    console.log('[PROWLARR] ✅ Aggregated unique NZB results', {
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
        console.warn(`[PROWLARR] Skipping NZB result ${index} missing required fields`, {
          hasDownloadUrl: !!result.downloadUrl,
          hasIndexerId: !!result.indexerId,
          title: result.title
        });
        return false;
      }
      return true;
    })
    .map((result) => ({ ...result, _sourceType: 'nzb' }));

  console.log(`[PROWLARR] Final NZB selection: ${finalNzbResults.length} results`);

  return finalNzbResults;
}

module.exports = {
  searchProwlarr
};
