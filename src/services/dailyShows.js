// Daily & Late-Night TV Shows service
// Translates Stremio SxxExx queries to air-date strings (YYYY.MM.DD) for daily/late-night TV shows
// that are indexed on Usenet by air date rather than standard season/episode numbers.
const axios = require('axios');

let DAILY_SHOWS_ENABLED = true;
let DAILY_SHOWS_AUTO_DETECT = true;
let DAILY_SHOWS_CUSTOM_IDS = '';
let customIdSet = new Set();

const DAILY_GENRES = new Set([
  'talk-show',
  'talk show',
  'news',
  'soap',
  'game-show',
  'game show',
]);

const WELL_KNOWN_DAILY_SHOW_PATTERNS = [
  /\bdaily\s*show\b/i,
  /\btonight\s*show\b/i,
  /\blate\s*show\b/i,
  /\blate\s*night\b/i,
  /\bjimmy\s*kimmel\b/i,
  /\bseth\s*meyers\b/i,
  /\bstephen\s*colbert\b/i,
  /\blast\s*week\s*tonight\b/i,
  /\bbill\s*maher\b/i,
  /\bgood\s*morning\s*america\b/i,
  /\btoday\s*show\b/i,
  /\bwwe\s*(?:monday\s*night\s*)?raw\b/i,
  /\bwwe\s*smackdown\b/i,
];

function reloadConfig() {
  const enabledRaw = (process.env.DAILY_SHOWS_ENABLED ?? 'true').toString().trim().toLowerCase();
  DAILY_SHOWS_ENABLED = !['false', '0', 'off', 'no'].includes(enabledRaw);

  const autoDetectRaw = (process.env.DAILY_SHOWS_AUTO_DETECT ?? 'true').toString().trim().toLowerCase();
  DAILY_SHOWS_AUTO_DETECT = !['false', '0', 'off', 'no'].includes(autoDetectRaw);

  DAILY_SHOWS_CUSTOM_IDS = (process.env.DAILY_SHOWS_CUSTOM_IDS || '').trim();

  customIdSet = new Set(
    DAILY_SHOWS_CUSTOM_IDS
      .split(/[,\s;\n]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
  );

  console.log('[DAILY SHOWS] Config reloaded', {
    enabled: DAILY_SHOWS_ENABLED,
    autoDetect: DAILY_SHOWS_AUTO_DETECT,
    customIdsCount: customIdSet.size,
  });
}

reloadConfig();

function isEnabled() {
  return DAILY_SHOWS_ENABLED;
}

function getConfig() {
  return {
    enabled: DAILY_SHOWS_ENABLED,
    autoDetect: DAILY_SHOWS_AUTO_DETECT,
    customIds: DAILY_SHOWS_CUSTOM_IDS,
  };
}

/**
 * Check if a series is identified as a daily / late-night show.
 */
function isDailyShow({ imdbId, tvdbId, tmdbId, cinemetaMeta, title } = {}) {
  if (!DAILY_SHOWS_ENABLED) return false;

  // 1. Check custom IDs list
  const candidates = [
    imdbId ? String(imdbId).toLowerCase() : null,
    tvdbId ? String(tvdbId).toLowerCase() : null,
    tmdbId ? String(tmdbId).toLowerCase() : null,
    title ? String(title).toLowerCase() : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (customIdSet.has(candidate)) {
      return true;
    }
  }

  if (!DAILY_SHOWS_AUTO_DETECT) return false;

  // 2. Check title keywords
  const titleToCheck = title || cinemetaMeta?.name || cinemetaMeta?.title || '';
  if (titleToCheck && WELL_KNOWN_DAILY_SHOW_PATTERNS.some((pattern) => pattern.test(titleToCheck))) {
    return true;
  }

  // 3. Check genres from Cinemeta payload
  const rawGenres = [];
  if (Array.isArray(cinemetaMeta?.genres)) {
    rawGenres.push(...cinemetaMeta.genres);
  }
  if (cinemetaMeta?.genre) {
    if (Array.isArray(cinemetaMeta.genre)) {
      rawGenres.push(...cinemetaMeta.genre);
    } else {
      rawGenres.push(cinemetaMeta.genre);
    }
  }

  for (const g of rawGenres) {
    if (typeof g === 'string' && DAILY_GENRES.has(g.trim().toLowerCase())) {
      return true;
    }
  }

  // 4. High episode count in a single season (> 35 episodes) is typical for daily shows
  if (Array.isArray(cinemetaMeta?.videos) && cinemetaMeta.videos.length > 0) {
    const countsBySeason = new Map();
    for (const v of cinemetaMeta.videos) {
      const s = Number(v.season);
      if (Number.isFinite(s)) {
        countsBySeason.set(s, (countsBySeason.get(s) || 0) + 1);
        if (countsBySeason.get(s) > 35) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Format a Date or date string (YYYY-MM-DD) into structured air-date tokens.
 */
function formatAirDate(rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') return null;

  const match = rawDateStr.match(/^(\d{4})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])/);
  if (!match) return null;

  const year = match[1];
  const month = match[2];
  const day = match[3];

  const airDate = `${year}-${month}-${day}`;
  const airDateDotted = `${year}.${month}.${day}`;
  const airDateHyphenated = `${year}-${month}-${day}`;
  const airDateSpaced = `${year} ${month} ${day}`;
  const airDateCompact = `${year}${month}${day}`;

  const alternateAirDates = [];

  // Check if timestamp contains hour/minute that suggests an adjacent calendar day due to timezone
  if (rawDateStr.includes('T')) {
    try {
      const d = new Date(rawDateStr);
      if (!Number.isNaN(d.getTime())) {
        const hoursUtc = d.getUTCHours();
        // If hour in UTC is early morning (< 12:00 UTC), local US air date may be previous day
        if (hoursUtc < 12) {
          const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000);
          const pYear = String(prev.getUTCFullYear());
          const pMonth = String(prev.getUTCMonth() + 1).padStart(2, '0');
          const pDay = String(prev.getUTCDate()).padStart(2, '0');
          const pDate = `${pYear}-${pMonth}-${pDay}`;
          if (pDate !== airDate) {
            alternateAirDates.push({
              airDate: pDate,
              airDateDotted: `${pYear}.${pMonth}.${pDay}`,
              airDateHyphenated: pDate,
              airDateSpaced: `${pYear} ${pMonth} ${pDay}`,
            });
          }
        }
      }
    } catch (_) {
      // Ignore date calculation errors
    }
  }

  return {
    year,
    month,
    day,
    airDate,
    airDateDotted,
    airDateHyphenated,
    airDateSpaced,
    airDateCompact,
    alternateAirDates,
  };
}

/**
 * Resolve the exact air-date for a given series season and episode.
 * Primary source: Cinemeta videos payload (free, no API key).
 * Secondary source: TMDb episode endpoint (if configured).
 * Tertiary source: TVDB episode endpoint (if configured).
 */
async function resolveAirDate({
  seasonNum,
  episodeNum,
  cinemetaMeta = null,
  imdbId = null,
  tvdbId = null,
  tmdbId = null,
  tmdbService = null,
  tvdbService = null,
} = {}) {
  if (!Number.isFinite(Number(seasonNum)) || !Number.isFinite(Number(episodeNum))) {
    return null;
  }

  const s = Number(seasonNum);
  const e = Number(episodeNum);

  // 1. Try Cinemeta videos
  if (Array.isArray(cinemetaMeta?.videos)) {
    const video = cinemetaMeta.videos.find((v) => {
      const vSeason = Number(v.season);
      const vEp = Number(v.episode ?? v.number);
      return vSeason === s && vEp === e;
    });

    const rawDate = video?.released || video?.firstAired || null;
    if (rawDate) {
      const parsed = formatAirDate(rawDate);
      if (parsed) {
        console.log(`[DAILY SHOWS] Resolved air date from Cinemeta for S${s}E${e}: ${parsed.airDateDotted}`);
        return parsed;
      }
    }
  }

  // 2. Try TMDb if available
  if (tmdbService && typeof tmdbService.getEpisodeAirDate === 'function' && tmdbId) {
    try {
      const tmdbAirDate = await tmdbService.getEpisodeAirDate(tmdbId, s, e);
      if (tmdbAirDate) {
        const parsed = formatAirDate(tmdbAirDate);
        if (parsed) {
          console.log(`[DAILY SHOWS] Resolved air date from TMDb for S${s}E${e}: ${parsed.airDateDotted}`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[DAILY SHOWS] TMDb air date lookup failed: ${err.message}`);
    }
  }

  // 3. Try TVDB if available
  if (tvdbService && typeof tvdbService.getEpisodeAirDateForSeries === 'function' && tvdbId) {
    try {
      const tvdbAirDate = await tvdbService.getEpisodeAirDateForSeries(tvdbId, s, e);
      if (tvdbAirDate) {
        const parsed = formatAirDate(tvdbAirDate);
        if (parsed) {
          console.log(`[DAILY SHOWS] Resolved air date from TVDB for S${s}E${e}: ${parsed.airDateDotted}`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[DAILY SHOWS] TVDB air date lookup failed: ${err.message}`);
    }
  }

  console.log(`[DAILY SHOWS] Could not resolve air date for S${s}E${e}`);
  return null;
}

/**
 * Check if a release title or parsed date matches the target air date.
 */
function matchesDailyAirDate(annotatedOrTitle, airDateInfo) {
  if (!annotatedOrTitle || !airDateInfo) return false;

  const targetDates = [
    airDateInfo.airDate,
    ...(airDateInfo.alternateAirDates || []).map((alt) => alt.airDate),
  ];

  // 1. Check parsed release date
  const parsedDate = typeof annotatedOrTitle === 'object' ? annotatedOrTitle.date : null;
  if (parsedDate && targetDates.includes(parsedDate)) {
    return true;
  }

  // 2. Check title / string inclusion
  const rawTitle = (typeof annotatedOrTitle === 'string'
    ? annotatedOrTitle
    : annotatedOrTitle.title || annotatedOrTitle.Title || annotatedOrTitle.parsedTitle || ''
  ).toLowerCase();

  const patterns = [
    airDateInfo.airDateDotted.toLowerCase(),
    airDateInfo.airDateHyphenated.toLowerCase(),
    airDateInfo.airDateSpaced.toLowerCase(),
    airDateInfo.airDateCompact.toLowerCase(),
  ];

  for (const alt of (airDateInfo.alternateAirDates || [])) {
    if (alt?.airDateDotted) patterns.push(alt.airDateDotted.toLowerCase());
    if (alt?.airDateHyphenated) patterns.push(alt.airDateHyphenated.toLowerCase());
    if (alt?.airDateSpaced) patterns.push(alt.airDateSpaced.toLowerCase());
    if (alt?.airDate) patterns.push(alt.airDate.toLowerCase());
  }

  return patterns.some((p) => rawTitle.includes(p));
}

module.exports = {
  reloadConfig,
  isEnabled,
  getConfig,
  isDailyShow,
  formatAirDate,
  resolveAirDate,
  matchesDailyAirDate,
};
