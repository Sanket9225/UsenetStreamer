const axios = require('axios');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

function normalizeLanguageTag(language, fallback = 'en-US') {
  if (typeof language !== 'string') return fallback;
  const trimmed = language.trim();
  return trimmed || fallback;
}

async function fetchTmdbMetadata({ apiKey, type, tmdbId, language }) {
  if (!apiKey || !type || !tmdbId) {
    return null;
  }
  const safeLanguage = normalizeLanguageTag(language);
  const endpoint = type === 'series' ? 'tv' : 'movie';
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}`;
  try {
    const response = await axios.get(url, {
      params: { language: safeLanguage, api_key: apiKey },
      timeout: 5000,
    });
    return response.data || null;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    const message = error?.message || 'unknown error';
    console.warn('[TMDB] Metadata request failed', { tmdbId, type, message });
    return null;
  }
}

async function fetchTmdbTranslations({ apiKey, type, tmdbId }) {
  if (!apiKey || !type || !tmdbId) {
    return [];
  }
  const endpoint = type === 'series' ? 'tv' : 'movie';
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}/translations`;
  try {
    const response = await axios.get(url, {
      params: { api_key: apiKey },
      timeout: 5000,
    });
    if (!response.data || !Array.isArray(response.data.translations)) {
      return [];
    }
    return response.data.translations
      .map((entry) => ({
        iso_639_1: entry?.iso_639_1 || null,
        iso_3166_1: entry?.iso_3166_1 || null,
        name: entry?.name || null,
        english_name: entry?.english_name || null,
        data: entry?.data || null,
      }))
      .filter((entry) => entry.iso_639_1 && entry.data && (entry.data.title || entry.data.name || entry.data.overview));
  } catch (error) {
    const message = error?.message || 'unknown error';
    console.warn('[TMDB] Translation request failed', { tmdbId, type, message });
    return [];
  }
}

async function findTmdbIdByImdb({ apiKey, imdbId, type }) {
  if (!apiKey || !imdbId) return null;
  const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(imdbId)}`;
  try {
    const response = await axios.get(url, {
      params: {
        api_key: apiKey,
        external_source: 'imdb_id'
      },
      timeout: 5000,
    });
    const payload = response.data || {};
    const candidateLists = [payload.movie_results, payload.tv_results, payload.tv_episode_results, payload.tv_season_results].filter(Array.isArray);
    for (const list of candidateLists) {
      if (list.length === 0) continue;
      const first = list[0];
      if (first && first.id) {
        return {
          tmdbId: String(first.id),
          title: first.title || first.name || first.original_title || first.original_name || null,
          releaseDate: first.release_date || first.first_air_date || null,
          mediaType: first.media_type || null,
        };
      }
    }
    return null;
  } catch (error) {
    const status = error?.response?.status;
    if (status && status < 500) {
      return null;
    }
    console.warn('[TMDB] IMDb lookup failed', error?.message || error);
    return null;
  }
}

async function searchTmdbByTitle({ apiKey, type, title, year, language }) {
  if (!apiKey || !title) return null;
  const endpoint = type === 'series' ? 'search/tv' : 'search/movie';
  const url = `${TMDB_BASE_URL}/${endpoint}`;
  const params = {
    api_key: apiKey,
    query: title,
    include_adult: false,
  };
  if (language) params.language = normalizeLanguageTag(language);
  if (year && Number.isFinite(year)) {
    if (type === 'series') params.first_air_date_year = year;
    else params.year = year;
  }
  try {
    const response = await axios.get(url, { params, timeout: 5000 });
    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    const top = results.find((entry) => entry && entry.id);
    if (!top) return null;
    return {
      tmdbId: String(top.id),
      title: top.title || top.name || top.original_title || top.original_name || null,
      releaseDate: top.release_date || top.first_air_date || null,
      language: params.language || null,
    };
  } catch (error) {
    const status = error?.response?.status;
    if (status && status < 500) {
      return null;
    }
    console.warn('[TMDB] Title search failed', error?.message || error);
    return null;
  }
}

async function resolveTmdbId({ apiKey, type, imdbId, title, year, languageCandidates = [] }) {
  if (!apiKey) return null;
  const normalizedType = type === 'series' ? 'series' : 'movie';
  if (imdbId) {
    const imdbMatch = await findTmdbIdByImdb({ apiKey, imdbId, type: normalizedType });
    if (imdbMatch?.tmdbId) {
      return { ...imdbMatch, via: 'imdb' };
    }
  }
  if (title) {
    const candidates = Array.isArray(languageCandidates) && languageCandidates.length > 0
      ? languageCandidates
      : [null];
    for (const candidate of candidates) {
      const searchMatch = await searchTmdbByTitle({ apiKey, type: normalizedType, title, year, language: candidate });
      if (searchMatch?.tmdbId) {
        return { ...searchMatch, via: candidate ? `title:${candidate}` : 'title' };
      }
    }
  }
  return null;
}

function deriveLocaleTokens({ iso639, iso3166, fallbackLanguage }) {
  const tokens = [];
  const lang = typeof iso639 === 'string' ? iso639.trim().toLowerCase() : null;
  const region = typeof iso3166 === 'string' ? iso3166.trim().toLowerCase() : null;
  if (lang && region) {
    tokens.push(`${lang}-${region}`);
  }
  if (lang) {
    tokens.push(lang);
  }
  if (!lang && region && typeof fallbackLanguage === 'string' && fallbackLanguage.trim()) {
    tokens.push(`${fallbackLanguage.trim().toLowerCase()}-${region}`);
  }
  if (region) {
    tokens.push(region);
  }
  return tokens;
}

function normalizeTitleValue(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function containsNonAscii(value) {
  if (typeof value !== 'string') return false;
  return /[^\x00-\x7f]/.test(value);
}

function scoreLocalizedCandidate(candidate, options) {
  const { defaultNormalized, originalNormalized } = options;
  let score = 0;
  if (candidate.source === 'translation') score += 40;
  if (candidate.source === 'alternative') score += 15;
  if (candidate.meta?.type && /official|literal|original/i.test(candidate.meta.type)) {
    score += 8;
  }
  if (candidate.meta?.type && /festival|working|dvd|tv/i.test(candidate.meta.type)) {
    score -= 3;
  }
  if (candidate.meta?.iso639 && options.originalLanguage && candidate.meta.iso639 === options.originalLanguage) {
    score += 6;
  }
  if (candidate.meta?.iso3166) {
    const candidateCountry = candidate.meta.iso3166.toUpperCase();
    if (options.originCountries?.includes(candidateCountry)) {
      score += 4;
    }
  }
  if (candidate.containsNonAscii) {
    score += 3;
  }
  if (candidate.normalizedTitle && candidate.normalizedTitle === defaultNormalized) {
    score -= 6;
  }
  if (candidate.normalizedTitle && candidate.normalizedTitle === originalNormalized) {
    score += 6;
  }
  return score;
}

function buildLocalizedTitles(translations = [], alternativeTitles = [], options = {}) {
  if ((!Array.isArray(translations) || translations.length === 0) && (!Array.isArray(alternativeTitles) || alternativeTitles.length === 0)) {
    return {};
  }
  const candidateMap = new Map();
  const defaultNormalized = normalizeTitleValue(options.defaultTitle);
  const originalNormalized = normalizeTitleValue(options.originalTitle);
  const normalizedOriginCountries = Array.isArray(options.originCountries)
    ? options.originCountries
        .map((entry) => (typeof entry === 'string' ? entry.trim().toUpperCase() : null))
        .filter(Boolean)
    : [];
  const normalizedOriginalLanguage = typeof options.originalLanguage === 'string'
    ? options.originalLanguage.trim().toLowerCase()
    : null;
  const registerCandidate = (tokens, payload) => {
    if (!payload || !payload.title) return;
    const normalizedTitle = normalizeTitleValue(payload.title);
    const containsExtendedGlyphs = containsNonAscii(payload.title);
    tokens.forEach((token) => {
      if (!token) return;
      if (!candidateMap.has(token)) {
        candidateMap.set(token, []);
      }
      candidateMap.get(token).push({
        title: payload.title,
        overview: payload.overview || null,
        tagline: payload.tagline || null,
        source: payload.source || 'translation',
        normalizedTitle,
        containsNonAscii: containsExtendedGlyphs,
        meta: payload.meta || {},
      });
    });
  };

  translations.forEach((entry) => {
    if (!entry || !entry.iso_639_1) return;
    const payload = entry.data || {};
    const title = payload.title || payload.name;
    if (!title) return;
    const tokens = new Set(deriveLocaleTokens({ iso639: entry.iso_639_1, iso3166: entry.iso_3166_1 }));
    registerCandidate(tokens, {
      title,
      overview: payload.overview || null,
      tagline: payload.tagline || null,
      source: 'translation',
      meta: {
        iso639: entry.iso_639_1?.toLowerCase() || null,
        iso3166: entry.iso_3166_1?.toLowerCase() || null,
        name: entry.name || null,
        englishName: entry.english_name || null,
      },
    });
  });

  alternativeTitles.forEach((entry) => {
    if (!entry || !entry.title) return;
    const tokens = new Set(
      deriveLocaleTokens({
        iso639: entry.iso_639_1,
        iso3166: entry.iso_3166_1,
        fallbackLanguage: options.originalLanguage,
      })
    );
    if (tokens.size === 0) return;
    registerCandidate(tokens, {
      title: entry.title,
      source: 'alternative',
      meta: {
        type: entry.type || null,
        iso639: entry.iso_639_1?.toLowerCase() || null,
        iso3166: entry.iso_3166_1?.toLowerCase() || null,
      },
    });
  });

  const localized = {};
  candidateMap.forEach((candidates, localeToken) => {
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreLocalizedCandidate(candidate, {
          defaultNormalized,
          originalNormalized,
          originalLanguage: normalizedOriginalLanguage,
          originCountries: normalizedOriginCountries,
        }),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.candidate;
    if (best) {
      localized[localeToken] = {
        title: best.title,
        overview: best.overview,
        tagline: best.tagline,
        source: best.source,
        type: best.meta?.type || null,
      };
    }
  });

  return localized;
}

async function fetchTmdbAlternativeTitles({ apiKey, type, tmdbId }) {
  if (!apiKey || !type || !tmdbId) return [];
  const endpoint = type === 'series' ? `tv/${tmdbId}/alternative_titles` : `movie/${tmdbId}/alternative_titles`;
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/${endpoint}`, {
      params: { api_key: apiKey },
      timeout: 5000,
    });
    const payload = response.data || {};
    const entries = Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.titles)
        ? payload.titles
        : [];
    return entries
      .map((entry) => ({
        iso_3166_1: entry?.iso_3166_1 || null,
        title: entry?.title || entry?.name || null,
        type: entry?.type || null,
        iso_639_1: entry?.iso_639_1 || null,
      }))
      .filter((entry) => entry.iso_3166_1 && entry.title);
  } catch (error) {
    const status = error?.response?.status;
    if (status && status < 500) {
      return [];
    }
    console.warn('[TMDB] Alternative titles request failed', error?.message || error);
    return [];
  }
}

async function loadTmdbLocalization({ apiKey, type, tmdbId }) {
  const metadata = await fetchTmdbMetadata({ apiKey, type, tmdbId });
  if (!metadata) {
    return null;
  }
  const translations = await fetchTmdbTranslations({ apiKey, type, tmdbId });
  const alternativeTitles = await fetchTmdbAlternativeTitles({ apiKey, type, tmdbId });
  const localizedTitles = buildLocalizedTitles(translations, alternativeTitles, {
    originalLanguage: metadata.original_language,
    defaultTitle: metadata.title || metadata.name || null,
    originalTitle: metadata.original_title || metadata.original_name || null,
    originCountries: Array.isArray(metadata.origin_country) ? metadata.origin_country : [],
  });
  const normalized = {
    originalLanguage: (metadata.original_language || '').toLowerCase() || null,
    defaultTitle: metadata.title || metadata.name || null,
    releaseDate: metadata.release_date || metadata.first_air_date || null,
    originalTitle: metadata.original_title || metadata.original_name || null,
    originCountries: Array.isArray(metadata.origin_country) ? metadata.origin_country.slice() : [],
    localizedTitles,
  };
  return normalized;
}

module.exports = {
  loadTmdbLocalization,
  fetchTmdbMetadata,
  fetchTmdbTranslations,
  buildLocalizedTitles,
  fetchTmdbAlternativeTitles,
  findTmdbIdByImdb,
  searchTmdbByTitle,
  resolveTmdbId,
};
