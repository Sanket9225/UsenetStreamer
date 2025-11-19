const path = require('path');
const { LANGUAGE_FILTERS, LANGUAGE_SYNONYMS } = require('../services/metadata/releaseParser');

const SORT_MODE_OPTIONS = new Set(['quality_then_size', 'language_quality_size']);

const LANGUAGE_PREFERENCE_ALIASES = {
  en: 'English', 'en-us': 'English', 'en-gb': 'English', 'en-au': 'English',
  ta: 'Tamil', hi: 'Hindi', 'hi-in': 'Hindi', ml: 'Malayalam', kn: 'Kannada',
  te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', bn: 'Bengali',
  ne: 'Nepali', ur: 'Urdu', tl: 'Tagalog', fil: 'Filipino', ms: 'Malay',
  zh: 'Chinese', 'zh-cn': 'Chinese', 'zh-hans': 'Chinese', 'zh-hant': 'Taiwanese',
  'zh-tw': 'Taiwanese', ja: 'Japanese', ko: 'Korean', de: 'German', 'de-de': 'German',
  fr: 'French', it: 'Italian', es: 'Spanish', 'es-es': 'Spanish', 'es-419': 'Latino',
  'es-mx': 'Latino', 'es-ar': 'Latino', pt: 'Portuguese', 'pt-br': 'Portuguese',
  'pt-pt': 'Portuguese', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', cs: 'Czech',
  tr: 'Turkish', el: 'Greek', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian',
  nb: 'Norwegian', nn: 'Norwegian', da: 'Danish', fi: 'Finnish', ro: 'Romanian',
  hu: 'Hungarian', th: 'Thai', id: 'Indonesian', vi: 'Vietnamese', ar: 'Arabic',
  he: 'Hebrew', iw: 'Hebrew', lt: 'Lithuanian', mn: 'Mongolian', hy: 'Armenian',
  ka: 'Georgian', 'la': 'Latino',
};

const LANGUAGE_ALIAS_MAP = (() => {
  const map = new Map();
  LANGUAGE_FILTERS.forEach((language) => {
    if (!language) return;
    map.set(language.toLowerCase(), language);
  });
  if (LANGUAGE_SYNONYMS) {
    Object.entries(LANGUAGE_SYNONYMS).forEach(([language, tokens]) => {
      if (!language || !Array.isArray(tokens)) return;
      tokens.forEach((token) => {
        if (!token) return;
        map.set(token.toLowerCase(), language);
      });
    });
  }
  Object.entries(LANGUAGE_PREFERENCE_ALIASES).forEach(([alias, language]) => {
    if (!language) return;
    map.set(alias.toLowerCase(), language);
  });
  return map;
})();

function decodeBase64Value(value) {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch (error) {
    console.warn('[SPECIAL META] Failed to decode base64 value');
    return '';
  }
}

function stripTrailingSlashes(value) {
  if (!value) return '';
  let result = value;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

function toFiniteNumber(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function toPositiveInt(value, defaultValue) {
  const parsed = toFiniteNumber(value, undefined);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseCommaList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePathList(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => (path.isAbsolute(segment) ? segment : path.resolve(process.cwd(), segment)));
}

function normalizeSortMode(value, fallback = 'quality_then_size') {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (SORT_MODE_OPTIONS.has(normalized)) {
      return normalized;
    }
  }
  return fallback;
}

function resolvePreferredLanguage(value, fallback = '') {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  const direct = LANGUAGE_ALIAS_MAP.get(normalized);
  if (direct) return direct;
  if (normalized.includes('-')) {
    const short = normalized.split('-')[0];
    const shortMatch = LANGUAGE_ALIAS_MAP.get(short);
    if (shortMatch) return shortMatch;
  }
  return fallback;
}

function toSizeBytesFromGb(value) {
  const numeric = toFiniteNumber(value, null);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric * 1024 * 1024 * 1024;
}

function collectConfigValues(keys) {
  const values = {};
  keys.forEach((key) => {
    values[key] = process.env[key] ?? '';
  });
  return values;
}

function computeManifestUrl() {
  const baseUrl = (process.env.ADDON_BASE_URL || '').trim();
  const secret = (process.env.ADDON_SHARED_SECRET || '').trim();
  if (!baseUrl) return '';
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const tokenSegment = secret ? `/${secret}` : '';
  return `${normalizedBase}${tokenSegment}/manifest.json`;
}

module.exports = {
  decodeBase64Value,
  stripTrailingSlashes,
  toFiniteNumber,
  toPositiveInt,
  toBoolean,
  parseCommaList,
  parsePathList,
  normalizeSortMode,
  resolvePreferredLanguage,
  toSizeBytesFromGb,
  collectConfigValues,
  computeManifestUrl,
};
