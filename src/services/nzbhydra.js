const axios = require('axios');
const {
  INDEXER_MANAGER_BASE_URL,
  INDEXER_MANAGER_API_KEY,
  INDEXER_MANAGER_CACHE_MINUTES
} = require('../config/environment');

/**
 * Map plan type to NZBHydra search type
 * @param {string} planType - The search plan type
 * @returns {string} NZBHydra search type
 */
function mapHydraSearchType(planType) {
  if (planType === 'tvsearch' || planType === 'movie' || planType === 'search' || planType === 'book') {
    return planType;
  }
  return 'search';
}

/**
 * Apply a token to NZBHydra search params
 * @param {string} token - Token like {ImdbId:tt1234}
 * @param {object} params - Search params object to modify
 */
function applyTokenToHydraParams(token, params) {
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) {
    return;
  }
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

/**
 * Build search params for NZBHydra
 * @param {object} plan - Search plan
 * @param {object} options - Additional options
 * @param {Array<number>} options.selectedIndexers - Array of selected indexer names (NZBHydra uses names, not IDs)
 * @returns {object} NZBHydra search params
 */
function buildHydraSearchParams(plan, options = {}) {
  const params = {
    apikey: INDEXER_MANAGER_API_KEY,
    t: mapHydraSearchType(plan.type),
    o: 'json'
  };

  // NZBHydra uses indexer names, not IDs
  // User selects indexers via config page, pass them as comma-separated names
  if (options.selectedIndexers && Array.isArray(options.selectedIndexers) && options.selectedIndexers.length > 0) {
    params.indexers = options.selectedIndexers.join(',');
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

/**
 * Extract newznab attributes from NZBHydra item
 * @param {object} item - NZBHydra result item
 * @returns {object} Map of attribute names to values
 */
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
      entry.name ??
      entry.Name ??
      entry['@name'] ??
      entry['@Name'] ??
      entry.key ??
      entry.Key ??
      entry['@key'] ??
      entry['@Key'] ??
      entry.field ??
      entry.Field ??
      '';
    const name = rawName.toString().trim().toLowerCase();
    if (!name) return;
    const value =
      entry.value ??
      entry.Value ??
      entry['@value'] ??
      entry['@Value'] ??
      entry.val ??
      entry.Val ??
      entry.content ??
      entry.Content ??
      entry['#text'] ??
      entry.text ??
      entry['@text'];
    if (value !== undefined && value !== null) {
      attrMap[name] = value;
    }
  });

  return attrMap;
}

/**
 * Normalize NZBHydra results to standard format
 * @param {object} data - NZBHydra response data
 * @returns {Array} Normalized results array
 */
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
    if (!downloadUrl) {
      continue;
    }

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
    const enclosureLength = enclosureObj?.length || enclosureObj?.['@length'] || enclosureObj?.['$']?.length || enclosureObj?.['@attributes']?.length;

    const sizeValue = resolveFirst(
      attrMap.size,
      attrMap.filesize,
      attrMap['contentlength'],
      attrMap['content-length'],
      attrMap.length,
      attrMap.nzbsize,
      item.size,
      item.Size,
      enclosureLength
    );
    const parsedSize = sizeValue !== undefined ? Number.parseInt(String(sizeValue), 10) : NaN;
    const indexer = resolveFirst(
      attrMap.indexername,
      attrMap.indexer,
      attrMap['hydraindexername'],
      attrMap['hydraindexer'],
      item.hydraIndexerName,
      item.hydraindexername,
      item.hydraIndexer,
      item.hydraindexer,
      item.indexer,
      item.Indexer
    );
    const indexerId = resolveFirst(attrMap.indexerid, attrMap['hydraindexerid'], item.hydraIndexerId, item.hydraindexerid, indexer) || 'nzbhydra';

    const guidRaw = item.guid || item['guid'];
    let guidValue = null;
    if (typeof guidRaw === 'string') {
      guidValue = guidRaw;
    } else if (guidRaw && typeof guidRaw === 'object') {
      guidValue = guidRaw._ || guidRaw['#text'] || guidRaw.url || guidRaw.href || null;
    }

    results.push({
      title: title || downloadUrl,
      downloadUrl,
      guid: guidValue,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
      indexer,
      indexerId
    });
  }

  return results;
}

/**
 * Execute search against NZBHydra
 * @param {object} plan - Search plan
 * @param {object} options - Search options
 * @param {Array<number>} options.selectedIndexers - Array of selected indexer names
 * @param {object} options.selectedCategories - Category selections (not used by NZBHydra API)
 * @returns {Promise<Array>} Search results
 */
async function executeSearch(plan, options = {}) {
  const params = buildHydraSearchParams(plan, options);

  console.log('[NZBHYDRA] Executing search with params:', JSON.stringify(params, null, 2));

  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api`, {
    params,
    timeout: 60000
  });

  return normalizeHydraResults(response.data);
}

module.exports = {
  mapHydraSearchType,
  applyTokenToHydraParams,
  buildHydraSearchParams,
  extractHydraAttrMap,
  normalizeHydraResults,
  executeSearch
};
