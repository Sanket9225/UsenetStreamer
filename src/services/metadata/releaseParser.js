const parseTorrentTitle = require('parse-torrent-title');

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
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '540p',
  '480p',
  '360p',
  '240p'
];

const RESOLUTION_PATTERNS = [
  { label: '4320p', regex: /(4320p|8k)/i },
  { label: '2160p', regex: /(2160p|4k|uhd)/i },
  { label: '1440p', regex: /1440p/i },
  { label: '1080p', regex: /1080p|fullhd|fhd/i },
  { label: '720p', regex: /720p|hd/i },
  { label: '576p', regex: /576p/i },
  { label: '540p', regex: /540p/i },
  { label: '480p', regex: /480p|sd/i },
  { label: '360p', regex: /360p/i },
  { label: '240p', regex: /240p/i }
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

function detectLanguages(title) {
  const normalizedTitle = (title || '').toLowerCase();
  if (!normalizedTitle) return [];
  const matches = new Set();
  for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(normalizedTitle))) {
      matches.add(language);
    }
  }
  return Array.from(matches);
}

function detectResolution(rawTitle, parsed) {
  if (parsed?.resolution) {
    const normalized = normalizeResolutionLabel(parsed.resolution);
    if (normalized) return normalized;
  }
  const title = rawTitle || '';
  for (const entry of RESOLUTION_PATTERNS) {
    if (entry.regex.test(title)) {
      return entry.label;
    }
  }
  if (parsed?.quality) {
    const normalized = normalizeResolutionLabel(parsed.quality);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeResolutionLabel(label) {
  if (label === undefined || label === null) return null;
  const value = label.toString().toLowerCase();
  if (!value) return null;
  if (value.includes('4320') || value.includes('8k')) return '4320p';
  if (value.includes('2160') || value.includes('4k') || value.includes('uhd')) return '2160p';
  if (value.includes('1440')) return '1440p';
  if (value.includes('1080')) return '1080p';
  if (value.includes('720')) return '720p';
  if (value.includes('576')) return '576p';
  if (value.includes('540')) return '540p';
  if (value.includes('480')) return '480p';
  if (value.includes('360')) return '360p';
  if (value.includes('240')) return '240p';
  return null;
}

function parseReleaseMetadata(title) {
  const rawTitle = typeof title === 'string' ? title : '';
  const parsed = (() => {
    try {
      return parseTorrentTitle(rawTitle) || {};
    } catch (error) {
      return {};
    }
  })();
  const resolution = detectResolution(rawTitle, parsed);
  const languages = detectLanguages(rawTitle);
  const qualityLabel = parsed.quality || parsed.source || parsed.codec || null;
  const qualityScore = QUALITY_SCORE_MAP[resolution] || 0;

  return {
    resolution,
    languages,
    qualityLabel,
    qualityScore,
  };
}

module.exports = {
  LANGUAGE_FILTERS,
  LANGUAGE_SYNONYMS,
  parseReleaseMetadata,
};
