const { parseTorrentTitle } = require('../../utils/lib/parse-torrent-title/index.js');

const LANGUAGE_FILTERS = [
  'English',
  'Tamil',
  'Hindi',
  'Malayalam',
  'Kannada',
  'Telugu',
  'Chinese',
  'Russian',
  'Arabic',
  'Japanese',
  'Korean',
  'Taiwanese',
  'Latino',
  'French',
  'Spanish',
  'Portuguese',
  'Italian',
  'German',
  'Ukrainian',
  'Polish',
  'Czech',
  'Thai',
  'Indonesian',
  'Vietnamese',
  'Dutch',
  'Bengali',
  'Turkish',
  'Greek',
  'Swedish',
  'Romanian',
  'Hungarian',
  'Finnish',
  'Norwegian',
  'Danish',
  'Hebrew',
  'Lithuanian',
  'Punjabi',
  'Marathi',
  'Gujarati',
  'Bhojpuri',
  'Nepali',
  'Urdu',
  'Tagalog',
  'Filipino',
  'Malay',
  'Mongolian',
  'Armenian',
  'Georgian'
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
  Mongolian: ['mongolian'],
  Armenian: ['armenian'],
  Georgian: ['georgian']
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
 * @property {string} [region]
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
  const resolution = parsed.resolution || null;
  const qualityScore = QUALITY_SCORE_MAP[resolution] || 0;

  // Map library fields to internal schema
  return {
    // title: parsed.title || null, // Parsed title (stripped of metadata)
    resolution,
    languages: Array.isArray(parsed.languages) ? parsed.languages : [],
    qualityLabel: parsed.quality || parsed.source || parsed.codec || null,
    qualityScore,
    codec: parsed.codec || null,
    source: parsed.source || null,
    group: parsed.group || null,
    season: Array.isArray(parsed.seasons) ? parsed.seasons[0] || null : null,
    episode: Array.isArray(parsed.episodes) ? parsed.episodes[0] || null : null,
    year: parsed.year ? parseInt(parsed.year, 10) || null : null,
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
    region: parsed.region || null,
  };
}

module.exports = {
  LANGUAGE_FILTERS,
  LANGUAGE_SYNONYMS,
  parseReleaseMetadata,
};
