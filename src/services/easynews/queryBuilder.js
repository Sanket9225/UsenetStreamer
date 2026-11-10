const { foldAccents, cleanSearchTitle } = require('../../utils/stringUtils');

function appendEpisodeSuffix(title, { type, releaseYear, seasonNum, episodeNum, dailyAirDate }) {
  if (!title) return '';
  if (type === 'movie' && Number.isFinite(releaseYear)) return `${title} ${releaseYear}`;
  if (type === 'series') {
    if (dailyAirDate?.airDateDotted) {
      return `${title} ${dailyAirDate.airDateDotted}`;
    }
    if (Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
      return `${title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
    }
  }
  return title;
}

function isValidAsciiQuery(str) {
  if (!str || /[^\x00-\x7F]/.test(str)) return false;
  if (/^s\d{2}e\d{2}$/i.test(str) || /^\d{4}$/.test(str)) return false;
  return str.replace(/[^a-zA-Z]/g, '').length >= 2;
}

/**
 * Builds the list of EasyNews search queries to run for a stream request.
 * Returns a params object (queries array + shared params) or null if no valid queries.
 *
 * Query priority:
 *   1. All TMDb title variants — English first, then regional/additional
 *   2. All anime title variants (for anime requests)
 *   3. Text fallback (ASCII-normalized primary title + year/episode)
 */
function buildEasynewsSearchParams({
  type,
  releaseYear,
  seasonNum,
  episodeNum,
  tmdbTitles,
  isAnimeRequest,
  animeSearchableTitles,
  textQueryFallbackValue,
  movieTitle,
  baseIdentifier,
  isSpecialRequest,
  specialMetadataTitle,
  requestLacksIdentifiers,
  strictMode,
  normalizeToAscii,
  originalLanguage,
  dailyAirDate,
}) {
  const seenKeys = new Set();
  const queries = [];
  const suffixCtx = { type, releaseYear, seasonNum, episodeNum, dailyAirDate };

  // originalTitle is the pre-normalization source used for the retained-ratio check.
  // When rawTitle is already asciiTitle (pre-normalized), pass the raw original separately
  // so we compare the ASCII result against the original character count, not itself.
  const tryAdd = (rawTitle, alreadyHasSuffix = false, originalTitle = null, lang = null) => {
    if (!rawTitle) return;
    // Fold accents first (Café→Cafe, Über→Ueber) so the query matches the ASCII
    // form release names use, then ASCII-normalize for anything left.
    let normalized = normalizeToAscii(foldAccents(rawTitle.trim()));
    if (!normalized) return;
    // Skip if ASCII normalization destroyed too much of the original title
    // (e.g. CJK → sparse ASCII). Measured BEFORE punctuation cleaning so the
    // strip below can't trip the ratio.
    const original = (originalTitle || rawTitle).replace(/\s+/g, '');
    if (original.length > 0 && normalized.length / original.length < 0.8) return;
    // Strip punctuation the indexer can't match: "&"→language word (und/en/et/…
    // per the title's language, matching the newznab path), apostrophes dropped
    // ("Director's"→"Directors"), slashes/commas/parens/colons/dots → space
    // ("A/B"→"A B"). Without this a literal title returns 0 hits.
    normalized = cleanSearchTitle(normalized, lang);
    if (!normalized) return;
    const withSuffix = alreadyHasSuffix
      ? normalized.trim()
      : appendEpisodeSuffix(normalized, suffixCtx).trim();
    if (!isValidAsciiQuery(withSuffix)) return;
    const key = withSuffix.toLowerCase();
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    queries.push(withSuffix);
  };

  if (isSpecialRequest) {
    tryAdd(specialMetadataTitle, true, null, originalLanguage);
    tryAdd(movieTitle, false, null, originalLanguage);
    tryAdd(textQueryFallbackValue, true, null, originalLanguage);
  } else {
    // TMDb title variants: English first, then all regional/additional. Each
    // variant carries its own language so "&" transliterates correctly per
    // variant (e.g. a Dutch title → "en", German → "und").
    if (tmdbTitles?.length > 0) {
      const sorted = [...tmdbTitles].sort((a, b) =>
        (a.language?.startsWith('en') ? 0 : 1) - (b.language?.startsWith('en') ? 0 : 1)
      );
      for (const t of sorted) {
        // Pass t.title as originalTitle so ratio is computed against the raw original,
        // not the pre-normalized asciiTitle
        tryAdd(t.asciiTitle || t.title, false, t.title, t.language);
      }
    }

    // Anime: all searchable title variants
    if (isAnimeRequest && animeSearchableTitles?.length > 0) {
      for (const t of animeSearchableTitles) {
        tryAdd(t.asciiTitle, false, t.title || t.asciiTitle, t.language);
      }
    }

    // Text fallback (already has year/episode suffix)
    tryAdd(textQueryFallbackValue, true, null, originalLanguage);

    // Title-only fallback when nothing else resolved
    if (queries.length === 0) tryAdd(movieTitle, false, null, originalLanguage);
  }

  // Last resort
  if (queries.length === 0 && baseIdentifier) {
    queries.push(baseIdentifier);
  }

  if (queries.length === 0) return null;

  return {
    queries,
    fallbackQuery: textQueryFallbackValue || baseIdentifier || movieTitle || '',
    year: Number.isFinite(releaseYear) ? releaseYear : null,
    season: type === 'series' ? seasonNum : null,
    episode: type === 'series' ? episodeNum : null,
    airDate: dailyAirDate?.airDate || null,
    alternateAirDates: dailyAirDate?.alternateAirDates || [],
    strictMode: Boolean(strictMode),
    specialTextOnly: Boolean(isSpecialRequest || requestLacksIdentifiers),
  };
}

module.exports = { buildEasynewsSearchParams };
