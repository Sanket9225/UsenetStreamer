const axios = require('axios');

let TVDB_ENABLED = false;
let TVDB_API_KEY = '';
let tvdbToken = null;
let tvdbTokenExpiry = 0;

const TVDB_BASE_URL = 'https://api4.thetvdb.com/v4';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

function reloadConfig() {
  const enabledRaw = (process.env.TVDB_ENABLED ?? 'false').toString().trim().toLowerCase();
  TVDB_ENABLED = !['false', '0', 'off', 'no'].includes(enabledRaw);
  TVDB_API_KEY = (process.env.TVDB_API_KEY || '').trim();
  console.log('[TVDB] Config reloaded', { enabled: TVDB_ENABLED, hasApiKey: Boolean(TVDB_API_KEY) });
}

reloadConfig();

function isConfigured() {
  return Boolean(TVDB_ENABLED && TVDB_API_KEY);
}

function getConfig() {
  return { enabled: TVDB_ENABLED, apiKey: TVDB_API_KEY };
}

async function getToken() {
  if (!isConfigured()) return null;
  if (tvdbToken && Date.now() < tvdbTokenExpiry) {
    return tvdbToken;
  }

  const response = await axios.post(`${TVDB_BASE_URL}/login`, {
    apikey: TVDB_API_KEY,
  }, {
    timeout: 10000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error(`TVDB login failed (HTTP ${response.status})`);
  }

  const token = response.data?.data?.token || response.data?.token || null;
  if (!token) {
    throw new Error('TVDB login failed (missing token)');
  }

  tvdbToken = token;
  tvdbTokenExpiry = Date.now() + TOKEN_TTL_MS;
  return token;
}

async function tvdbRequest(path, params = {}) {
  const token = await getToken();
  if (!token) return null;
  const response = await axios.get(`${TVDB_BASE_URL}${path}`, {
    params,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 12000,
    validateStatus: () => true,
  });

  if (response.status === 401 || response.status === 403) {
    tvdbToken = null;
    tvdbTokenExpiry = 0;
    throw new Error('TVDB unauthorized');
  }
  if (response.status >= 400) {
    throw new Error(`TVDB request failed (HTTP ${response.status})`);
  }

  return response.data;
}

function extractImdbIdFromSeries(data) {
  if (!data) return null;
  const direct = data.imdbId || data.imdb_id;
  if (direct) return String(direct).trim();
  const remoteIds = data.remoteIds || data.remote_ids || [];
  const candidates = Array.isArray(remoteIds) ? remoteIds : [];
  const imdbEntry = candidates.find((entry) => String(entry?.sourceName || entry?.source_name || '').toLowerCase().includes('imdb'));
  if (imdbEntry?.id) return String(imdbEntry.id).trim();
  if (imdbEntry?.value) return String(imdbEntry.value).trim();
  return null;
}

function extractTvdbIdFromSearchResult(entry) {
  if (!entry) return null;
  const candidate = entry.tvdb_id || entry.tvdbId || entry.id || entry.seriesId || entry.series_id;
  if (!candidate) return null;
  const trimmed = String(candidate).trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

async function getImdbIdForSeries(tvdbId) {
  if (!isConfigured() || !tvdbId) return null;
  try {
    const data = await tvdbRequest(`/series/${tvdbId}/extended`, { meta: 'translations' });
    const imdbId = extractImdbIdFromSeries(data?.data || data);
    return imdbId ? { imdbId } : null;
  } catch (error) {
    console.warn('[TVDB] Failed to resolve IMDb ID from TVDB ID', error.message);
    return null;
  }
}

async function getTvdbIdForSeries(imdbId) {
  if (!isConfigured() || !imdbId) return null;
  const id = String(imdbId).trim();
  try {
    // Exact remote-ID lookup. The general /search text endpoint does fuzzy TITLE
    // matching and returns nothing for an IMDb ID string (it only "worked"
    // when TVDB's search index happened to match embedded remote-IDs) — so
    // IMDb-only series silently failed to resolve a TVDB ID, which under Strict
    // ID Matching left the request with an imdbid-only search and no results.
    // /search/remoteid/{id} is the stable exact-lookup endpoint; each hit wraps
    // the matched record under series / movie / people / company.
    const data = await tvdbRequest(`/search/remoteid/${encodeURIComponent(id)}`);
    const list = Array.isArray(data?.data) ? data.data : [];
    for (const entry of list) {
      const series = entry?.series || (entry && entry.type === 'series' ? entry : null);
      const tvdbId = extractTvdbIdFromSearchResult(series);
      if (tvdbId) return { tvdbId };
    }
    return null;
  } catch (error) {
    console.warn('[TVDB] Failed to resolve TVDB ID from IMDb ID', error.message);
    return null;
  }
}

async function getEpisodeAirDateForSeries(tvdbId, season, episode) {
  if (!isConfigured() || !tvdbId || !Number.isFinite(Number(season)) || !Number.isFinite(Number(episode))) {
    return null;
  }
  try {
    const data = await tvdbRequest(`/series/${tvdbId}/episodes/default`, { season: Number(season), episodeNumber: Number(episode) });
    const list = Array.isArray(data?.data?.episodes) ? data.data.episodes : (Array.isArray(data?.data) ? data.data : []);
    const found = list.find((ep) => Number(ep.seasonNumber || ep.season) === Number(season) && Number(ep.number || ep.episodeNumber) === Number(episode));
    if (found?.aired) return String(found.aired).trim();
    if (found?.firstAired) return String(found.firstAired).trim();
    return null;
  } catch (error) {
    console.warn('[TVDB] Failed to resolve episode air date:', error.message);
    return null;
  }
}

async function testTvdbConnection({ apiKey, enabled }) {
  if (enabled !== undefined) {
    const normalized = String(enabled).trim().toLowerCase();
    TVDB_ENABLED = !['false', '0', 'off', 'no'].includes(normalized);
  }
  if (apiKey !== undefined) {
    TVDB_API_KEY = String(apiKey || '').trim();
  }
  if (!isConfigured()) {
    throw new Error('TVDB is not configured');
  }
  await getToken();
  return 'Connected to TVDB';
}

module.exports = {
  reloadConfig,
  isConfigured,
  getConfig,
  getImdbIdForSeries,
  getTvdbIdForSeries,
  getEpisodeAirDateForSeries,
  testTvdbConnection,
};
