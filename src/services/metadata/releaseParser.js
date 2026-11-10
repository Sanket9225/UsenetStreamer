const { parseTorrentTitle } = require('../../utils/lib/parse-torrent-title/index.js');
const { normalizeResolutionToken } = require('../../utils/parsers');
const { classifyRelease } = require('./releaseClassifier');

const QUALITY_FEATURE_PATTERNS = [
  { label: 'DV', regex: /\b(dolby\s*vision|dolbyvision|dv)\b/i },
  { label: 'HDR10+', regex: /hdr10\+/i },
  { label: 'HDR10', regex: /hdr10(?!\+)/i },
  { label: 'HDR', regex: /\bhdr\b/i },
  { label: 'SDR', regex: /\bsdr\b/i },
  // AI-upscaled / AI-enhanced releases (Topaz Video AI, etc.) — common scene
  // markers include "AI", "AI Enhanced", "AI Upscale", "Topaz".
  { label: 'AI', regex: /\b(ai[-_. ](?:upscal|enhanc|remaster)|ai\s*enhanc|topaz(?:[-_. ]?(?:video[-_. ]?ai|vai))?)/i },
];

// Meta-language values aren't actual languages — they describe a property of
// the release (e.g. has multiple audio tracks, audio is dubbed, audio matches
// the title's original language). Listed alongside real languages so users
// can include/exclude/prefer them in the same UI list. Mirrors the common
// aggregator preferred-languages vocabulary.
const META_LANGUAGES = [
  'Original',     // detected at request time: release audio matches title's original_language
  'Multi',        // 3+ audio tracks
  'Dual Audio',   // exactly 2 audio tracks
  'Dubbed',       // parser flagged release as dubbed
  'Unknown',      // parser produced no languages
];

const LANGUAGE_FILTERS = [
  'English',
  // South Asian
  'Tamil',
  'Hindi',
  'Malayalam',
  'Kannada',
  'Telugu',
  'Bengali',
  'Punjabi',
  'Marathi',
  'Gujarati',
  'Bhojpuri',
  'Nepali',
  'Urdu',
  'Sinhala',
  // East Asian
  'Chinese',
  'Japanese',
  'Korean',
  'Taiwanese',
  'Mongolian',
  // Southeast Asian
  'Thai',
  'Indonesian',
  'Vietnamese',
  'Tagalog',
  'Filipino',
  'Malay',
  'Khmer',
  'Lao',
  'Burmese',
  // Middle East / Central Asia
  'Arabic',
  'Hebrew',
  'Persian',
  'Pashto',
  'Turkish',
  'Azerbaijani',
  'Kazakh',
  'Uzbek',
  'Armenian',
  'Georgian',
  // Eastern Europe / Slavic
  'Russian',
  'Ukrainian',
  'Polish',
  'Czech',
  'Slovak',
  'Slovenian',
  'Croatian',
  'Serbian',
  'Bulgarian',
  'Macedonian',
  'Belarusian',
  'Albanian',
  // Northern Europe / Baltic
  'Swedish',
  'Norwegian',
  'Danish',
  'Finnish',
  'Icelandic',
  'Estonian',
  'Latvian',
  'Lithuanian',
  // Central / Western Europe
  'German',
  'French',
  'Dutch',
  'Italian',
  'Hungarian',
  'Romanian',
  'Greek',
  'Welsh',
  'Irish',
  // Iberian + Latin America
  'Spanish',
  'Portuguese',
  'Latino',
  'Catalan',
  'Basque',
  'Galician',
  // Africa
  'Afrikaans',
  'Swahili',
  'Amharic',
  'Yoruba',
  'Zulu',
];

const LANGUAGE_SYNONYMS = {
  English: ['english', 'ingles', 'inglés', 'anglais', 'englisch', 'en subtitles', 'eng'],
  Tamil: ['tamil', 'tam'],
  Hindi: ['hindi', 'hind', 'hin', 'hindustani'],
  Malayalam: ['malayalam', 'mal'],
  Kannada: ['kannada', 'kan'],
  Telugu: ['telugu', 'tel'],
  Chinese: ['chinese', 'chs', 'chi', 'mandarin'],
  Russian: ['russian', 'rus', 'russk'],
  Arabic: ['arabic', 'ara', 'arab'],
  Japanese: ['japanese', 'jap', 'jpn'],
  Korean: ['korean', 'kor'],
  Taiwanese: ['taiwanese', 'taiwan'],
  Latino: ['latino', 'latin spanish', 'lat'],
  French: ['french', 'français', 'fra', 'fre', 'vostfr'],
  Spanish: ['spanish', 'español', 'esp', 'spa'],
  Portuguese: ['portuguese', 'portugues', 'por', 'ptbr', 'brazilian'],
  Italian: ['italian', 'italiano', 'ita'],
  German: ['german', 'deutsch', 'ger', 'deu'],
  Ukrainian: ['ukrainian', 'ukr'],
  Polish: ['polish', 'polski', 'pol'],
  Czech: ['czech', 'cesky', 'cz', 'cze', 'ces'],
  Thai: ['thai'],
  Indonesian: ['indonesian', 'indo', 'id'],
  Vietnamese: ['vietnamese', 'viet'],
  Dutch: ['dutch', 'nederlands', 'dut', 'nld'],
  Bengali: ['bengali', 'bangla'],
  Turkish: ['turkish', 'turk', 'trk', 'tur'],
  Greek: ['greek', 'ellinika'],
  Swedish: ['swedish', 'svenska', 'swe'],
  Romanian: ['romanian', 'romana'],
  Hungarian: ['hungarian', 'magyar', 'hun'],
  Finnish: ['finnish', 'suomi', 'fin'],
  Norwegian: ['norwegian', 'norsk', 'nor'],
  Danish: ['danish', 'dansk', 'dan'],
  Hebrew: ['hebrew', 'heb'],
  Lithuanian: ['lithuanian', 'lietuvos', 'lit'],
  Punjabi: ['punjabi', 'panjabi', 'pan'],
  Marathi: ['marathi', 'mar'],
  Gujarati: ['gujarati', 'guj'],
  Bhojpuri: ['bhojpuri'],
  Nepali: ['nepali', 'nep'],
  Urdu: ['urdu'],
  Tagalog: ['tagalog'],
  Filipino: ['filipino'],
  Malay: ['malay', 'bahasa melayu'],
  Mongolian: ['mongolian', 'mon'],
  Armenian: ['armenian', 'arm', 'hye'],
  Georgian: ['georgian', 'geo', 'kat'],
  // South Asian additions
  Sinhala: ['sinhala', 'sinhalese', 'sin'],
  // SE Asian additions
  Khmer: ['khmer', 'cambodian', 'khm'],
  Lao: ['lao', 'laotian'],
  Burmese: ['burmese', 'myanmar', 'mya', 'bur'],
  // Middle East / Central Asia additions
  Persian: ['persian', 'farsi', 'fas', 'per'],
  Pashto: ['pashto', 'pus', 'pash'],
  Azerbaijani: ['azerbaijani', 'azeri', 'aze'],
  Kazakh: ['kazakh', 'kaz'],
  Uzbek: ['uzbek', 'uzb'],
  // Slavic / Balkan additions
  Slovak: ['slovak', 'slovenský', 'slk', 'slo'],
  Slovenian: ['slovenian', 'slovene', 'slv'],
  Croatian: ['croatian', 'hrvatski', 'hrv'],
  Serbian: ['serbian', 'srpski', 'srp'],
  Bulgarian: ['bulgarian', 'bul'],
  Macedonian: ['macedonian', 'mkd'],
  Belarusian: ['belarusian', 'belarussian', 'bel'],
  Albanian: ['albanian', 'shqip', 'alb', 'sqi'],
  // Northern Europe / Baltic additions
  Icelandic: ['icelandic', 'islenska', 'isl', 'ice'],
  Estonian: ['estonian', 'eesti', 'est'],
  Latvian: ['latvian', 'latviešu', 'lav'],
  // Western Europe additions
  Welsh: ['welsh', 'cymraeg', 'cym', 'wel'],
  Irish: ['irish', 'gaeilge', 'gle'],
  // Iberian additions
  Catalan: ['catalan', 'català', 'cat'],
  Basque: ['basque', 'euskara', 'eus', 'baq'],
  Galician: ['galician', 'galego', 'glg'],
  // Africa additions
  Afrikaans: ['afrikaans', 'afr'],
  Swahili: ['swahili', 'kiswahili', 'swa'],
  Amharic: ['amharic', 'amh'],
  Yoruba: ['yoruba', 'yor'],
  Zulu: ['zulu', 'zul']
};

const LANGUAGE_PATTERNS = Object.fromEntries(
  LANGUAGE_FILTERS.map((language) => {
    const tokens = LANGUAGE_SYNONYMS[language] || [language];
    const patterns = tokens.map((token) => buildLanguagePattern(token));
    return [language, patterns];
  })
);

const RESOLUTION_PREFERENCES = [
  '8k',
  '4k',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '540p',
  '480p',
  '360p',
  '240p'
];



const QUALITY_SCORE_MAP = RESOLUTION_PREFERENCES.reduce((acc, label, index) => {
  acc[label] = RESOLUTION_PREFERENCES.length - index;
  return acc;
}, {});

function buildLanguagePattern(token) {
  if (token instanceof RegExp) return token;
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return /$a/; // never matches
  }
  if (normalized.includes(' ')) {
    return new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

/**
 * @typedef {Object} ParsedResult
 * @property {string[]} [audio]
 * @property {string} [bitDepth]
 * @property {string} [codec]
 * @property {boolean} [complete]
 * @property {string} [container]
 * @property {string} [date]
 * @property {boolean} [documentary]
 * @property {boolean} [dubbed]
 * @property {number[]} [episodes]
 * @property {boolean} [extended]
 * @property {string} [group]
 * @property {string[]} [hdr]
 * @property {boolean} [hardcoded]
 * @property {string[]} [languages]
 * @property {boolean} [proper]
 * @property {string} [quality] - e.g. "WEBRip"
 * @property {boolean} [remastered]
 * @property {boolean} [repack]
 * @property {string} [resolution] - e.g. "1080p"
 * @property {boolean} [retail]
 * @property {number[]} [seasons]
 * @property {string} [size]
 * @property {string} [title]
 * @property {string} [year]
 * @property {boolean} [remux]
 * @property {boolean} [unrated]
 * @property {string} [source]
 * @property {boolean} [upscaled]
 * @property {boolean} [convert]
 * @property {boolean} [upscaled]
 * @property {boolean} [convert]
 * @property {boolean} [documentary]
 * @property {boolean} [dubbed]
 * @property {boolean} [subbed]
 * @property {string} [edition]
 * @property {string[]} [releaseTypes]
 * @property {string} [region]
 * @property {string} [threeD]
 * @property {string[]} [visualTags]
 */

/**
 * Parses release title using @viren070/parse-torrent-title
 * @param {string} title
 * @returns {import('../../utils/helpers').AnnotatedMetadata}
 */
function parseReleaseMetadata(title) {
  const rawTitle = typeof title === 'string' ? title : '';

  /** @type {ParsedResult} */
  const parsed = (() => {
    try {
      return parseTorrentTitle(rawTitle) || {};
    } catch (error) {
      return {};
    }
  })();

  // Trust the library output directly
  const resolution = normalizeResolutionToken(parsed.resolution) || parsed.resolution || null;
  const qualityScore = QUALITY_SCORE_MAP[String(resolution || '').toLowerCase()] || 0;
  const parsedTitle = parsed.title || null;
  const parsedYear = parsed.year ? parseInt(parsed.year, 10) || null : null;
  const parsedSeason = Array.isArray(parsed.seasons) ? parsed.seasons[0] || null : null;
  const parsedEpisode = Array.isArray(parsed.episodes) ? parsed.episodes[0] || null : null;
  let parsedTitleDisplay = parsedTitle;
  if (parsedTitle) {
    if (Number.isFinite(parsedSeason) && Number.isFinite(parsedEpisode)) {
      parsedTitleDisplay = `${parsedTitle} S${String(parsedSeason).padStart(2, '0')}E${String(parsedEpisode).padStart(2, '0')}`;
    } else if (Number.isFinite(parsedYear)) {
      parsedTitleDisplay = `${parsedTitle} ${parsedYear}`;
    }
  }

  // The parse-torrent-title library emits "multi audio" / "multi subs" as
  // markers in the languages array (they mean "multiple tracks", not a real
  // language). Strip them so they don't (a) pollute the exposed languages list
  // or (b) inflate the meta-language count below. We track the marker
  // separately as `hasMultiMarker`.
  const rawLanguages = Array.isArray(parsed.languages) ? parsed.languages : [];
  const realLanguages = rawLanguages.filter((lang) => !/\bmulti\b/i.test(String(lang)));
  const hasMultiMarker = /\bmulti\b/i.test(rawTitle)
    || rawLanguages.some((lang) => /\bmulti\b/i.test(String(lang)));

  // Derive meta-language tokens from the parsed output. These describe the
  // release's audio shape (not a specific language) and are exposed alongside
  // real languages so users can include/exclude them in the same preferred
  // list. `Original` is NOT derivable here — it depends on the title's
  // original-production language and is added at request annotation time
  // when TMDb context is available.
  const inferredLanguages = [];
  if (hasMultiMarker) {
    // A MULTI marker means multiple audio tracks — definitively "Multi", and
    // never "Unknown" (we know it's multi-language even if names weren't parsed).
    inferredLanguages.push('Multi');
  } else if (realLanguages.length === 0) {
    inferredLanguages.push('Unknown');
  } else if (realLanguages.length === 2) {
    inferredLanguages.push('Dual Audio');
  } else if (realLanguages.length >= 3) {
    inferredLanguages.push('Multi');
  }
  if (parsed.dubbed) {
    inferredLanguages.push('Dubbed');
  }

  // Canonical classification for the derived sort/filter fields. We use the
  // title parser (@viren070/parse-torrent-title) for title/season/episode
  // above, then the regex table in releaseClassifier.js for quality / encode /
  // visualTags / audioTags / audioChannels so these values match the import
  // schema vocabulary (OPTION_VOCAB) exactly.
  const classified = classifyRelease(rawTitle, parsed.title);

  // Map library fields to internal schema
  return {
    parsedTitle, // Parsed title (stripped of metadata)
    parsedTitleDisplay,
    resolution,
    languages: realLanguages,
    inferredLanguages,
    // Canonical quality tier (BluRay REMUX / WEB-DL / TS / TC / …). Any "remux"
    // — even standalone — folds into "BluRay REMUX"; there is no bare REMUX
    // tier. Strictly the canonical tier (or null → "Unknown"); we deliberately
    // do NOT fall back to the raw codec, which would leak labels like "divx".
    qualityLabel: classified.quality || null,
    // Encode tier (HEVC / AVC / AV1 / XviD / DivX). Distinct from `codec` below,
    // which keeps the raw codec string from the title parser for display/keywords.
    encode: classified.encode || null,
    qualityScore,
    codec: parsed.codec || null,
    source: parsed.source || null,
    group: parsed.group || null,
    season: parsedSeason,
    episode: parsedEpisode,
    year: parsedYear,
    date: parsed.date || null,
    complete: parsed.complete || false,
    proper: parsed.proper || false,
    repack: parsed.repack || false,
    container: parsed.container || null,
    audio: Array.isArray(parsed.audio) ? parsed.audio[0] : null,
    audioList: Array.isArray(parsed.audio) ? parsed.audio : [],
    extended: parsed.extended || false,
    hardcoded: parsed.hardcoded || false,
    hdr: Array.isArray(parsed.hdr) && parsed.hdr.length > 0,
    hdrList: Array.isArray(parsed.hdr) ? parsed.hdr : [],
    remastered: parsed.remastered || false,
    unrated: parsed.unrated || false,
    remux: parsed.remux || false,
    retail: parsed.retail || false,
    upscaled: parsed.upscaled || false,
    convert: parsed.convert || false,
    documentary: parsed.documentary || false,
    dubbed: parsed.dubbed || false,
    subbed: parsed.subbed || false,
    edition: parsed.edition || null,
    releaseTypes: Array.isArray(parsed.releaseTypes) ? parsed.releaseTypes : [],
    region: parsed.region || null,
    threeD: parsed.threeD || null,
    bitDepth: parsed.bitDepth || null,
    // Canonical visualTags (incl. derived HDR+DV / DV Only / HDR Only),
    // audioTags, and audioChannels — see releaseClassifier.js. These replace the
    // previous bespoke pattern lists so values match the import schema vocabulary.
    visualTags: classified.visualTags,
    audioTags: classified.audioTags,
    audioChannels: classified.audioChannels,
    // Bitrate is intentionally NOT parsed from the title. It is derived later
    // from file size + TMDb runtime in annotateNzbResult (see helpers.js).
  };
}

module.exports = {
  LANGUAGE_FILTERS,
  LANGUAGE_SYNONYMS,
  META_LANGUAGES,
  QUALITY_FEATURE_PATTERNS,
  parseReleaseMetadata,
};
