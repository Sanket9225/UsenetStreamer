const axios = require('axios');
const { parseStringPromise: parseXmlString } = require('xml2js');
const { stripTrailingSlashes } = require('../utils/config');

const MAX_NEWZNAB_INDEXERS = 20;
const NEWZNAB_FIELD_SUFFIXES = ['ENDPOINT', 'API_KEY', 'API_PATH', 'NAME', 'INDEXER_ENABLED', 'PAID'];
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

const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEBUG_BODY_CHAR_LIMIT = 1200;
const NEWZNAB_TEST_LOG_PREFIX = '[NEWZNAB][TEST]';
const BUILTIN_NEWZNAB_PRESETS = [
  {
    id: 'nzbgeek',
    label: 'NZBGeek (api.nzbgeek.info)',
    endpoint: 'https://api.nzbgeek.info',
    apiPath: '/api',
    description: 'Popular paid Newznab indexer. Requires membership and API key from your profile.',
    apiKeyUrl: 'https://nzbgeek.info/index.php?action=profile'
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
    id: 'torbox-search',
    label: 'TorBox Search (search-api.torbox.app)',
    endpoint: 'https://search-api.torbox.app',
    apiPath: '/newznab',
    description: 'Unofficial TorBox search API wrapper. Requires TorBox credentials.',
    apiKeyUrl: 'https://torbox.app/dashboard'
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

  const hasAnyValue = endpoint || apiKey || apiPathRaw || name || enabledRaw !== undefined;
  if (!hasAnyValue && !includeEmpty) {
    return null;
  }

  const normalizedEndpoint = endpoint ? stripTrailingSlashes(endpoint) : '';
  const displayName = name || (normalizedEndpoint ? extractHost(normalizedEndpoint) : `Indexer ${idx}`);
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/gi, '-');

  return {
    id: key,
    ordinal: idx,
    endpoint: normalizedEndpoint,
    apiKey,
    apiPath,
    name,
    displayName,
    enabled,
    isPaid,
    slug,
    dedupeKey: slug || `indexer-${key}`,
    baseUrl: normalizedEndpoint ? `${normalizedEndpoint}${apiPath}` : '',
  };
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

function mapPlanType(planType) {
  const normalized = (planType || '').toString().toLowerCase();
  if (normalized === 'movie' || normalized === 'tvsearch' || normalized === 'search') {
    return normalized;
  }
  return 'search';
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
      break;
  }
}

function buildSearchParams(plan) {
  const params = {
    t: mapPlanType(plan?.type),
  };
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
  let downloadUrl = null;
  const enclosure = item.enclosure;
  if (enclosure) {
    const enclosureTarget = Array.isArray(enclosure) ? enclosure[0] : enclosure;
    downloadUrl = enclosureTarget?.url || enclosureTarget?.href || enclosureTarget?.link;
    if (!downloadUrl && enclosureTarget?.guid) {
      downloadUrl = enclosureTarget.guid;
    }
  }
  if (!downloadUrl && item.link) {
    downloadUrl = item.link;
  }
  if (!downloadUrl) {
    const guid = parseGuid(item.guid || item.GUID);
    if (guid) downloadUrl = guid;
  }
  if (!downloadUrl) return null;

  if (filterNzbOnly && !isLikelyNzb(downloadUrl)) {
    return null;
  }

  const attrMap = buildAttrMap(item);
  const sizeValue = attrMap.size || attrMap.filesize || attrMap['contentlength'] || item.size || item.Size;
  const publishDate = item.pubDate || item.pubdate || attrMap.pubdate || attrMap['publishdate'] || attrMap['usenetdate'];
  const title = toTrimmedString(item.title || item.Title || item.name || downloadUrl);
  const guid = parseGuid(item.guid || item.GUID);

  const resolved = {
    title: title || downloadUrl,
    downloadUrl,
    guid,
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
  const params = buildSearchParams(plan);
  params.apikey = config.apiKey;
  const requestUrl = config.baseUrl || `${config.endpoint}${config.apiPath}`;
  const safeParams = { ...params, apikey: maskApiKey(params.apikey) };
  const logPrefix = options.label || '[NEWZNAB]';
  if (options.logEndpoints) {
    const tokenSummary = Array.isArray(plan?.tokens) && plan.tokens.length > 0 ? plan.tokens.join(' ') : null;
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

  const tasks = eligible.map((config) =>
    fetchIndexerResults(config, plan, settings)
  );

  const settled = await Promise.allSettled(tasks);
  const aggregated = [];
  const errors = [];
  const endpoints = [];

  settled.forEach((result, idx) => {
    const config = eligible[idx];
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
};
