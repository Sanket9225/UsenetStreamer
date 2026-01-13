// TMDb service - Localized title fetching for improved search
const externalApi = require('../utils/externalApi');
const https = require('https');

// Disable keep-alive to force fresh connections and avoid stale-socket ECONNRESET
const tmdbHttpsAgent = new https.Agent({ keepAlive: false });

// Retry configuration for transient network errors
const TMDB_RETRY_COUNT = 2;
const TMDB_RETRY_DELAY_MS = 500;
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN']);

// Configuration (reloaded from process.env)
let TMDB_API_KEY = '';
let TMDB_SEARCH_LANGUAGES = []; // Array of additional locale codes like ['hi-IN', 'ta-IN']
let TMDB_SEARCH_MODE = 'regional_only'; // 'regional_only' | 'english_and_regional'

// In-memory cache for TMDb responses
const tmdbCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 1000;

// Language code mapping from display names to TMDb locale codes
const LANGUAGE_TO_TMDB_LOCALE = {
  'English': 'en-US',
  'Tamil': 'ta-IN',
  'Hindi': 'hi-IN',
  'Malayalam': 'ml-IN',
  'Kannada': 'kn-IN',
  'Telugu': 'te-IN',
  'Chinese': 'zh-CN',
  'Russian': 'ru-RU',
  'Arabic': 'ar-SA',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'Taiwanese': 'zh-TW',
  'French': 'fr-FR',
  'Spanish': 'es-ES',
  'Portuguese': 'pt-BR',
  'Italian': 'it-IT',
  'German': 'de-DE',
  'Ukrainian': 'uk-UA',
  'Polish': 'pl-PL',
  'Czech': 'cs-CZ',
  'Thai': 'th-TH',
  'Indonesian': 'id-ID',
  'Vietnamese': 'vi-VN',
  'Dutch': 'nl-NL',
  'Bengali': 'bn-IN',
  'Turkish': 'tr-TR',
  'Greek': 'el-GR',
  'Swedish': 'sv-SE',
  'Romanian': 'ro-RO',
  'Hungarian': 'hu-HU',
  'Finnish': 'fi-FI',
  'Norwegian': 'no-NO',
  'Danish': 'da-DK',
  'Hebrew': 'he-IL',
  'Lithuanian': 'lt-LT',
  'Punjabi': 'pa-IN',
  'Marathi': 'mr-IN',
  'Gujarati': 'gu-IN',
  'Nepali': 'ne-NP',
  'Urdu': 'ur-PK',
  'Tagalog': 'tl-PH',
  'Filipino': 'fil-PH',
  'Malay': 'ms-MY',
  'Mongolian': 'mn-MN',
  'Armenian': 'hy-AM',
  'Georgian': 'ka-GE',
};

function reloadConfig() {
  TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
  const languagesStr = (process.env.TMDB_SEARCH_LANGUAGES || '').trim();
  TMDB_SEARCH_LANGUAGES = languagesStr ? languagesStr.split(',').map(l => l.trim()).filter(Boolean) : [];
  TMDB_SEARCH_MODE = (process.env.TMDB_SEARCH_MODE || 'regional_only').trim();
  
  console.log('[TMDB] Config reloaded', { 
    hasApiKey: Boolean(TMDB_API_KEY), 
    additionalLanguages: TMDB_SEARCH_LANGUAGES,
    searchMode: TMDB_SEARCH_MODE,
  });
}

reloadConfig();

function isConfigured() {
  return Boolean(TMDB_API_KEY);
}

function getConfig() {
  return {
    apiKey: TMDB_API_KEY,
    additionalLanguages: TMDB_SEARCH_LANGUAGES,
    searchMode: TMDB_SEARCH_MODE,
  };
}

/**
 * Convert a display language name to TMDb locale code
 */
function languageNameToLocale(languageName) {
  if (!languageName) return null;
  return LANGUAGE_TO_TMDB_LOCALE[languageName] || null;
}

/**
 * Normalize text to ASCII (strip diacritics)
 */
function normalizeToAscii(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
}

/**
 * Get cache key for TMDb lookups
 */
function getCacheKey(type, id, language) {
  return `${type}:${id}:${language || 'default'}`;
}

/**
 * Get cached TMDb response
 */
function getFromCache(key) {
  const entry = tmdbCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    tmdbCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store TMDb response in cache
 */
function setInCache(key, data) {
  // Evict oldest entries if cache is full
  if (tmdbCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tmdbCache.keys().next().value;
    tmdbCache.delete(oldestKey);
  }
  tmdbCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Make authenticated TMDb API request with linear retry for transient errors
 */
async function tmdbRequest(endpoint, params = {}) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDb API key not configured');
  }

  const url = `https://api.themoviedb.org/3${endpoint}`;
  let lastError = null;

  for (let attempt = 0; attempt <= TMDB_RETRY_COUNT; attempt++) {
    try {
      const response = await externalApi.get(url, {
        service: 'tmdb',
        params,
        headers: {
          'Authorization': `Bearer ${TMDB_API_KEY}`,
          'Accept': 'application/json',
        },
        timeout: 8000,
        httpsAgent: tmdbHttpsAgent,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 401) {
        throw new Error('TMDb API: Invalid API key');
      }
      if (response.status === 404) {
        return null;
      }
      if (response.status >= 400) {
        throw new Error(`TMDb API error: ${response.status}`);
      }

      return response.data;
    } catch (error) {
      lastError = error;
      const code = error?.code || '';
      const isRetryable = RETRYABLE_CODES.has(code) || /ECONNRESET|ETIMEDOUT|socket hang up/i.test(error?.message || '');
      if (!isRetryable || attempt >= TMDB_RETRY_COUNT) {
        throw error;
      }
      // Linear delay before retry
      await new Promise((resolve) => setTimeout(resolve, TMDB_RETRY_DELAY_MS));
    }
  }

  throw lastError || new Error('TMDb request failed after retries');
}

/**
 * Find TMDb ID and basic info from external ID (IMDb)
 */
async function findByExternalId(externalId, externalSource = 'imdb_id') {
  const cacheKey = getCacheKey('find', externalId, null);
  const cached = getFromCache(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const data = await tmdbRequest(`/find/${externalId}`, {
      external_source: externalSource,
    });

    if (!data) {
      setInCache(cacheKey, null);
      return null;
    }

    // Check movie_results first, then tv_results
    const movieResult = data.movie_results?.[0];
    const tvResult = data.tv_results?.[0];
    const result = movieResult || tvResult;

    if (!result) {
      setInCache(cacheKey, null);
      return null;
    }

    const parsed = {
      tmdbId: result.id,
      mediaType: movieResult ? 'movie' : 'tv',
      title: result.title || result.name,
      originalTitle: result.original_title || result.original_name,
      originalLanguage: result.original_language,
      releaseYear: (result.release_date || result.first_air_date || '').substring(0, 4),
    };

    setInCache(cacheKey, parsed);
    return parsed;
  } catch (error) {
    console.error(`[TMDB] findByExternalId error for ${externalId}:`, error.message);
    return null;
  }
}

/**
 * Get movie/TV details with translations
 */
async function getDetails(tmdbId, mediaType, language) {
  const cacheKey = getCacheKey('details', `${mediaType}/${tmdbId}`, language);
  const cached = getFromCache(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const endpoint = mediaType === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const data = await tmdbRequest(endpoint, {
      language: language || 'en-US',
      append_to_response: 'alternative_titles,translations',
    });

    if (!data) {
      setInCache(cacheKey, null);
      return null;
    }

    const result = {
      tmdbId: data.id,
      title: data.title || data.name,
      originalTitle: data.original_title || data.original_name,
      originalLanguage: data.original_language,
      alternativeTitles: [],
      translations: [],
    };

    // Extract alternative titles
    const altTitles = data.alternative_titles?.titles || data.alternative_titles?.results || [];
    result.alternativeTitles = altTitles.map((t) => ({
      title: t.title || t.name,
      iso_3166_1: t.iso_3166_1,
      type: t.type,
    }));

    // Extract translations
    const translations = data.translations?.translations || [];
    result.translations = translations.map((t) => ({
      iso_639_1: t.iso_639_1,
      iso_3166_1: t.iso_3166_1,
      name: t.name,
      title: t.data?.title || t.data?.name,
    })).filter((t) => t.title);

    setInCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`[TMDB] getDetails error for ${mediaType}/${tmdbId}:`, error.message);
    return null;
  }
}

/**
 * Get multiple localized titles for search from TMDb
 * @param {object} options
 * @param {string} options.imdbId - IMDb ID
 * @param {string} options.type - 'movie' or 'series'
 * @returns {Promise<object>} - { tmdbId, mediaType, originalTitle, titles: [{language, title, year}], year }
 */
async function getMetadataAndTitles({ imdbId, type }) {
  if (!isConfigured()) {
    return null;
  }

  if (!imdbId) {
    console.log('[TMDB] No IMDb ID provided for metadata fetch');
    return null;
  }

  console.log(`[TMDB] Fetching metadata and titles for ${imdbId}`);

  // Step 1: Find TMDb ID from IMDb ID
  const findResult = await findByExternalId(imdbId, 'imdb_id');
  if (!findResult) {
    console.log(`[TMDB] No TMDb match found for ${imdbId}`);
    return null;
  }

  const { tmdbId, mediaType, originalTitle, originalLanguage, releaseYear } = findResult;
  console.log(`[TMDB] Found TMDb ID ${tmdbId} (${mediaType}), original: "${originalTitle}" [${originalLanguage}], year: ${releaseYear}`);

  const titles = [];
  const seenTitles = new Set();

  // Language map for 2-letter to locale conversion
  const langMap = {
    'en': 'en-US', 'sv': 'sv-SE', 'de': 'de-DE', 'fr': 'fr-FR', 'es': 'es-ES',
    'pt': 'pt-BR', 'it': 'it-IT', 'ja': 'ja-JP', 'ko': 'ko-KR', 'zh': 'zh-CN',
    'hi': 'hi-IN', 'ta': 'ta-IN', 'te': 'te-IN', 'ml': 'ml-IN', 'kn': 'kn-IN',
    'ru': 'ru-RU', 'ar': 'ar-SA', 'th': 'th-TH', 'vi': 'vi-VN', 'id': 'id-ID',
    'tr': 'tr-TR', 'pl': 'pl-PL', 'nl': 'nl-NL', 'no': 'no-NO', 'da': 'da-DK',
    'fi': 'fi-FI', 'bn': 'bn-IN', 'mr': 'mr-IN', 'gu': 'gu-IN', 'pa': 'pa-IN',
    'uk': 'uk-UA', 'he': 'he-IL', 'fa': 'fa-IR', 'cs': 'cs-CZ', 'sk': 'sk-SK',
    'hu': 'hu-HU', 'ro': 'ro-RO', 'bg': 'bg-BG', 'el': 'el-GR', 'ms': 'ms-MY',
    'tl': 'tl-PH', 'ur': 'ur-PK', 'sr': 'sr-RS', 'hr': 'hr-HR', 'sl': 'sl-SI',
    'lt': 'lt-LT', 'lv': 'lv-LV', 'et': 'et-EE', 'ka': 'ka-GE', 'hy': 'hy-AM',
    'az': 'az-AZ', 'kk': 'kk-KZ', 'mn': 'mn-MN', 'ne': 'ne-NP', 'si': 'si-LK',
    'my': 'my-MM', 'km': 'km-KH', 'lo': 'lo-LA', 'af': 'af-ZA', 'sw': 'sw-KE',
    'am': 'am-ET', 'fil': 'fil-PH',
  };

  // Step 1: Always fetch original language title (auto-detect)
  const originalLocale = langMap[originalLanguage] || `${originalLanguage}-${originalLanguage.toUpperCase()}`;
  console.log(`[TMDB] Auto-detect: fetching original language [${originalLanguage}] as ${originalLocale}`);
  
  // Step 2: Determine all languages to fetch
  const languagesToFetch = [originalLocale];
  
  // Add English if search mode requires it and original isn't English
  if (TMDB_SEARCH_MODE === 'english_and_regional' && originalLanguage !== 'en') {
    languagesToFetch.push('en-US');
  }
  
  // Add additional selected languages
  if (TMDB_SEARCH_LANGUAGES.length > 0) {
    languagesToFetch.push(...TMDB_SEARCH_LANGUAGES);
  }
  
  console.log(`[TMDB] Fetching ${languagesToFetch.length} language(s) in parallel:`, languagesToFetch);
  
  // Step 3: Fetch all languages in parallel
  const fetchPromises = languagesToFetch.map(async (language) => {
    try {
      const details = await getDetails(tmdbId, mediaType, language);
      if (details?.title) {
        const normalizedTitle = details.title.trim();
        if (normalizedTitle) {
          return {
            language,
            title: normalizedTitle,
            asciiTitle: normalizeToAscii(normalizedTitle),
          };
        }
      }
    } catch (error) {
      console.error(`[TMDB] Error fetching title in ${language}:`, error.message);
    }
    return null;
  });
  
  const fetchedTitles = await Promise.all(fetchPromises);
  
  // Step 4: Add unique titles to result
  fetchedTitles.forEach((titleObj) => {
    if (titleObj && !seenTitles.has(titleObj.title.toLowerCase())) {
      seenTitles.add(titleObj.title.toLowerCase());
      titles.push(titleObj);
      console.log(`[TMDB] ${titleObj.language} title: "${titleObj.title}"`);
    }
  });

  // Step 5: Always include original title if different from fetched one
  if (originalTitle && !seenTitles.has(originalTitle.toLowerCase())) {
    seenTitles.add(originalTitle.toLowerCase());
    titles.push({
      language: originalLanguage,
      title: originalTitle,
      asciiTitle: normalizeToAscii(originalTitle),
    });
    console.log(`[TMDB] Added original title: "${originalTitle}"`);
  }

  return {
    tmdbId,
    mediaType,
    originalTitle,
    originalLanguage,
    year: releaseYear,
    titles,
  };
}

/**
 * Get the best localized title for search (LEGACY - kept for compatibility)
 * @param {object} options
 * @param {string} options.imdbId - IMDb ID
 * @param {string} options.type - 'movie' or 'series'
 * @param {string} options.englishTitle - Title from Cinemeta (English)
 * @param {string[]} options.preferredLanguages - User's preferred languages (display names)
 * @returns {Promise<object>} - { localizedTitle, asciiTitle, originalTitle, language, tmdbId }
 */
async function getLocalizedTitle({ imdbId, type, englishTitle, preferredLanguages = [] }) {
  if (!isConfigured()) {
    return null;
  }

  if (!imdbId) {
    console.log('[TMDB] No IMDb ID provided, skipping localization');
    return null;
  }

  console.log(`[TMDB] Looking up localized title for ${imdbId}`);

  // Step 1: Find TMDb ID from IMDb ID
  const findResult = await findByExternalId(imdbId, 'imdb_id');
  if (!findResult) {
    console.log(`[TMDB] No TMDb match found for ${imdbId}`);
    return null;
  }

  const { tmdbId, mediaType, originalTitle, originalLanguage } = findResult;
  console.log(`[TMDB] Found TMDb ID ${tmdbId} (${mediaType}), original: "${originalTitle}" [${originalLanguage}]`);

  // Step 2: Determine target language
  let targetLanguage = null;
  const mode = TMDB_SEARCH_LANGUAGE_MODE;

  if (mode === 'specific' && TMDB_SEARCH_LANGUAGE) {
    targetLanguage = TMDB_SEARCH_LANGUAGE;
  } else if (mode === 'preferred' && preferredLanguages.length > 0) {
    // Convert first preferred language to TMDb locale
    targetLanguage = languageNameToLocale(preferredLanguages[0]);
  } else if (mode === 'auto') {
    // Use content's original language
    // Map 2-letter code to full locale (best effort)
    if (originalLanguage) {
      // Try common mappings
      const langMap = {
        'en': 'en-US',
        'sv': 'sv-SE',
        'de': 'de-DE',
        'fr': 'fr-FR',
        'es': 'es-ES',
        'pt': 'pt-BR',
        'it': 'it-IT',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'zh': 'zh-CN',
        'hi': 'hi-IN',
        'ta': 'ta-IN',
        'te': 'te-IN',
        'ml': 'ml-IN',
        'ru': 'ru-RU',
        'ar': 'ar-SA',
        'th': 'th-TH',
        'vi': 'vi-VN',
        'id': 'id-ID',
        'tr': 'tr-TR',
        'pl': 'pl-PL',
        'nl': 'nl-NL',
        'no': 'no-NO',
        'da': 'da-DK',
        'fi': 'fi-FI',
      };
      targetLanguage = langMap[originalLanguage] || `${originalLanguage}-${originalLanguage.toUpperCase()}`;
    }
  }

  console.log(`[TMDB] Target language: ${targetLanguage || 'none'} (mode: ${mode})`);

  // Step 3: Get details with translations
  const details = await getDetails(tmdbId, mediaType, targetLanguage);
  if (!details) {
    console.log(`[TMDB] Could not fetch details for ${tmdbId}`);
    return null;
  }

  // Step 4: Find the best title
  let localizedTitle = null;

  // First, check if the fetched title differs from English
  if (details.title && details.title !== englishTitle) {
    localizedTitle = details.title;
  }

  // If still no localized title, check original title
  if (!localizedTitle && originalTitle && originalTitle !== englishTitle) {
    localizedTitle = originalTitle;
  }

  // If still nothing different, check translations
  if (!localizedTitle && targetLanguage && details.translations.length > 0) {
    const langCode = targetLanguage.split('-')[0];
    const translation = details.translations.find(
      (t) => t.iso_639_1 === langCode || `${t.iso_639_1}-${t.iso_3166_1}` === targetLanguage
    );
    if (translation?.title && translation.title !== englishTitle) {
      localizedTitle = translation.title;
    }
  }

  if (!localizedTitle) {
    console.log(`[TMDB] No different localized title found for ${imdbId}`);
    return null;
  }

  // Step 5: Generate ASCII fallback
  const asciiTitle = normalizeToAscii(localizedTitle);
  const hasNonAscii = asciiTitle !== localizedTitle && asciiTitle.length > 0;

  console.log(`[TMDB] Localized title: "${localizedTitle}"${hasNonAscii ? ` (ASCII: "${asciiTitle}")` : ''}`);

  return {
    localizedTitle,
    asciiTitle: hasNonAscii ? asciiTitle : null,
    originalTitle,
    language: targetLanguage,
    tmdbId,
  };
}

/**
 * Clear the TMDb cache
 */
function clearCache() {
  tmdbCache.clear();
  console.log('[TMDB] Cache cleared');
}

module.exports = {
  reloadConfig,
  isConfigured,
  getConfig,
  findByExternalId,
  getDetails,
  getMetadataAndTitles,
  getLocalizedTitle,
  normalizeToAscii,
  languageNameToLocale,
  clearCache,
};
