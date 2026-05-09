const { parseReleaseMetadata } = require('../services/metadata/releaseParser');
const tmdbService = require('../services/tmdb');

function fallbackMeta(entry, type, addonBaseUrl) {
  return {
    id: `nzbdav:${entry.nzoId}`,
    type,
    name: entry?.jobName || 'NZBDav Completed',
    poster: `${(addonBaseUrl || '').replace(/\/$/, '')}/assets/icon.png`,
  };
}

// Episode releases share a show title in TMDb, so a series catalog enriched
// to "The Bear" / "The Bear" / "The Bear" hides the per-episode identity that
// the raw jobName carried. Append SxxEyy when the parser surfaces it.
function formatEnrichedSeriesName(tmdbTitle, parsed) {
  if (!tmdbTitle) return null;
  const season = Number.isFinite(parsed?.season) ? parsed.season : null;
  const episode = Number.isFinite(parsed?.episode) ? parsed.episode : null;
  if (season === null || episode === null) return tmdbTitle;
  const ss = String(season).padStart(2, '0');
  const ee = String(episode).padStart(2, '0');
  return `${tmdbTitle} S${ss}E${ee}`;
}

/**
 * Build a Stremio-shaped meta object for an NZBDav history entry, enriching
 * the display name and poster from TMDb when an API key is configured. Falls
 * back to the addon icon and the raw jobName otherwise.
 *
 * @param {object} entry - nzbdav history entry { nzoId, jobName, ... }
 * @param {string} type - 'movie' or 'series'
 * @param {string} addonBaseUrl - ADDON_BASE_URL (used for the fallback poster)
 * @returns {Promise<object>} Stremio meta { id, type, name, poster }
 */
async function buildNzbdavMeta(entry, type, addonBaseUrl) {
  const meta = fallbackMeta(entry, type, addonBaseUrl);

  if (!entry?.jobName || !tmdbService.isConfigured()) {
    return meta;
  }

  const parsed = parseReleaseMetadata(entry.jobName);
  const searchTitle = parsed?.parsedTitle || null;
  if (!searchTitle) {
    return meta;
  }

  const tmdbMatch = await tmdbService.searchByTitle({
    title: searchTitle,
    type,
    year: Number.isFinite(parsed?.year) ? parsed.year : null,
  });

  if (!tmdbMatch) {
    return meta;
  }

  const enrichedName =
    type === 'series'
      ? formatEnrichedSeriesName(tmdbMatch.title, parsed) || meta.name
      : tmdbMatch.title || meta.name;

  return {
    ...meta,
    name: enrichedName,
    poster: tmdbMatch.posterUrl || meta.poster,
  };
}

/**
 * Single-item variant of buildNzbdavMeta with a soft time budget. Used by the
 * meta endpoint so a slow or unreachable TMDb cannot stall the response past
 * client/proxy timeouts. Falls back to the plain meta on deadline.
 *
 * @param {object} entry
 * @param {string} type
 * @param {string} addonBaseUrl
 * @param {object} [options]
 * @param {number} [options.timeBudgetMs=3000]
 * @returns {Promise<object>}
 */
async function buildNzbdavMetaWithDeadline(
  entry,
  type,
  addonBaseUrl,
  { timeBudgetMs = 3000 } = {}
) {
  if (!tmdbService.isConfigured()) {
    return buildNzbdavMeta(entry, type, addonBaseUrl);
  }

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackMeta(entry, type, addonBaseUrl)), timeBudgetMs);
  });

  try {
    return await Promise.race([
      buildNzbdavMeta(entry, type, addonBaseUrl).catch(() => fallbackMeta(entry, type, addonBaseUrl)),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build metas for a list of NZBDav entries.
 *
 * Returns immediately-usable fallback metas, then enriches each one with
 * TMDb data subject to two limits: a worker pool to bound parallel TMDb
 * traffic, and a soft time budget so a slow or unreachable TMDb cannot
 * stall the catalog response. Items still in flight at the deadline keep
 * running in the background — they warm the TMDb cache for subsequent
 * requests but do not block the current response.
 *
 * @param {Array<object>} entries
 * @param {string} type - 'movie' or 'series'
 * @param {string} addonBaseUrl
 * @param {object} [options]
 * @param {number} [options.concurrency=5]
 * @param {number} [options.timeBudgetMs=4000]
 * @returns {Promise<Array<object>>}
 */
async function buildNzbdavMetas(
  entries,
  type,
  addonBaseUrl,
  { concurrency = 5, timeBudgetMs = 4000 } = {}
) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const results = entries.map((entry) => fallbackMeta(entry, type, addonBaseUrl));

  if (!tmdbService.isConfigured()) return results;

  const workerCount = Math.max(1, Math.min(concurrency, entries.length));
  let cursor = 0;

  const enrichmentPromise = (async () => {
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < entries.length) {
        const index = cursor++;
        try {
          results[index] = await buildNzbdavMeta(entries[index], type, addonBaseUrl);
        } catch (_error) {
          // Keep the fallback meta on enrichment failure
        }
      }
    });
    await Promise.all(workers);
  })();

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(resolve, timeBudgetMs);
  });

  try {
    await Promise.race([enrichmentPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }

  return results;
}

module.exports = buildNzbdavMeta;
module.exports.buildNzbdavMeta = buildNzbdavMeta;
module.exports.buildNzbdavMetas = buildNzbdavMetas;
module.exports.buildNzbdavMetaWithDeadline = buildNzbdavMetaWithDeadline;
