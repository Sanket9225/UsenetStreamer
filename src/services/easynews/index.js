const axios = require('axios');
const { parseTorrentTitle } = require('../../utils/lib/parse-torrent-title/index.js');
const { stripTrailingSlashes, toBoolean } = require('../../utils/config');

const EASYNEWS_BASE_URL = 'https://members.easynews.com';
const DEFAULT_TIMEOUT_MS = 15000;
const EASYNEWS_SEARCH_STANDALONE_TIMEOUT_MS = 7000;
const EASYNEWS_NZB_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_MIN_SIZE_MB = 100;
const MAX_RESULTS_PER_PAGE = 250;
const TOKEN_SPLIT_REGEX = /[^\w]+/gu;
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'for', 'on']);
const QUALITY_REGEX = /(4320|2160|1440|1080|720|576|540|480|360)\s*(p|i)?/i;
const UHD_REGEX = /\b(uhd|4k|8k)\b/i;
const YEAR_REGEX = /(19|20)\d{2}/;
const SEASON_EP_REGEX = /(?:s(?<season>\d{1,2})e(?<episode>\d{1,2})|(?<season2>\d{1,2})x(?<episode2>\d{1,2}))/i;
const DISALLOWED_EXTENSIONS = new Set(['.rar', '.zip', '.exe', '.jpg', '.png']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.ts', '.mov', '.wmv', '.mpg', '.mpeg', '.flv', '.webm']);
const EASYNEWS_INDEXER_ID = 'easynews';
const EASYNEWS_INDEXER_NAME = 'Easynews';

const httpClient = axios.create({
  baseURL: EASYNEWS_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  validateStatus: (status) => status >= 200 && status < 500,
});

let EASYNEWS_ENABLED = false;
let EASYNEWS_USERNAME = '';
let EASYNEWS_PASSWORD = '';
let EASYNEWS_MIN_SIZE_BYTES = DEFAULT_MIN_SIZE_MB * 1024 * 1024;
let EASYNEWS_DOWNLOAD_BASE = '';
let EASYNEWS_SHARED_SECRET = '';
let EASYNEWS_SAFE_TEXT_MODE = false;

function resolveDownloadBase(rawBase) {
  const trimmed = stripTrailingSlashes(rawBase || '');
  if (trimmed) return trimmed;
  const fallbackPort = Number(process.env.PORT) || 7000;
  return `http://127.0.0.1:${fallbackPort}`;
}

function reloadConfig({ addonBaseUrl, sharedSecret } = {}) {
  EASYNEWS_ENABLED = toBoolean(process.env.EASYNEWS_ENABLED, false);
  EASYNEWS_USERNAME = (process.env.EASYNEWS_USERNAME || '').trim();
  EASYNEWS_PASSWORD = (process.env.EASYNEWS_PASSWORD || '').trim();
  const minSizeMb = Number(process.env.EASYNEWS_MIN_SIZE_MB);
  if (Number.isFinite(minSizeMb) && minSizeMb >= 20) {
    EASYNEWS_MIN_SIZE_BYTES = minSizeMb * 1024 * 1024;
  } else {
    EASYNEWS_MIN_SIZE_BYTES = DEFAULT_MIN_SIZE_MB * 1024 * 1024;
  }
  EASYNEWS_DOWNLOAD_BASE = resolveDownloadBase(addonBaseUrl);
  EASYNEWS_SHARED_SECRET = sharedSecret || '';
  EASYNEWS_SAFE_TEXT_MODE = toBoolean(process.env.EASYNEWS_TEXT_MODE_ONLY, false);
}

function isEasynewsEnabled() {
  return EASYNEWS_ENABLED && Boolean(EASYNEWS_USERNAME && EASYNEWS_PASSWORD);
}

function requiresCinemetaMetadata(isSpecialRequest) {
  if (!isEasynewsEnabled()) return false;
  return !isSpecialRequest;
}

function buildAuthConfig(override = null) {
  const username = (override?.username || EASYNEWS_USERNAME || '').trim();
  const password = (override?.password || EASYNEWS_PASSWORD || '').trim();
  if (!username || !password) {
    throw new Error('Easynews credentials are not configured');
  }
  return {
    auth: {
      username,
      password,
    },
    headers: {
      'User-Agent': 'UsenetStreamer-Easynews/1.0'
    }
  };
}

function sanitizePhrase(text) {
  if (!text) return '';
  const working = text
    .replace(/&/g, ' and ')
    .replace(/[\.\-_:\s]+/g, ' ')
    .replace(/[^\w\sÀ-ÿ]/g, '')
    .toLowerCase()
    .trim();
  return working;
}

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT_REGEX)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function matchesStrict(title, strictPhrase) {
  if (!strictPhrase) return true;
  const candidate = sanitizePhrase(title);
  if (!candidate) return false;
  if (candidate === strictPhrase) return true;
  const candidateTokens = candidate.split(' ');
  const phraseTokens = strictPhrase.split(' ');
  if (!phraseTokens.length) return true;
  // Nothing before first query token, nothing after last query token, gaps allowed in between
  if (candidateTokens[0] !== phraseTokens[0]) return false;
  if (candidateTokens[candidateTokens.length - 1] !== phraseTokens[phraseTokens.length - 1]) return false;
  let candidateIdx = 1;
  for (let i = 1; i < phraseTokens.length; i += 1) {
    const token = phraseTokens[i];
    let found = false;
    while (candidateIdx < candidateTokens.length) {
      if (candidateTokens[candidateIdx] === token) {
        found = true;
        candidateIdx += 1;
        break;
      }
      candidateIdx += 1;
    }
    if (!found) return false;
  }
  return true;
}

function parseDurationSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const text = String(raw).toLowerCase().trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let matched = false;
  const durationRegex = /(\d+)\s*([hms])/gi;
  let match = durationRegex.exec(text);
  while (match) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === 'h') total += value * 3600;
    else if (unit === 'm') total += value * 60;
    else if (unit === 's') total += value;
    match = durationRegex.exec(text);
  }
  if (matched && total > 0) return total;
  if (text.includes(':')) {
    const parts = text.split(':').map((part) => Number(part));
    if (parts.every((part) => Number.isFinite(part))) {
      if (parts.length === 3) {
        const [h, m, s] = parts;
        return (h * 3600) + (m * 60) + s;
      }
      if (parts.length === 2) {
        const [m, s] = parts;
        return (m * 60) + s;
      }
    }
  }
  return null;
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * (value > 1e12 ? 1 : 1000));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      const asNumber = Number(text);
      return new Date(asNumber * (text.length > 10 ? 1 : 1000));
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

function extractQuality(text) {
  if (!text) return null;
  const normalized = text.toLowerCase();

  // Prefer 4k/8k keys
  if (normalized.includes('8k') || normalized.includes('4320p')) return '8k';
  if (normalized.includes('4k') || normalized.includes('2160p') || normalized.includes('uhd')) return '4k';

  const match = QUALITY_REGEX.exec(normalized);
  if (match) {
    const value = match[1];
    const suffix = match[2] || 'p';
    const resolution = `${value}${suffix.toLowerCase()}`;

    // Normalize numeric to new keys
    if (resolution === '2160p') return '4k';
    if (resolution === '4320p') return '8k';

    return resolution;
  }
  return null;
}

function extractReleaseMarkers(text, qualityHint) {
  const info = {};
  if (!text) return info;
  const season = SEASON_EP_REGEX.exec(text);
  if (season) {
    const seasonValue = season.groups?.season || season.groups?.season2;
    const episodeValue = season.groups?.episode || season.groups?.episode2;
    if (seasonValue) info.season = Number(seasonValue);
    if (episodeValue) info.episode = Number(episodeValue);
  }
  const yearMatch = YEAR_REGEX.exec(text);
  if (yearMatch) {
    info.year = Number(yearMatch[0]);
  }
  const quality = qualityHint || extractQuality(text);
  if (quality) info.quality = quality;
  return info;
}

function isFlaggedItem(raw, ext, durationSeconds) {
  const extension = (ext || '').toLowerCase();
  if (DISALLOWED_EXTENSIONS.has(extension)) return true;
  if (extension && !ALLOWED_VIDEO_EXTENSIONS.has(extension)) return true;
  if (durationSeconds !== null && durationSeconds < 60) return true;
  const flagged = Boolean(raw?.passwd || raw?.password || raw?.virus);
  if (flagged) return true;
  const type = (raw?.type || raw?.file_type || '').toUpperCase();
  if (type && type !== 'VIDEO') return true;
  return false;
}

function buildTitle({ displayFn, filenameNoExt, ext, subject }) {
  if (displayFn) {
    const cleaned = displayFn.trim();
    if (cleaned) {
      const normalized = cleaned.replace(/ - /g, '-');
      const parts = normalized.split(' ').filter(Boolean);
      const sanitized = parts.join('.');
      const extComponent = ext || '';
      if (extComponent) {
        return `${sanitized}${extComponent.startsWith('.') ? extComponent : `.${extComponent}`}`;
      }
      return sanitized;
    }
  }
  const fallback = subject || `${filenameNoExt || ''}${ext || ''}`;
  return fallback || 'Untitled';
}

function tokenizeTitle(title) {
  if (!title) return new Set();
  const tokens = tokenize(title);
  return new Set(tokens);
}

function buildThumbnailUrl(base, hashId, slug) {
  if (!base || !hashId) return null;
  const trimmed = stripTrailingSlashes(base);
  const prefix = hashId.slice(0, 3);
  const safeSlug = encodeURIComponent((slug || hashId).replace(/\//g, '_'));
  return `${trimmed}/${prefix}/pr-${hashId}.jpg/th-${safeSlug}.jpg`;
}

function encodePayload(payload) {
  const json = JSON.stringify(payload);
  const base = Buffer.from(json, 'utf8').toString('base64');
  return base.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodePayload(token) {
  if (!token) return null;
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

function buildValueToken({ hash, filename, ext }) {
  const fnB64 = Buffer.from(filename || '', 'utf8').toString('base64').replace(/=+$/g, '');
  const extB64 = Buffer.from(ext || '', 'utf8').toString('base64').replace(/=+$/g, '');
  return `${hash}|${fnB64}:${extB64}`;
}

function buildNzbPayload(items, name) {
  const entries = [['autoNZB', '1']];
  items.forEach((item, idx) => {
    const key = item.sig ? `${idx}&sig=${item.sig}` : String(idx);
    entries.push([key, buildValueToken(item)]);
  });
  if (name) {
    entries.push(['nameZipQ0', name]);
  }
  return entries;
}

function buildDownloadUrl(token) {
  const secretSegment = EASYNEWS_SHARED_SECRET ? `/${encodeURIComponent(EASYNEWS_SHARED_SECRET)}` : '';
  return `${EASYNEWS_DOWNLOAD_BASE}${secretSegment}/easynews/nzb?payload=${encodeURIComponent(token)}`;
}

function filterAndMap(jsonData, options) {
  const {
    minBytes,
    queryTokens,
    queryMeta,
    strictPhrase,
    strictMatch,
    skipSamples = true,
  } = options;
  const debugEnabled = String(process.env.DEBUG_NEWZNAB_SEARCH || '').trim().toLowerCase() === 'true';
  const tokenSet = new Set((queryTokens || []).filter(Boolean));
  const thumbBase = jsonData?.thumbURL || jsonData?.thumbUrl || null;
  const items = [];
  const data = Array.isArray(jsonData?.data) ? jsonData.data : [];

  data.forEach((entry) => {
    let hashId;
    let subject;
    let filenameNoExt;
    let ext;
    let size = 0;
    let poster;
    let postedRaw;
    let sig;
    let displayFn;
    let extensionField;
    let durationRaw;
    let fullres;

    if (Array.isArray(entry)) {
      hashId = entry[0];
      subject = entry[6];
      filenameNoExt = entry[10];
      ext = entry[11];
      poster = entry[7];
      postedRaw = entry[8];
      durationRaw = entry[14];
    } else if (entry && typeof entry === 'object') {
      hashId = entry.hash || entry['0'] || entry.id;
      subject = entry.subject || entry['6'];
      filenameNoExt = entry.filename || entry['10'];
      ext = entry.ext || entry['11'];
      size = entry.size || entry.Length || entry.length || 0;
      poster = entry.poster || entry['7'];
      postedRaw = entry.dtime || entry.date || entry['12'];
      sig = entry.sig;
      displayFn = entry.fn || entry.filename;
      extensionField = entry.extension || entry.ext;
      durationRaw = entry['14'] || entry.duration || entry.len;
      fullres = entry.fullres || entry.resolution;
    }

    if (!hashId) return;
    const normalizedExt = extensionField || ext || '';
    const sizeValue = Number(size);
    if (!Number.isFinite(sizeValue) || sizeValue < minBytes) return;

    const durationSeconds = parseDurationSeconds(durationRaw);
    if (isFlaggedItem(entry, normalizedExt, durationSeconds)) return;

    const title = buildTitle({ displayFn, filenameNoExt, ext: normalizedExt, subject });
    const quality = extractQuality(title) || extractQuality(fullres);
    const titleMeta = extractReleaseMarkers(title, quality);
    if (skipSamples && /sample/i.test(title)) {
      return;
    }

    if (strictMatch && strictPhrase) {
      let parsedCandidateTitle = title;
      let parsedRelease = null;
      try {
        parsedRelease = parseTorrentTitle(title);
        if (parsedRelease?.title) parsedCandidateTitle = parsedRelease.title;
      } catch (_) { /* use raw title */ }

      const strictTitlePhrase = queryMeta?.title
        ? sanitizePhrase(queryMeta.title)
        : strictPhrase;

      if (!matchesStrict(parsedCandidateTitle, strictTitlePhrase)) {
        if (debugEnabled) {
          console.log('[EASYNEWS] Strict match failed', {
            title,
            parsedTitle: parsedCandidateTitle,
            query: strictTitlePhrase,
          });
        }
        return;
      }

      const parsedYear = parsedRelease?.year ? Number(parsedRelease.year) : null;
      const parsedSeason = Array.isArray(parsedRelease?.seasons) ? parsedRelease.seasons[0] : null;
      const parsedEpisode = Array.isArray(parsedRelease?.episodes) ? parsedRelease.episodes[0] : null;

      if (queryMeta?.year && parsedYear && queryMeta.year !== parsedYear) {
        if (debugEnabled) {
          console.log('[EASYNEWS] Strict match failed (year mismatch)', {
            title,
            parsedTitle: parsedCandidateTitle,
            year: parsedYear,
            expectedYear: queryMeta.year,
          });
        }
        return;
      }
      if (queryMeta?.season && parsedSeason && queryMeta.season !== parsedSeason) {
        if (debugEnabled) {
          console.log('[EASYNEWS] Strict match failed (season mismatch)', {
            title,
            parsedTitle: parsedCandidateTitle,
            season: parsedSeason,
            expectedSeason: queryMeta.season,
          });
        }
        return;
      }
      if (queryMeta?.episode && parsedEpisode && queryMeta.episode !== parsedEpisode) {
        if (debugEnabled) {
          console.log('[EASYNEWS] Strict match failed (episode mismatch)', {
            title,
            parsedTitle: parsedCandidateTitle,
            episode: parsedEpisode,
            expectedEpisode: queryMeta.episode,
          });
        }
        return;
      }

      if (debugEnabled) {
        console.log('[EASYNEWS] Strict match passed', {
          title,
          parsedTitle: parsedCandidateTitle,
          query: strictTitlePhrase,
        });
      }
    }

    if (queryMeta) {
      if (queryMeta.year && titleMeta.year && queryMeta.year !== titleMeta.year) return;
      if (queryMeta.season && titleMeta.season && queryMeta.season !== titleMeta.season) return;
      if (queryMeta.episode && titleMeta.episode && queryMeta.episode !== titleMeta.episode) return;
    }

    if (tokenSet.size > 0) {
      const titleTokens = tokenizeTitle(title);
      for (const token of tokenSet) {
        if (!titleTokens.has(token)) {
          return;
        }
      }
    }

    const posted = coerceDate(postedRaw) || new Date();
    const durationHms = durationSeconds ? new Date(durationSeconds * 1000).toISOString().substr(11, 8) : null;
    const thumbnail = buildThumbnailUrl(thumbBase, hashId, filenameNoExt);
    items.push({
      hash: hashId,
      filename: filenameNoExt || hashId,
      ext: normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`,
      sig,
      size: sizeValue,
      title,
      poster,
      posted,
      durationSeconds,
      durationHms,
      quality: quality || titleMeta.quality || null,
      thumbnail,
      year: titleMeta.year || null,
      season: titleMeta.season || null,
      episode: titleMeta.episode || null,
    });
  });

  return items;
}

async function fetchSearchResults(query, authOverride = null) {
  const params = new URLSearchParams();
  params.set('fly', '2');
  params.set('sb', '1');
  params.set('pno', '1');
  params.set('pby', String(MAX_RESULTS_PER_PAGE));
  params.set('u', '1');
  params.set('chxu', '1');
  params.set('chxgx', '1');
  params.set('st', 'basic');
  params.set('gps', query);
  params.set('vv', '1');
  params.set('safeO', '0');
  params.set('s1', 'relevance');
  params.set('s1d', '-');
  params.append('fty[]', 'VIDEO');

  const requestUrl = `/2.0/search/solr-search/?${params.toString()}`;
  const response = await httpClient.get(requestUrl, buildAuthConfig(authOverride));
  if (response.status === 401 || response.status === 403) {
    throw new Error('Easynews rejected credentials');
  }
  if (response.status >= 400) {
    throw new Error(`Easynews search failed with status ${response.status}`);
  }
  return response.data || {};
}

function buildQueryMeta({ rawQuery, year, season, episode }) {
  const markers = extractReleaseMarkers(rawQuery || '');
  if (year) markers.year = year;
  if (typeof season === 'number') markers.season = season;
  if (typeof episode === 'number') markers.episode = episode;
  try {
    const parsed = parseTorrentTitle(rawQuery || '');
    if (parsed?.title) markers.title = parsed.title;
  } catch (_) { /* ignore */ }
  return markers;
}

function buildResult(rawItem) {
  const payload = encodePayload({
    hash: rawItem.hash,
    filename: rawItem.filename,
    ext: rawItem.ext,
    sig: rawItem.sig,
    title: rawItem.title,
  });
  const downloadUrl = buildDownloadUrl(payload);
  const publishDateMs = rawItem.posted ? rawItem.posted.getTime() : Date.now();
  return {
    title: rawItem.title,
    downloadUrl,
    guid: `easynews-${rawItem.hash}`,
    indexer: EASYNEWS_INDEXER_NAME,
    indexerId: EASYNEWS_INDEXER_ID,
    size: rawItem.size,
    pubDate: rawItem.posted ? rawItem.posted.toISOString() : undefined,
    publishDateMs,
    ageDays: Math.round((Date.now() - publishDateMs) / (24 * 60 * 60 * 1000)),
    release: {
      resolution: rawItem.quality || null,
      languages: [],
    },
    poster: rawItem.poster,
    easynewsPayload: payload,
    _sourceType: 'easynews',
  };
}

async function searchEasynews(options = {}) {
  if (!isEasynewsEnabled()) {
    return [];
  }
  const {
    rawQuery,
    fallbackQuery,
    year,
    season,
    episode,
    strictMode = false,
    specialTextOnly = false,
  } = options;
  let query = (rawQuery || '').trim();
  if (!query) {
    query = (fallbackQuery || '').trim();
  }
  if (!query) {
    return [];
  }
  const strict = strictMode && !specialTextOnly && !EASYNEWS_SAFE_TEXT_MODE;
  const strictPhrase = strict ? sanitizePhrase(query) : '';
  const queryTokens = strict ? tokenize(query) : [];
  const queryMeta = strict ? buildQueryMeta({ rawQuery: query, year, season, episode }) : null;
  const minBytes = EASYNEWS_MIN_SIZE_BYTES;
  const data = await fetchSearchResults(query);
  const mapped = filterAndMap(data, {
    minBytes,
    queryTokens,
    queryMeta,
    strictPhrase,
    strictMatch: strict,
    skipSamples: true,
  });
  return mapped.map((item) => buildResult(item));
}

async function downloadEasynewsNzb(payloadToken) {
  if (!isEasynewsEnabled()) {
    throw new Error('Easynews integration is disabled');
  }
  const decoded = decodePayload(payloadToken);
  if (!decoded || !decoded.hash) {
    throw new Error('Invalid Easynews payload');
  }
  const nzbEntries = buildNzbPayload([
    {
      hash: decoded.hash,
      filename: decoded.filename,
      ext: decoded.ext,
      sig: decoded.sig,
    },
  ], decoded.title);
  const form = new URLSearchParams();
  nzbEntries.forEach(([key, value]) => form.append(key, value));
  const authConfig = buildAuthConfig();
  const mergedHeaders = {
    ...(authConfig.headers || {}),
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const response = await httpClient.post('/2.0/api/dl-nzb', form.toString(), {
    ...authConfig,
    headers: mergedHeaders,
    responseType: 'arraybuffer',
    timeout: EASYNEWS_NZB_DOWNLOAD_TIMEOUT_MS,
  });
  if (response.status !== 200) {
    throw new Error(`Easynews NZB download failed (${response.status})`);
  }
  const safeTitle = (decoded.title || `${decoded.filename || 'download'}${decoded.ext || '.nzb'}`)
    .replace(/[^a-z0-9\s._-]+/gi, '')
    .trim() || 'easynews';
  return {
    buffer: Buffer.from(response.data),
    fileName: `${safeTitle.endsWith('.nzb') ? safeTitle : `${safeTitle}.nzb`}`,
    contentType: response.headers['content-type'] || 'application/x-nzb+xml',
  };
}

async function testEasynewsCredentials({ username, password } = {}) {
  const trimmed = {
    username: (username || '').trim(),
    password: (password || '').trim(),
  };
  if (!trimmed.username || !trimmed.password) {
    throw new Error('Easynews username and password are required');
  }
  const sampleQuery = 'dune';
  const data = await fetchSearchResults(sampleQuery, trimmed);
  const total = Array.isArray(data?.data) ? data.data.length : Number(data?.total) || 0;
  if (total > 0) {
    return `Easynews login verified (sample query returned ${total} result${total === 1 ? '' : 's'})`;
  }
  return 'Easynews login verified, but sample query returned no results';
}

module.exports = {
  reloadConfig,
  isEasynewsEnabled,
  requiresCinemetaMetadata,
  searchEasynews,
  downloadEasynewsNzb,
  testEasynewsCredentials,
  EASYNEWS_SEARCH_STANDALONE_TIMEOUT_MS,
};
