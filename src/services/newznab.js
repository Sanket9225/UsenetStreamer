const axios = require('axios');
const { parseStringPromise: parseXmlString } = require('xml2js');
const { stripTrailingSlashes } = require('../utils/config');
const { getRandomUserAgent } = require('../utils/userAgent');

const MAX_NEWZNAB_INDEXERS = 20;
const NEWZNAB_FIELD_SUFFIXES = ['ENDPOINT', 'API_KEY', 'API_PATH', 'NAME', 'INDEXER_ENABLED', 'PAID', 'PAID_LIMIT', 'ZYCLOPS'];
const NEWZNAB_NUMBERED_KEYS = [];
for (let i = 1; i <= MAX_NEWZNAB_INDEXERS; i += 1) {
  const idx = String(i).padStart(2, '0');
  NEWZNAB_FIELD_SUFFIXES.forEach((suffix) => {
    NEWZNAB_NUMBERED_KEYS.push(`NEWZNAB_${suffix}_${idx}`);
  });
}

const XML_PARSE_OPTIONS = {
  explicitArray: false,
  explicitRoot: false,
  mergeAttrs: true,
  attrkey: '$',
  charkey: '_',
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEBUG_BODY_CHAR_LIMIT = 1200;
const NEWZNAB_TEST_LOG_PREFIX = '[NEWZNAB][TEST]';
const newznabCapsCache = new Map();
const BUILTIN_NEWZNAB_PRESETS = [
  {
    id: 'nzbgeek',
    label: 'NZBGeek (api.nzbgeek.info)',
    endpoint: 'https://api.nzbgeek.info',
    apiPath: '/api',
    description: 'Popular paid Newznab indexer. Requires membership and API key from your profile.',
    apiKeyUrl: 'https://nzbgeek.info/dashboard.php?myaccount'
  },
  {
    id: 'drunkenslug',
    label: 'DrunkenSlug (drunkenslug.com)',
    endpoint: 'https://drunkenslug.com',
    apiPath: '/api',
    description: 'Invite-only Newznab indexer. Paste your API key from the profile page.',
    apiKeyUrl: 'https://drunkenslug.com/profile'
  },
  {
    id: 'nzbplanet',
    label: 'NZBPlanet (nzbplanet.net)',
    endpoint: 'https://nzbplanet.net',
    apiPath: '/api',
    description: 'Long-running public/VIP indexer. VIP membership unlocks API usage.',
    apiKeyUrl: 'https://nzbplanet.net/profile'
  },
  {
    id: 'dognzb',
    label: 'DOGnzb (api.dognzb.cr)',
    endpoint: 'https://api.dognzb.cr',
    apiPath: '/api',
    description: 'Legacy invite-only indexer. Use the API hostname rather than the landing page.',
    apiKeyUrl: 'https://dognzb.cr/profile'
  },
  {
    id: 'althub',
    label: 'altHUB (api.althub.co.za)',
    endpoint: 'https://api.althub.co.za',
    apiPath: '/api',
    description: 'Community-run indexer popular in South Africa. Requires account + API key.',
    apiKeyUrl: 'https://althub.co.za/profile'
  },
  {
    id: 'animetosho',
    label: 'AnimeTosho (feed.animetosho.org)',
    endpoint: 'https://feed.animetosho.org',
    apiPath: '/api',
    description: 'Anime-focused public feed with Newznab-compatible API.',
    apiKeyUrl: 'https://animetosho.org/login'
  },
  {
    id: 'miatrix',
    label: 'Miatrix (miatrix.com)',
    endpoint: 'https://www.miatrix.com',
    apiPath: '/api',
    description: 'General-purpose indexer; membership required for API usage.',
    apiKeyUrl: 'https://www.miatrix.com/profile'
  },
  {
    id: 'ninjacentral',
    label: 'NinjaCentral (ninjacentral.co.za)',
    endpoint: 'https://ninjacentral.co.za',
    apiPath: '/api',
    description: 'Invite-only indexer focused on South African content. Paste your API key.',
    apiKeyUrl: 'https://ninjacentral.co.za/profile'
  },
  {
    id: 'nzblife',
    label: 'NZB.life (api.nzb.life)',
    endpoint: 'https://api.nzb.life',
    apiPath: '/api',
    description: 'Smaller public indexer. Requires account for API requests.',
    apiKeyUrl: 'https://nzb.life/profile'
  },
  {
    id: 'nzbfinder',
    label: 'NZBFinder (nzbfinder.ws)',
    endpoint: 'https://nzbfinder.ws',
    apiPath: '/api',
    description: 'Paid/veteran-friendly indexer. API key available on the profile page.',
    apiKeyUrl: 'https://nzbfinder.ws/account'
  },
  {
    id: 'nzbstars',
    label: 'NZBStars (nzbstars.com)',
    endpoint: 'https://nzbstars.com',
    apiPath: '/api',
    description: 'Invite-only indexer with TV and movie focus. Requires API key.',
    apiKeyUrl: 'https://nzbstars.com/account'
  },
  {
    id: 'scenenzbs',
    label: 'SceneNZBs (scenenzbs.com)',
    endpoint: 'https://scenenzbs.com',
    apiPath: '/api',
    description: 'Scene-focused indexer. API key from account settings is required.',
    apiKeyUrl: 'https://scenenzbs.com/profile'
  },
  {
    id: 'tabularasa',
    label: 'Tabula Rasa (tabula-rasa.pw)',
    endpoint: 'https://www.tabula-rasa.pw',
    apiPath: '/api/v1',
    description: 'Invite-only indexer with modern API v1 endpoint.',
    apiKeyUrl: 'https://www.tabula-rasa.pw/profile'
  },
  {
    id: 'usenet-crawler',
    label: 'Usenet Crawler (usenet-crawler.com)',
    endpoint: 'https://www.usenet-crawler.com',
    apiPath: '/api',
    description: 'Established public indexer with free and VIP plans. API key on profile page.',
    apiKeyUrl: 'https://www.usenet-crawler.com/profile'
  },
];

function toTrimmedString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parsePaidLimit(value, fallback = 6) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(String(value).trim());
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(6, Math.max(1, Math.floor(numeric)));
  return clamped;
}

function normalizeApiPath(raw) {
  let value = toTrimmedString(raw) || '/api';
  if (!value.startsWith('/')) {
    value = `/${value}`;
  }
  value = value.replace(/\/+/g, '/');
  while (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1);
  }
  return value || '/api';
}

function extractHost(url) {
  try {
    const target = new URL(url);
    return target.hostname || target.host || url;
  } catch (_) {
    return url;
  }
}

function maskApiKey(key) {
  if (!key) return '';
  const value = String(key);
  if (value.length <= 6) return `${value[0]}***${value[value.length - 1]}`;
  const start = value.slice(0, 3);
  const end = value.slice(-2);
  return `${start}***${end}`;
}

function normalizePresetEntry(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = toTrimmedString(raw.endpoint || raw.url || raw.baseUrl || raw.baseURL);
  if (!endpoint) return null;
  const label = toTrimmedString(raw.label || raw.name) || endpoint;
  const apiPath = normalizeApiPath(raw.apiPath || raw.api_path || raw.path || '/api');
  const id = toTrimmedString(raw.id) || fallbackId || label.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
  return {
    id,
    label,
    endpoint,
    apiPath,
    description: toTrimmedString(raw.description || raw.note || raw.notes) || undefined,
    apiKeyUrl: toTrimmedString(raw.apiKeyUrl || raw.api_key_url || raw.keyUrl || raw.key_url) || undefined,
  };
}

function getEnvPresetEntries() {
  const raw = process.env.NEWZNAB_PRESETS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, idx) => normalizePresetEntry(entry, `custom-${idx + 1}`))
      .filter(Boolean);
  } catch (error) {
    console.warn('[NEWZNAB] Failed to parse NEWZNAB_PRESETS env JSON:', error?.message || error);
    return [];
  }
}

function getAvailableNewznabPresets() {
  const custom = getEnvPresetEntries();
  const builtin = [...BUILTIN_NEWZNAB_PRESETS];
  if (!custom.length) {
    return builtin;
  }
  return [...custom, ...builtin];
}

function extractErrorFromParsed(parsed) {
  if (!parsed) return null;
  const candidate = parsed.error || parsed.Error || parsed.errors || parsed.Errors;
  if (!candidate) return null;
  const entries = Array.isArray(candidate) ? candidate : [candidate];
  for (const entry of entries) {
    if (!entry) continue;
    const attrs = entry.$ || {};
    const code = entry.code || entry.Code || attrs.code || attrs.Code || null;
    const description = entry.description || entry.Description || attrs.description || attrs.Description || entry._ || entry.text || null;
    if (description || code) {
      return [description || 'Newznab error', code ? `(code ${code})` : null].filter(Boolean).join(' ');
    }
  }
  return null;
}

function extractErrorFromBody(body) {
  if (!body || typeof body !== 'string') return null;
  const attrMatch = body.match(/<error[^>]*description="([^"]+)"[^>]*>/i);
  if (attrMatch && attrMatch[1]) return attrMatch[1];
  const textMatch = body.match(/<error[^>]*>([^<]+)<\/error>/i);
  if (textMatch && textMatch[1]) return textMatch[1].trim();
  const jsonMatch = body.match(/"error"\s*:\s*"([^"]+)"/i);
  if (jsonMatch && jsonMatch[1]) return jsonMatch[1];
  return null;
}

function normalizeCapsType(rawType) {
  const value = (rawType || '').toLowerCase();
  if (value === 'tv-search' || value === 'tvsearch') return 'tvsearch';
  if (value === 'movie-search' || value === 'movie') return 'movie';
  return 'search';
}

function parseSupportedParamsFromXml(xml) {
  if (!xml || typeof xml !== 'string') return null;
  const regex = /<(search|tv-search|movie-search)[^>]*supportedparams="([^"]+)"/gi;
  const supportedByType = {
    search: new Set(),
    tvsearch: new Set(),
    movie: new Set(),
  };
  let match = null;
  while ((match = regex.exec(xml)) !== null) {
    const type = normalizeCapsType(match[1]);
    const raw = match[2] || '';
    raw.split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => supportedByType[type].add(token.toLowerCase()));
  }

  const hasAny = Object.values(supportedByType).some((set) => set.size > 0);
  return hasAny ? supportedByType : null;
}

function loadCapsCacheFromEnv() {
  const raw = process.env.NEWZNAB_CAPS_CACHE || '';
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key) return;
      const capsRecord = { search: new Set(), tvsearch: new Set(), movie: new Set() };
      if (Array.isArray(value)) {
        value.map((entry) => String(entry).toLowerCase()).filter(Boolean)
          .forEach((token) => capsRecord.search.add(token));
      } else if (value && typeof value === 'object') {
        ['search', 'tvsearch', 'movie'].forEach((type) => {
          const list = Array.isArray(value[type]) ? value[type] : [];
          list.map((entry) => String(entry).toLowerCase()).filter(Boolean)
            .forEach((token) => capsRecord[type].add(token));
        });
      }
      newznabCapsCache.set(key, { supportedParams: capsRecord, fetchedAt: Date.now(), persisted: true });
    });
  } catch (error) {
    console.warn('[NEWZNAB] Failed to parse NEWZNAB_CAPS_CACHE:', error?.message || error);
  }
}

async function fetchNewznabCaps(config, options = {}) {
  if (!config?.endpoint || !config.apiKey) return null;
  const requestUrl = config.baseUrl || `${config.endpoint}${config.apiPath}`;
  const params = { t: 'caps', apikey: config.apiKey };
  const response = await axios.get(requestUrl, {
    params,
    timeout: options.timeoutMs || 12000,
    responseType: 'text',
    validateStatus: () => true,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized (check API key)');
  }
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const explicitError = extractErrorFromBody(body);
  if (explicitError) {
    throw new Error(explicitError);
  }
  return parseSupportedParamsFromXml(body);
}

function getSupportedParamsForType(supportedParams, planType) {
  if (!supportedParams) return null;
  if (supportedParams instanceof Set) return supportedParams;
  const normalizedType = normalizeCapsType(planType);
  if (supportedParams[normalizedType] instanceof Set) return supportedParams[normalizedType];
  return null;
}

async function getSupportedParams(config, options = {}) {
  if (!config?.dedupeKey) return null;
  const cacheKey = config.dedupeKey;
  const cached = newznabCapsCache.get(cacheKey);
  if (cached && !options.forceRefresh) {
    return getSupportedParamsForType(cached.supportedParams, options.planType);
  }
  try {
    const supportedParams = await fetchNewznabCaps(config, options);
    newznabCapsCache.set(cacheKey, { supportedParams, fetchedAt: Date.now() });
    return getSupportedParamsForType(supportedParams, options.planType);
  } catch (error) {
    newznabCapsCache.set(cacheKey, { supportedParams: null, fetchedAt: Date.now() });
    return null;
  }
}

async function refreshCapsCache(configs, options = {}) {
  const eligible = filterUsableConfigs(configs, { requireEnabled: true, requireApiKey: true });
  const results = {};
  await Promise.all(eligible.map(async (config) => {
    const supportedParams = await fetchNewznabCaps(config, { ...options, forceRefresh: true });
    if (supportedParams) {
      results[config.dedupeKey] = {
        search: Array.from(supportedParams.search || []),
        tvsearch: Array.from(supportedParams.tvsearch || []),
        movie: Array.from(supportedParams.movie || []),
      };
    }
  }));
  return results;
}

function extractRequiredIdParams(plan) {
  const required = new Set();
  if (!plan || !Array.isArray(plan.tokens)) return required;
  plan.tokens.forEach((token) => {
    if (!token || typeof token !== 'string') return;
    const match = token.match(/^\{([^:]+):/);
    if (!match) return;
    const key = match[1].trim().toLowerCase();
    if (['imdbid', 'tvdbid', 'tmdbid'].includes(key)) {
      required.add(key);
    }
  });
  return required;
}

loadCapsCacheFromEnv();

const ZYCLOPS_ENDPOINT = 'https://zyclops.elfhosted.com';
const ZYCLOPS_API_PATH = '/api';

function getZyclopsProviderHost() {
  return (process.env.NZB_TRIAGE_NNTP_HOST || '').trim();
}

function applyZyclopsTransform(config) {
  if (!config || !config.zyclopsEnabled) return config;
  const providerHost = getZyclopsProviderHost();
  if (!providerHost) {
    console.warn(`[NEWZNAB][${config.displayName}] Zyclops enabled but no NNTP host configured — skipping transform`);
    return config;
  }
  const originalBaseUrl = `${config.endpoint}${config.apiPath}`;
  const zyclopsApiKey = `${config.apiKey}&target=${encodeURIComponent(originalBaseUrl)}&provider_host=${encodeURIComponent(providerHost)}`;
  return {
    ...config,
    endpoint: ZYCLOPS_ENDPOINT,
    apiPath: ZYCLOPS_API_PATH,
    apiKey: zyclopsApiKey,
    baseUrl: `${ZYCLOPS_ENDPOINT}${ZYCLOPS_API_PATH}`,
    _zyclopsOriginalEndpoint: config.endpoint,
    _zyclopsOriginalApiPath: config.apiPath,
    _zyclopsOriginalApiKey: config.apiKey,
  };
}

function buildIndexerConfig(source, idx, { includeEmpty = false } = {}) {
  const key = String(idx).padStart(2, '0');
  const endpoint = toTrimmedString(source[`NEWZNAB_ENDPOINT_${key}`]);
  const apiKey = toTrimmedString(source[`NEWZNAB_API_KEY_${key}`]);
  const apiPathRaw = source[`NEWZNAB_API_PATH_${key}`];
  const apiPath = normalizeApiPath(apiPathRaw);
  const name = toTrimmedString(source[`NEWZNAB_NAME_${key}`]);
  const enabledRaw = source[`NEWZNAB_INDEXER_ENABLED_${key}`];
  const enabled = parseBoolean(enabledRaw, true);
  const paidRaw = source[`NEWZNAB_PAID_${key}`];
  const isPaid = parseBoolean(paidRaw, false);
  const paidLimitRaw = source[`NEWZNAB_PAID_LIMIT_${key}`];
  const paidLimit = isPaid ? parsePaidLimit(paidLimitRaw, 6) : null;
  const zyclopsRaw = source[`NEWZNAB_ZYCLOPS_${key}`];
  const zyclopsEnabled = parseBoolean(zyclopsRaw, false);

  const hasAnyValue = endpoint || apiKey || apiPathRaw || name || enabledRaw !== undefined;
  if (!hasAnyValue && !includeEmpty) {
    return null;
  }

  const normalizedEndpoint = endpoint ? stripTrailingSlashes(endpoint) : '';
  const displayName = name || (normalizedEndpoint ? extractHost(normalizedEndpoint) : `Indexer ${idx}`);
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/gi, '-');

  const rawConfig = {
    id: key,
    ordinal: idx,
    endpoint: normalizedEndpoint,
    apiKey,
    apiPath,
    name,
    displayName,
    enabled,
    isPaid,
    paidLimit,
    zyclopsEnabled,
    slug,
    dedupeKey: slug || `indexer-${key}`,
    baseUrl: normalizedEndpoint ? `${normalizedEndpoint}${apiPath}` : '',
  };

  return applyZyclopsTransform(rawConfig);
}

function buildIndexerConfigs(source = {}, options = {}) {
  const configs = [];
  for (let i = 1; i <= MAX_NEWZNAB_INDEXERS; i += 1) {
    const config = buildIndexerConfig(source, i, options);
    if (config) {
      configs.push(config);
    }
  }
  return configs;
}

function getEnvNewznabConfigs(options = {}) {
  return buildIndexerConfigs(process.env, options);
}

function getNewznabConfigsFromValues(values = {}, options = {}) {
  return buildIndexerConfigs(values, options);
}

function filterUsableConfigs(configs = [], { requireEnabled = true, requireApiKey = true } = {}) {
  return configs.filter((config) => {
    if (!config || !config.endpoint) return false;
    if (requireEnabled && config.enabled === false) return false;
    if (requireApiKey && !config.apiKey) return false;
    return true;
  });
}

function applyTokenToParams(token, params) {
  if (!token || typeof token !== 'string') return;
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) return;
  const key = match[1].trim().toLowerCase();
  const rawValue = match[2].trim();

  switch (key) {
    case 'imdbid': {
      const trimmed = rawValue.replace(/^tt/i, '');
      if (trimmed) params.imdbid = trimmed;
      break;
    }
    case 'tmdbid':
      if (rawValue) params.tmdbid = rawValue;
      break;
    case 'tvdbid':
      if (rawValue) params.tvdbid = rawValue;
      break;
    case 'season':
      if (rawValue) params.season = rawValue;
      break;
    case 'episode':
      if (rawValue) params.ep = rawValue;
      break;
    default:
      if (rawValue) {
        params[key] = rawValue;
      }
      break;
  }
}

function buildSearchParams(plan) {
  const params = {};
  
  // Determine if this is an ID-based search (has imdbid, tmdbid, or tvdbid tokens)
  const hasIdToken = Array.isArray(plan?.tokens) && plan.tokens.some(token => {
    const match = token?.match(/^\{([^:]+):/);
    return match && ['imdbid', 'tmdbid', 'tvdbid'].includes(match[1].trim().toLowerCase());
  });
  
  // For movie/TV searches:
  // - Use t=movie/tvsearch ONLY if we have ID tokens (imdbid, tmdbid, tvdbid)
  // - Otherwise use t=search with category filters (Newznab standard: https://newznab.readthedocs.io/en/latest/misc/api.html#predefined-categories)
  // Movies = Category 2000
  // TV     = Category 5000
  if (plan?.type === 'movie') {
    if (hasIdToken) {
      params.t = 'movie';
    } else {
      params.t = 'search';
      params.cat = '2000';
    }
  } else if (plan?.type === 'tvsearch') {
    if (hasIdToken) {
      params.t = 'tvsearch';
    } else {
      params.t = 'search';
      params.cat = '5000';
    }
  } else {
    params.t = 'search';
  }
  
  if (Array.isArray(plan?.tokens)) {
    plan.tokens.forEach((token) => applyTokenToParams(token, params));
  }
  if (plan?.rawQuery) {
    params.q = plan.rawQuery;
  } else if ((!plan?.tokens || plan.tokens.length === 0) && plan?.query) {
    params.q = plan.query;
  }
  return params;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildAttrMap(item) {
  const map = {};
  const sources = [];
  const addSource = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => addSource(entry));
      return;
    }
    sources.push(source);
  };

  addSource(item?.attr);
  addSource(item?.attrs);
  addSource(item?.attribute);
  addSource(item?.attributes);
  addSource(item?.['newznab:attr']);
  addSource(item?.['newznab:attrs']);

  sources.forEach((entry) => {
    if (!entry) return;
    const payload = entry.$ || entry;
    const name = toTrimmedString(payload.name || payload.Name || payload.field || payload.Field || payload.key || payload.Key).toLowerCase();
    if (!name) return;
    const value = payload.value ?? payload.Value ?? payload.content ?? payload.Content ?? payload['#text'] ?? payload.text;
    if (value !== undefined && value !== null) {
      map[name] = value;
    }
  });

  return map;
}

function parseGuid(rawGuid) {
  if (!rawGuid) return null;
  if (typeof rawGuid === 'string') return rawGuid;
  if (typeof rawGuid === 'object') {
    return rawGuid._ || rawGuid['#text'] || rawGuid.url || rawGuid.href || null;
  }
  return null;
}

function parseSizeValue(value) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isLikelyNzb(url) {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return (
    normalized.includes('.nzb') ||
    normalized.includes('mode=getnzb') ||
    normalized.includes('t=getnzb') ||
    normalized.includes('action=getnzb') ||
    /\bgetnzb\b/.test(normalized)
  );
}

function normalizeNewznabItem(item, config, { filterNzbOnly = true } = {}) {
  if (!item) return null;
  const parsedGuid = parseGuid(item.guid || item.GUID);
  let downloadUrl = null;

  // Prefer GUID when it already points at an NZB (SceneNZBs et al.)
  if (parsedGuid && isLikelyNzb(parsedGuid)) {
    downloadUrl = parsedGuid;
  }

  const enclosure = item.enclosure;
  if (!downloadUrl && enclosure) {
    const enclosureTarget = Array.isArray(enclosure) ? enclosure[0] : enclosure;
    downloadUrl = enclosureTarget?.url || enclosureTarget?.href || enclosureTarget?.link;
    if (!downloadUrl && enclosureTarget?.guid) {
      downloadUrl = enclosureTarget.guid;
    }
  }
  if (!downloadUrl && item.link) {
    downloadUrl = item.link;
  }
  if (!downloadUrl && parsedGuid) {
    downloadUrl = parsedGuid;
  }
  if (!downloadUrl) return null;

  if (filterNzbOnly && !isLikelyNzb(downloadUrl)) {
    return null;
  }

  const attrMap = buildAttrMap(item);
  const sizeValue = attrMap.size || attrMap.filesize || attrMap['contentlength'] || item.size || item.Size;
  const publishDate = item.pubDate || item.pubdate || attrMap.pubdate || attrMap['publishdate'] || attrMap['usenetdate'];
  const title = toTrimmedString(item.title || item.Title || item.name || downloadUrl);

  const resolved = {
    title: title || downloadUrl,
    downloadUrl,
    guid: parsedGuid,
    size: parseSizeValue(sizeValue),
    publishDate,
    publishDateMs: publishDate ? Date.parse(publishDate) : undefined,
    indexer: config.displayName,
    indexerId: config.dedupeKey,
    _sourceType: 'newznab',
  };

  if (attrMap.age) resolved.age = attrMap.age;
  if (attrMap.category) resolved.category = attrMap.category;
  if (!resolved.indexer && attrMap.indexer) {
    resolved.indexer = attrMap.indexer;
  }

  return resolved;
}

async function fetchIndexerResults(config, plan, options) {
  const supportedParams = options.supportedParams instanceof Set ? options.supportedParams : null;
  let effectivePlan = plan;
  if (supportedParams && Array.isArray(plan?.tokens)) {
    const filteredTokens = plan.tokens.filter((token) => {
      if (!token || typeof token !== 'string') return false;
      const match = token.match(/^\{([^:]+):/);
      if (!match) return true;
      const key = match[1].trim().toLowerCase();
      if (supportedParams.has(key)) return true;
      if (key === 'episode' && supportedParams.has('ep')) return true;
      if (key === 'ep' && supportedParams.has('episode')) return true;
      return false;
    });
    effectivePlan = { ...plan, tokens: filteredTokens };
    if (effectivePlan.rawQuery && !supportedParams.has('q')) {
      effectivePlan = { ...effectivePlan, rawQuery: null };
    }
  }
  const params = buildSearchParams(effectivePlan);
  params.apikey = config.apiKey;
  const requestUrl = config.baseUrl || `${config.endpoint}${config.apiPath}`;
  const safeParams = { ...params, apikey: maskApiKey(params.apikey) };
  const logPrefix = options.label || '[NEWZNAB]';
  if (options.logEndpoints) {
    const tokenSummary = Array.isArray(effectivePlan?.tokens) && effectivePlan.tokens.length > 0 ? effectivePlan.tokens.join(' ') : null;
    console.log(`${logPrefix}[ENDPOINT]`, {
      indexer: config.displayName || config.endpoint,
      planType: plan?.type,
      query: plan?.query,
      tokens: tokenSummary,
      url: requestUrl,
    });
  }
  if (options.debug) {
    console.log(`${logPrefix}[SEARCH][REQ]`, { url: requestUrl, params: safeParams });
  }

  const response = await axios.get(requestUrl, {
    params,
    timeout: options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'User-Agent': getRandomUserAgent(),
    },
    validateStatus: () => true,
  });

  const contentType = response.headers?.['content-type'];
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

  if (options.debug) {
    console.log(`${logPrefix}[SEARCH][RESP]`, {
      url: requestUrl,
      status: response.status,
      contentType,
      body: body?.slice(0, DEBUG_BODY_CHAR_LIMIT),
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized (check API key)');
  }
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  const parsed = await parseXmlString(body, XML_PARSE_OPTIONS);
  const explicitError = extractErrorFromParsed(parsed) || extractErrorFromBody(body);
  if (explicitError) {
    throw new Error(explicitError);
  }
  const channel = parsed?.channel || parsed?.rss?.channel || parsed?.rss?.Channel || parsed?.rss;
  const itemsRaw = channel?.item || channel?.Item || parsed?.item || [];
  const items = ensureArray(itemsRaw)
    .map((item) => normalizeNewznabItem(item, config, { filterNzbOnly: options.filterNzbOnly }))
    .filter(Boolean);

  return { config, items };
}

async function searchNewznabIndexers(plan, configs, options = {}) {
  const defaults = {
    filterNzbOnly: true,
    debug: false,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    label: '[NEWZNAB]',
    logEndpoints: false,
  };
  const settings = { ...defaults, ...options };
  const eligible = filterUsableConfigs(configs, { requireEnabled: true, requireApiKey: true });
  if (!eligible.length) {
    return { results: [], errors: ['No enabled Newznab indexers configured'], endpoints: [] };
  }

  const requiredIdParams = extractRequiredIdParams(plan);
  const supportedMatrix = await Promise.all(
    eligible.map(async (config) => ({
      config,
      supportedParams: await getSupportedParams(config, { ...settings, planType: plan?.type }),
    }))
  );

  const filteredEligible = supportedMatrix
    .filter(({ config, supportedParams }) => {
      if (!supportedParams || supportedParams.size === 0) return true;
      if (requiredIdParams.size === 0) return true;
      let hasAny = false;
      for (const key of requiredIdParams) {
        if (supportedParams.has(key)) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny && settings.debug) {
        console.log(`${settings.label}[SKIP] ${config.displayName} does not support any of ${Array.from(requiredIdParams).join(', ')}`);
      }
      return hasAny;
    })
    .map(({ config }) => config);

  if (!filteredEligible.length) {
    return { results: [], errors: ['No enabled Newznab indexers support the requested IDs'], endpoints: [] };
  }

  const tasks = filteredEligible.map((config) => {
    const supportedParams = supportedMatrix.find((entry) => entry.config === config)?.supportedParams || null;
    return fetchIndexerResults(config, plan, { ...settings, supportedParams });
  });

  const settled = await Promise.allSettled(tasks);
  const aggregated = [];
  const errors = [];
  const endpoints = [];

  settled.forEach((result, idx) => {
    const config = filteredEligible[idx];
    if (result.status === 'fulfilled') {
      aggregated.push(...result.value.items);
      endpoints.push({
        id: config.id,
        name: config.displayName,
        count: result.value.items.length,
      });
    } else {
      const message = result.reason?.message || result.reason || 'Unknown Newznab error';
      errors.push(`${config.displayName}: ${message}`);
      endpoints.push({
        id: config.id,
        name: config.displayName,
        count: 0,
        error: message,
      });
    }
  });

  return { results: aggregated, errors, endpoints };
}

async function validateNewznabSearch(config, options = {}) {
  const plan = {
    type: 'search',
    query: options.query || 'usenetstreamer',
    rawQuery: options.query || 'usenetstreamer',
    tokens: [],
  };
  const { items = [] } = await fetchIndexerResults(config, plan, {
    filterNzbOnly: false,
    timeoutMs: options.timeoutMs || 15000,
    debug: options.debug,
    label: options.label || NEWZNAB_TEST_LOG_PREFIX,
  });
  const total = Array.isArray(items) ? items.length : 0;
  const summary = total > 0
    ? `API validated (${total} sample NZB${total === 1 ? '' : 's'} returned)`
    : 'API validated';
  return summary;
}

async function testNewznabCaps(config, options = {}) {
  if (!config?.endpoint) {
    throw new Error('Newznab endpoint is required');
  }
  if (!config.apiKey) {
    throw new Error('Newznab API key is required');
  }
  const requestUrl = config.baseUrl || `${config.endpoint}${config.apiPath}`;
  const params = { t: 'caps', apikey: config.apiKey };
  const debugEnabled = Boolean(options.debug);
  const logPrefix = options.label || NEWZNAB_TEST_LOG_PREFIX;
  if (debugEnabled) {
    console.log(`${logPrefix}[REQ]`, { url: requestUrl, params: { ...params, apikey: maskApiKey(params.apikey) } });
  }

  const response = await axios.get(requestUrl, {
    params,
    timeout: options.timeoutMs || 12000,
    responseType: 'text',
    validateStatus: () => true,
  });
  const contentType = response.headers?.['content-type'];
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  if (debugEnabled) {
    console.log(`${logPrefix}[RESP]`, {
      url: requestUrl,
      status: response.status,
      contentType,
      body: body?.slice(0, DEBUG_BODY_CHAR_LIMIT),
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized (check API key)');
  }
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }
  let parsed = null;
  try {
    parsed = await parseXmlString(body, XML_PARSE_OPTIONS);
  } catch (error) {
    if (debugEnabled) {
      console.warn(`${logPrefix}[PARSE] Failed to parse CAPS XML`, error?.message || error);
    }
  }

  const explicitError = extractErrorFromParsed(parsed) || extractErrorFromBody(body);
  if (explicitError) {
    throw new Error(explicitError);
  }

  const lowerPayload = (body || '').toLowerCase();
  const hasCaps = Boolean(
    (parsed && (parsed.caps || parsed.Caps || parsed['newznab:caps'])) ||
    lowerPayload.includes('<caps')
  );
  if (!hasCaps) {
    throw new Error('Unexpected response from Newznab (missing <caps>)');
  }
  return `Connected to ${config.displayName || 'Newznab'}`;
}

module.exports = {
  MAX_NEWZNAB_INDEXERS,
  NEWZNAB_NUMBERED_KEYS,
  getEnvNewznabConfigs,
  getNewznabConfigsFromValues,
  filterUsableConfigs,
  searchNewznabIndexers,
  testNewznabCaps,
  validateNewznabSearch,
  getAvailableNewznabPresets,
  maskApiKey,
  refreshCapsCache,
};
