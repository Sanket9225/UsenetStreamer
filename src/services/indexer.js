// Indexer service - Prowlarr and NZBHydra integration
const axios = require('axios');
const { getPublishMetadataFromResult, areReleasesWithinDays } = require('../utils/publishInfo');

// Configuration (runtime reloadable)
let INDEXER_MANAGER = 'prowlarr';
let INDEXER_MANAGER_URL = '';
let INDEXER_MANAGER_API_KEY = '';
let INDEXER_MANAGER_INDEXERS = '-1';
let INDEXER_MANAGER_CACHE_MINUTES = 10;
let INDEXER_MANAGER_BASE_URL = '';

function reloadConfig() {
  INDEXER_MANAGER = (process.env.INDEXER_MANAGER || 'prowlarr').trim().toLowerCase();
  INDEXER_MANAGER_URL = (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || '').trim();
  INDEXER_MANAGER_API_KEY = (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || '').trim();
  INDEXER_MANAGER_INDEXERS = (() => {
    const fallback = INDEXER_MANAGER === 'nzbhydra' ? '' : '-1';
    const raw = (process.env.INDEXER_MANAGER_INDEXERS || process.env.PROWLARR_INDEXER_IDS || '').trim();
    if (!raw) return fallback;
    const joined = raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .join(',');
    return joined || fallback;
  })();
  INDEXER_MANAGER_CACHE_MINUTES = (() => {
    const raw = Number(process.env.INDEXER_MANAGER_CACHE_MINUTES);
    return Number.isFinite(raw) && raw >= 0 ? raw : 10;
  })();
  INDEXER_MANAGER_BASE_URL = INDEXER_MANAGER_URL.replace(/\/+$/, '');
}

reloadConfig();
const PROWLARR_SEARCH_LIMIT = 1000;
const TRIAGE_DECISION_SHARING_WINDOW_DAYS = 14;

const isUsingProwlarr = () => INDEXER_MANAGER === 'prowlarr';
const isUsingNzbhydra = () => INDEXER_MANAGER === 'nzbhydra';

function ensureIndexerManagerConfigured() {
  if (INDEXER_MANAGER === 'none') {
    return;
  }
  if (!INDEXER_MANAGER_URL) {
    throw new Error('INDEXER_MANAGER_URL is not configured');
  }
  if (!INDEXER_MANAGER_API_KEY) {
    throw new Error('INDEXER_MANAGER_API_KEY is not configured');
  }
}

// Prowlarr functions
function buildProwlarrIndexerIdList() {
  if (!INDEXER_MANAGER_INDEXERS) return null;
  if (INDEXER_MANAGER_INDEXERS === '-1') return ['-1'];
  const tokens = INDEXER_MANAGER_INDEXERS.split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return tokens.length > 0 ? tokens : null;
}

function buildProwlarrSearchParams(plan) {
  return {
    limit: String(PROWLARR_SEARCH_LIMIT),
    offset: '0',
    type: plan.type,
    query: plan.query,
    indexerIdsList: buildProwlarrIndexerIdList()
  };
}

async function executeProwlarrSearch(plan) {
  const params = buildProwlarrSearchParams(plan);
  const urlSearchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'indexerIdsList' && Array.isArray(value)) {
      value.forEach((id) => {
        if (id !== undefined && id !== null && String(id).length > 0) {
          urlSearchParams.append('indexerIds', String(id));
        }
      });
    } else {
      urlSearchParams.append(key, String(value));
    }
  });
  const serializedParams = urlSearchParams.toString();
  const requestUrl = `${INDEXER_MANAGER_BASE_URL}/api/v1/search`;
  const fullUrl = serializedParams ? `${requestUrl}?${serializedParams}` : requestUrl;
  console.log('[PROWLARR] Requesting search', { url: fullUrl });
  const response = await axios.get(fullUrl, {
    headers: { 'X-Api-Key': INDEXER_MANAGER_API_KEY },
    timeout: 60000
  });
  return Array.isArray(response.data) ? response.data : [];
}

// NZBHydra functions
function mapHydraSearchType(planType) {
  if (planType === 'tvsearch' || planType === 'movie' || planType === 'search' || planType === 'book') {
    return planType;
  }
  return 'search';
}

function applyTokenToHydraParams(token, params) {
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) return;
  
  const key = match[1].trim().toLowerCase();
  const rawValue = match[2].trim();

  switch (key) {
    case 'imdbid': {
      const value = rawValue.replace(/^tt/i, '');
      if (value) params.imdbid = value;
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

function buildHydraSearchParams(plan) {
  const params = {
    apikey: INDEXER_MANAGER_API_KEY,
    t: mapHydraSearchType(plan.type),
    o: 'json'
  };

  if (INDEXER_MANAGER_INDEXERS) {
    params.indexers = INDEXER_MANAGER_INDEXERS;
  }

  if (INDEXER_MANAGER_CACHE_MINUTES > 0) {
    params.cachetime = String(INDEXER_MANAGER_CACHE_MINUTES);
  }

  if (Array.isArray(plan.tokens)) {
    plan.tokens.forEach((token) => applyTokenToHydraParams(token, params));
  }

  if (plan.rawQuery) {
    params.q = plan.rawQuery;
  } else if ((!plan.tokens || plan.tokens.length === 0) && plan.query) {
    params.q = plan.query;
  }

  return params;
}

function extractHydraAttrMap(item) {
  const attrMap = {};
  const attrSources = [];

  const collectSource = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => attrSources.push(entry));
    } else {
      attrSources.push(source);
    }
  };

  collectSource(item.attr);
  collectSource(item.attrs);
  collectSource(item.attributes);
  collectSource(item['newznab:attr']);
  collectSource(item['newznab:attrs']);

  attrSources.forEach((attr) => {
    if (!attr) return;
    const entry = attr['@attributes'] || attr.attributes || attr.$ || attr;
    const rawName =
      entry.name ?? entry.Name ?? entry['@name'] ?? entry['@Name'] ??
      entry.key ?? entry.Key ?? entry['@key'] ?? entry['@Key'] ??
      entry.field ?? entry.Field ?? '';
    const name = rawName.toString().trim().toLowerCase();
    if (!name) return;
    const value =
      entry.value ?? entry.Value ?? entry['@value'] ?? entry['@Value'] ??
      entry.val ?? entry.Val ?? entry.content ?? entry.Content ??
      entry['#text'] ?? entry.text ?? entry['@text'];
    if (value !== undefined && value !== null) {
      attrMap[name] = value;
    }
  });

  return attrMap;
}

function normalizeHydraResults(data) {
  if (!data) return [];

  const resolveItems = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.item) return resolveItems(payload.item);
    return [payload];
  };

  const channel = data.channel || data.rss?.channel || data['rss']?.channel;
  const items = resolveItems(channel || data.item || []);
  const results = [];

  for (const item of items) {
    if (!item) continue;
    const title = item.title || item['title'] || null;

    let downloadUrl = null;
    const enclosure = item.enclosure || item['enclosure'];
    if (enclosure) {
      const enclosureObj = Array.isArray(enclosure) ? enclosure[0] : enclosure;
      downloadUrl = enclosureObj?.url || enclosureObj?.['@url'] || enclosureObj?.href || enclosureObj?.link;
    }
    if (!downloadUrl) {
      downloadUrl = item.link || item['link'];
    }
    if (!downloadUrl) {
      const guid = item.guid || item['guid'];
      if (typeof guid === 'string') {
        downloadUrl = guid;
      } else if (guid && typeof guid === 'object') {
        downloadUrl = guid._ || guid['#text'] || guid.url || guid.href;
      }
    }
    if (!downloadUrl) continue;

    const attrMap = extractHydraAttrMap(item);
    const resolveFirst = (...candidates) => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        if (Array.isArray(candidate)) {
          const inner = resolveFirst(...candidate);
          if (inner !== undefined && inner !== null) return inner;
          continue;
        }
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          return trimmed;
        }
        return candidate;
      }
      return undefined;
    };

    const enclosureObj = Array.isArray(enclosure) ? enclosure?.[0] : enclosure;
    const enclosureLength = enclosureObj?.length || enclosureObj?.['@length'] || 
                           enclosureObj?.['$']?.length || enclosureObj?.['@attributes']?.length;

    const sizeValue = resolveFirst(
      attrMap.size, attrMap.filesize, attrMap['contentlength'],
      attrMap['content-length'], attrMap.length, attrMap.nzbsize,
      item.size, item.Size, enclosureLength
    );
    const parsedSize = sizeValue !== undefined ? Number.parseInt(String(sizeValue), 10) : NaN;
    
    const indexer = resolveFirst(
      attrMap.indexername, attrMap.indexer, attrMap['hydraindexername'], attrMap['hydraindexer'],
      item.hydraIndexerName, item.hydraindexername, item.hydraIndexer, item.hydraindexer,
      item.indexer, item.Indexer
    );
    const indexerId = resolveFirst(
      attrMap.indexerid, attrMap['hydraindexerid'],
      item.hydraIndexerId, item.hydraindexerid, indexer
    ) || 'nzbhydra';

    const guidRaw = item.guid || item['guid'];
    let guidValue = null;
    if (typeof guidRaw === 'string') {
      guidValue = guidRaw;
    } else if (guidRaw && typeof guidRaw === 'object') {
      guidValue = guidRaw._ || guidRaw['#text'] || guidRaw.url || guidRaw.href || null;
    }

    const publishDateCandidate = resolveFirst(
      item.pubDate, item.pubdate, item.PublishDate,
      attrMap.pubdate, attrMap['pub-date'], attrMap.publishdate, attrMap['publish-date'],
      attrMap.usenetdate, attrMap['usenet-date']
    );

    results.push({
      title: title || downloadUrl,
      downloadUrl,
      guid: guidValue,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
      indexer,
      indexerId,
      publishDate: publishDateCandidate || undefined,
      pubDate: publishDateCandidate || undefined,
      publish_date: attrMap.publishdate || undefined,
      age: resolveFirst(attrMap.age, attrMap.age_days, attrMap['age-days']),
      ageDays: resolveFirst(attrMap.age_days, attrMap['age-days']),
      ageHours: resolveFirst(attrMap.agehours, attrMap['age-hours']),
      ageMinutes: resolveFirst(attrMap.ageminutes, attrMap['age-minutes']),
    });
  }

  return results;
}

async function executeNzbhydraSearch(plan) {
  const params = buildHydraSearchParams(plan);
  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api`, {
    params,
    timeout: 60000
  });
  return normalizeHydraResults(response.data);
}

// Main execution function
function executeIndexerPlan(plan) {
  if (INDEXER_MANAGER === 'none') {
    return Promise.resolve([]);
  }
  if (isUsingNzbhydra()) {
    return executeNzbhydraSearch(plan);
  }
  return executeProwlarrSearch(plan);
}

// Result annotation
function annotateIndexerResult(result) {
  const publishMeta = getPublishMetadataFromResult(result);
  const ageDays = publishMeta.ageDays ?? (Number.isFinite(result.age) ? Number(result.age) : null);
  const publishDateMs = publishMeta.publishDateMs ?? result.publishDateMs ?? null;
  const publishDateIso = publishMeta.publishDateIso || result.publishDateIso || 
                        result.publishDate || result.publish_date || null;
  const resolvedAge = Number.isFinite(result.age) ? Number(result.age) :
                     (ageDays !== null ? Math.round(ageDays) : undefined);

  return {
    ...result,
    publishDateMs,
    publishDateIso,
    ageDays,
    age: resolvedAge,
  };
}

function canShareDecision(decisionPublishDateMs, candidatePublishDateMs) {
  if (!TRIAGE_DECISION_SHARING_WINDOW_DAYS || TRIAGE_DECISION_SHARING_WINDOW_DAYS <= 0) {
    return true;
  }
  if (!decisionPublishDateMs || !candidatePublishDateMs) {
    return true;
  }
  return areReleasesWithinDays(
    decisionPublishDateMs,
    candidatePublishDateMs,
    TRIAGE_DECISION_SHARING_WINDOW_DAYS,
  );
}

module.exports = {
  ensureIndexerManagerConfigured,
  executeIndexerPlan,
  annotateIndexerResult,
  canShareDecision,
  isUsingProwlarr,
  isUsingNzbhydra,
  // Export for testing/direct use
  executeProwlarrSearch,
  executeNzbhydraSearch,
  buildProwlarrSearchParams,
  buildHydraSearchParams,
  reloadConfig,
};
