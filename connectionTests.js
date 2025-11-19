const axios = require('axios');
function isTruthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(s);
}
const IS_DEBUG_NEWZNAB = isTruthyEnv(process.env.DEBUG_NEWZNAB_TEST) || isTruthyEnv(process.env.DEBUG_NEWZNAB_SEARCH);

function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function safeParams(params) {
  if (!params || typeof params !== 'object') return params;
  const clone = { ...params };
  if (clone.apikey) clone.apikey = maskKey(clone.apikey);
  if (clone['api_key']) clone['api_key'] = maskKey(clone['api_key']);
  return clone;
}

function summarizeBody(data, maxLen = 500) {
  try {
    if (data == null) return '(no body)';
    if (typeof data === 'string') {
      const s = data.replace(/\s+/g, ' ').trim();
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    }
    const json = JSON.stringify(data);
    return json.length > maxLen ? json.slice(0, maxLen) + '…' : json;
  } catch (_) {
    return '(unserializable body)';
  }
}

function debugNewznabStep(step, { url, params, status, headers, body, note }) {
  if (!IS_DEBUG_NEWZNAB) return;
  const ct = (headers && (headers['content-type'] || headers['Content-Type'])) || '';
  console.log('[NEWZNAB-TEST]', step, {
    url,
    params: safeParams(params),
    status,
    contentType: ct,
    body: summarizeBody(body, 400),
    note: note || undefined,
  });
}

function looksLikeAuthErrorPayload(data) {
  if (!data) return false;
  // If payload is a string (HTML, text, or stringified JSON), look for keywords
  if (typeof data === 'string') {
    const s = data.toLowerCase();
    return s.includes('apikey') || s.includes('api key') || s.includes('unauthor') || s.includes('forbidden');
  }
  // If payload is an object, check common fields
  const fieldsToCheck = [];
  if (typeof data.error !== 'undefined') fieldsToCheck.push(data.error);
  if (typeof data.Error !== 'undefined') fieldsToCheck.push(data.Error);
  if (typeof data.message !== 'undefined') fieldsToCheck.push(data.message);
  if (typeof data.description !== 'undefined') fieldsToCheck.push(data.description);
  const attr = data['@attributes'] || data.attributes || null;
  if (attr && typeof attr.message !== 'undefined') fieldsToCheck.push(attr.message);
  for (const f of fieldsToCheck) {
    if (!f) continue;
    if (typeof f === 'string') {
      const s = f.toLowerCase();
      if (s.includes('apikey') || s.includes('api key') || s.includes('unauthor') || s.includes('forbidden')) return true;
    } else if (typeof f === 'object') {
      if (looksLikeAuthErrorPayload(f)) return true;
    }
  }
  return false;
}

function accountStatusIndicatesInvalid(data) {
  // Checks for provider-specific account status markers indicating invalid or unauthorized
  try {
    if (!data) return false;
    // String payload: look for status:"invalid" or explicit messages
    if (typeof data === 'string') {
      const s = data.toLowerCase();
      if (s.includes('status') && s.includes('invalid')) return true;
      if (s.includes('invalid api key') || s.includes('incorrect api key')) return true;
      if (s.includes('invalid account') || s.includes('account invalid')) return true;
      return false;
    }
    // JSON-like: look for channel.account['@attributes'].status or similar
    const getAttr = (obj, key) => (obj && (obj[key] || obj["@" + key] || obj["@" + key.charAt(0).toUpperCase() + key.slice(1)]));
    const channel = data.channel || data.Channel || null;
    const account = (channel && (channel.account || channel.Account)) || data.account || data.Account || null;
    const attrs = (account && (account['@attributes'] || account.attributes || account.$)) || null;
    const status = (attrs && (attrs.status || attrs.Status)) || account?.status || account?.Status || null;
    if (status && typeof status === 'string') {
      const st = status.toLowerCase();
      if (st.includes('invalid') || st.includes('expired') || st.includes('disabled') || st.includes('banned')) return true;
    }
    // Fallback: stringify a small portion and check again
    try {
      const snippet = JSON.stringify(data).toLowerCase();
      if (snippet.includes('account') && snippet.includes('status') && snippet.includes('invalid')) return true;
    } catch (_) {}
    return false;
  } catch (_) {
    return false;
  }
}


let NNTPClientCtor = null;
try {
  const nntpModule = require('nntp/lib/nntp');
  NNTPClientCtor = typeof nntpModule === 'function' ? nntpModule : nntpModule?.NNTP || null;
} catch (error) {
  NNTPClientCtor = null;
}

function sanitizeBaseUrl(input) {
  if (!input) return '';
  return String(input).trim().replace(/\/+$/, '');
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function formatVersionLabel(prefix, version) {
  if (!version) return prefix;
  const normalized = String(version).trim();
  if (!normalized) return prefix;
  return `${prefix} (v${normalized.replace(/^v/i, '')})`;
}

async function testIndexerConnection(values) {
  const managerType = String(values?.INDEXER_MANAGER || 'prowlarr').trim().toLowerCase() || 'prowlarr';
  const baseUrl = sanitizeBaseUrl(values?.INDEXER_MANAGER_URL);
  if (!baseUrl) throw new Error('Indexer URL is required');
  const apiKey = (values?.INDEXER_MANAGER_API_KEY || '').trim();
  const timeout = 8000;

  if (managerType === 'prowlarr') {
    if (!apiKey) throw new Error('API key is required for Prowlarr');
    const response = await axios.get(`${baseUrl}/api/v1/system/status`, {
      headers: { 'X-Api-Key': apiKey },
      timeout,
      validateStatus: () => true,
    });
    if (response.status === 200) {
      const version = response.data?.version || response.data?.appVersion || null;
      return formatVersionLabel('Connected to Prowlarr', version);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Unauthorized: check Prowlarr API key');
    }
    throw new Error(`Unexpected response ${response.status} from Prowlarr`);
  }

  // NZBHydra uses /api endpoint with query parameters for all operations
  const params = { t: 'caps', o: 'json' };
  if (apiKey) params.apikey = apiKey;
  
  const response = await axios.get(`${baseUrl}/api`, {
    params,
    timeout,
    validateStatus: () => true,
  });
  
  if (response.status === 200) {
    // Successful response from NZBHydra API
    // Try to extract version from various possible response formats
    let version = null;
    if (response.data?.version) {
      version = response.data.version;
    } else if (response.data?.server?.version) {
      version = response.data.server.version;
    } else if (response.data?.['@attributes']?.version) {
      version = response.data['@attributes'].version;
    }
    return formatVersionLabel('Connected to NZBHydra', version);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized: check NZBHydra API key');
  }
  if (response.status === 400) {
    throw new Error('Bad request to NZBHydra - verify URL format and API key');
  }
  throw new Error(`Unexpected response ${response.status} from NZBHydra`);
}

function collectNumberedNewznab(values) {
  const list = [];
  for (let i = 1; i <= 20; i += 1) {
    const idx = String(i).padStart(2, '0');
    const endpoint = (values?.[`NEWZNAB_ENDPOINT_${idx}`] || '').trim();
    if (!endpoint) continue;
    const apiKey = (values?.[`NEWZNAB_API_KEY_${idx}`] || '').trim();
    let apiPath = (values?.[`NEWZNAB_API_PATH_${idx}`] || '/api').trim();
    if (!apiPath.startsWith('/')) apiPath = `/${apiPath}`;
    apiPath = apiPath.replace(/\/+$/, '');
    const name = (values?.[`NEWZNAB_NAME_${idx}`] || '').trim();
    const enabled = parseBoolean(values?.[`NEWZNAB_INDEXER_ENABLED_${idx}`] ?? 'true');
    if (enabled === false) continue;
    list.push({ endpoint: endpoint.replace(/\/+$/, ''), apiKey, apiPath, name });
  }
  return list;
}

async function testNewznabConnection(values) {
  const enabled = String(values?.NEWZNAB_ENABLED || '').trim().toLowerCase();
  const isEnabled = ['1','true','yes','on'].includes(enabled);
  if (!isEnabled) {
    throw new Error('NEWZNAB_ENABLED is not true');
  }

  const configs = collectNumberedNewznab(values);

  if (configs.length === 0) {
    throw new Error('Configure at least one direct Newznab indexer (NEWZNAB_ENDPOINT_01, API_PATH_01, API_KEY_01 if needed)');
  }

  if (IS_DEBUG_NEWZNAB) {
    console.log('[NEWZNAB-TEST] configs', configs.map((c) => ({
      name: c.name || null,
      endpoint: c.endpoint,
      apiPath: c.apiPath,
      hasApiKey: !!(c.apiKey && String(c.apiKey).trim()),
      apiKeyMasked: maskKey(c.apiKey || ''),
    })));
  }

  // Enforce API key presence for all configured endpoints
  const missingKey = configs.filter((c) => !c.apiKey || String(c.apiKey).trim() === '');
  if (missingKey.length > 0) {
    const names = missingKey.map((c) => c.name || c.endpoint).join(', ');
    throw new Error(`API key is required for Newznab endpoint(s): ${names}`);
  }

  const timeout = 8000;
  let successes = 0;
  const details = [];

  for (const cfg of configs) {
    const base = cfg.endpoint;
    const apiKey = cfg.apiKey || '';
    const apiPath = cfg.apiPath || '/api';
    try {
      // 1) Connectivity check via caps (may be public on some indexers)
      const capsParams = { t: 'caps', o: 'json' };
      if (apiKey) capsParams.apikey = apiKey;
      const url = `${base}${apiPath}`;
      const capsResp = await axios.get(url, { params: capsParams, timeout, validateStatus: () => true });
      debugNewznabStep('caps', { url, params: capsParams, status: capsResp.status, headers: capsResp.headers || {}, body: capsResp.data });
      if (capsResp.status === 401 || capsResp.status === 403) {
        debugNewznabStep('caps-unauthorized', { url, params: capsParams, status: capsResp.status, headers: capsResp.headers || {}, body: capsResp.data, note: 'caps returned unauthorized' });
        throw new Error('Unauthorized');
      }
      if (capsResp.status >= 400) {
        debugNewznabStep('caps-error', { url, params: capsParams, status: capsResp.status, headers: capsResp.headers || {}, body: capsResp.data, note: 'caps returned error status' });
        throw new Error(`Status ${capsResp.status}`);
      }
      let version = null;
      const capsData = capsResp.data || {};
      version = capsData.version || capsData.appVersion || capsData.server?.version || capsData['@attributes']?.version || null;

      // 2) If an API key is provided, verify a key-gated endpoint.
      if (apiKey) {
        // A) Try an authenticated search which many providers protect
        const searchParams = { t: 'search', q: 'authcheck', limit: 1, o: 'json', apikey: apiKey };
        const searchResp = await axios.get(url, { params: searchParams, timeout, validateStatus: () => true });
        debugNewznabStep('search-auth', { url, params: searchParams, status: searchResp.status, headers: searchResp.headers || {}, body: searchResp.data });
        const ctSearch = String(searchResp.headers?.['content-type'] || '').toLowerCase();
        const searchLooksUnauthorized =
          searchResp.status === 401 ||
          searchResp.status === 403 ||
          looksLikeAuthErrorPayload(searchResp.data) ||
          (typeof searchResp.data === 'string' && searchResp.data.toLowerCase().includes('<html') && (searchResp.data.toLowerCase().includes('login') || searchResp.data.toLowerCase().includes('unauthor')));

        if (searchLooksUnauthorized) {
          debugNewznabStep('search-auth-fail', { url, params: searchParams, status: searchResp.status, headers: searchResp.headers || {}, body: searchResp.data, note: 'authenticated search indicates unauthorized' });
          throw new Error('Unauthorized: API key invalid');
        }

        // NZBGeek and some providers return JSON with channel.account status set to Invalid
        if (accountStatusIndicatesInvalid(searchResp.data)) {
          debugNewznabStep('search-auth-fail', { url, params: searchParams, status: searchResp.status, headers: searchResp.headers || {}, body: searchResp.data, note: 'account status indicates invalid' });
          throw new Error('Unauthorized: API key invalid');
        }

        // If content-type is clearly not JSON/XML/RSS, treat as failure when key is present
        if (!(ctSearch.includes('json') || ctSearch.includes('xml') || ctSearch.includes('rss') || ctSearch.includes('atom'))) {
          debugNewznabStep('search-auth-fail', { url, params: searchParams, status: searchResp.status, headers: searchResp.headers || {}, body: searchResp.data, note: 'unexpected content-type for authenticated request' });
          throw new Error('Unauthorized: unexpected response for authenticated request');
        }

        // B) Fallback to a getnzb call with fake id to catch providers that guard only downloads
        const authParams = { t: 'getnzb', id: 'invalid-id-for-auth-check', o: 'json', apikey: apiKey };
        const authResp = await axios.get(url, { params: authParams, timeout, validateStatus: () => true });
        debugNewznabStep('getnzb-api', { url, params: authParams, status: authResp.status, headers: authResp.headers || {}, body: authResp.data });
        const authLooksUnauthorized =
          authResp.status === 401 ||
          authResp.status === 403 ||
          looksLikeAuthErrorPayload(authResp.data) ||
          (typeof authResp.data === 'string' && authResp.data.toLowerCase().includes('<html') && (authResp.data.toLowerCase().includes('login') || authResp.data.toLowerCase().includes('unauthor')));
        if (authLooksUnauthorized) {
          debugNewznabStep('getnzb-api-fail', { url, params: authParams, status: authResp.status, headers: authResp.headers || {}, body: authResp.data, note: 'getnzb via /api indicates unauthorized' });
          throw new Error('Unauthorized: API key invalid');
        }

        if (accountStatusIndicatesInvalid(authResp.data)) {
          debugNewznabStep('getnzb-api-fail', { url, params: authParams, status: authResp.status, headers: authResp.headers || {}, body: authResp.data, note: 'account status indicates invalid' });
          throw new Error('Unauthorized: API key invalid');
        }

        // C) Some providers expose a /getnzb path outside /api; probe that too
        const directGetUrl = `${base.replace(/\/+$/, '')}/getnzb`;
        const directResp = await axios.get(directGetUrl, { params: { id: 'invalid-id-for-auth-check', apikey: apiKey }, timeout, validateStatus: () => true });
        debugNewznabStep('getnzb-direct', { url: directGetUrl, params: { id: 'invalid-id-for-auth-check', apikey: apiKey }, status: directResp.status, headers: directResp.headers || {}, body: directResp.data });
        const directLooksUnauthorized =
          directResp.status === 401 ||
          directResp.status === 403 ||
          looksLikeAuthErrorPayload(directResp.data) ||
          (typeof directResp.data === 'string' && directResp.data.toLowerCase().includes('<html') && (directResp.data.toLowerCase().includes('login') || directResp.data.toLowerCase().includes('unauthor')));
        if (directLooksUnauthorized) {
          debugNewznabStep('getnzb-direct-fail', { url: directGetUrl, params: { id: 'invalid-id-for-auth-check', apikey: apiKey }, status: directResp.status, headers: directResp.headers || {}, body: directResp.data, note: 'getnzb direct indicates unauthorized' });
          throw new Error('Unauthorized: API key invalid');
        }
      }

      successes += 1;
      const label = cfg.name || base;
      details.push(`${label} OK${version ? ` (v${String(version).replace(/^v/i,'')})` : ''}`);
    } catch (err) {
      const label = cfg.name || base;
      details.push(`${label} ERR: ${err?.message || 'unknown error'}`);
    }
  }

  if (successes === 0) {
    throw new Error(`No Newznab endpoints reachable: ${details.join('; ')}`);
  }
  return `Connected to ${successes}/${configs.length} Newznab endpoints: ${details.join('; ')}`;
}

function countNewznabItems(data) {
  try {
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    const channel = data.channel || data.Channel || data.rss?.channel || data.RSS?.channel || null;
    if (channel) {
      const item = channel.item || channel.Item || channel.items || channel.Items || null;
      if (!item) return 0;
      if (Array.isArray(item)) return item.length;
      return 1;
    }
    if (data.items && Array.isArray(data.items)) return data.items.length;
    return 0;
  } catch (_) {
    return 0;
  }
}

function extractSomeTitles(data, limit = 5) {
  try {
    const titles = [];
    const pushTitle = (obj) => {
      if (!obj) return;
      const t = obj.title || obj.Title || obj.name || obj.Name || null;
      if (t && typeof t === 'string') titles.push(t);
    };
    if (Array.isArray(data)) {
      data.slice(0, limit).forEach(pushTitle);
      return titles;
    }
    const channel = data.channel || data.Channel || data.rss?.channel || data.RSS?.channel || null;
    if (channel) {
      const items = channel.item || channel.Item || channel.items || channel.Items || [];
      const arr = Array.isArray(items) ? items : [items];
      arr.slice(0, limit).forEach(pushTitle);
      return titles;
    }
    if (Array.isArray(data.items)) {
      data.items.slice(0, limit).forEach(pushTitle);
      return titles;
    }
    return titles;
  } catch (_) {
    return [];
  }
}

async function testNewznabSearch(values) {
  const enabled = String(values?.NEWZNAB_ENABLED || '').trim().toLowerCase();
  const isEnabled = ['1','true','yes','on'].includes(enabled);
  // We allow searches even if not globally enabled, since the test is explicit

  const configs = collectNumberedNewznab(values);
  if (configs.length === 0) {
    throw new Error('Configure at least one direct Newznab indexer (NEWZNAB_ENDPOINT_01, API_PATH_01, API_KEY_01) to run a test search');
  }

  // Require keys for all provided endpoints for search
  const missingKey = configs.filter((c) => !c.apiKey || String(c.apiKey).trim() === '');
  if (missingKey.length > 0) {
    const names = missingKey.map((c) => c.name || c.endpoint).join(', ');
    throw new Error(`API key is required for Newznab endpoint(s): ${names}`);
  }

  const t = (values?.NEWZNAB_TEST_TYPE || 'search').toString().trim().toLowerCase() || 'search';
  const q = (values?.NEWZNAB_TEST_QUERY || '').toString().trim();
  if (IS_DEBUG_NEWZNAB) {
    console.log('[NEWZNAB-TEST] starting search', { type: t, query: q, endpoints: configs.map(c => c.endpoint) });
  }
  const timeout = 12000;
  let successes = 0;
  const details = [];

  for (const cfg of configs) {
    const url = `${cfg.endpoint}${cfg.apiPath || '/api'}`.replace(/\/+$/, '');
    const params = { t, o: 'json', apikey: cfg.apiKey };
    if (q) params.q = q;
    try {
      debugNewznabStep('search', { url, params, status: undefined, headers: {}, body: null });
      const resp = await axios.get(url, { params, timeout, validateStatus: () => true });
      debugNewznabStep('search-resp', { url, params, status: resp.status, headers: resp.headers || {}, body: resp.data });
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Unauthorized');
      }
      if (resp.status >= 400) {
        throw new Error(`Status ${resp.status}`);
      }
      const count = countNewznabItems(resp.data);
      const titles = extractSomeTitles(resp.data, 4);
      successes += 1;
      const label = cfg.name || cfg.endpoint;
      details.push(`${label}: ${count} items${titles.length ? ` — ${titles.join(' | ')}` : ''}`);
    } catch (err) {
      const label = cfg.name || cfg.endpoint;
      details.push(`${label}: ERR ${err?.message || 'unknown error'}`);
    }
  }

  if (successes === 0) {
    throw new Error(`Search failed for all Newznab endpoints: ${details.join('; ')}`);
  }
  return `Search OK for ${successes}/${configs.length} endpoint(s): ${details.join('; ')}`;
}

async function testNzbdavConnection(values) {
  const baseUrl = sanitizeBaseUrl(values?.NZBDAV_URL || values?.NZBDAV_WEBDAV_URL);
  if (!baseUrl) throw new Error('NZBDav URL is required');
  const apiKey = (values?.NZBDAV_API_KEY || '').trim();
  if (!apiKey) throw new Error('NZBDav API key is required');
  const timeout = 8000;

  const attempts = [
    {
      url: `${baseUrl}/sabnzbd/api`,
      params: { mode: 'queue', output: 'json', apikey: apiKey },
    },
    {
      url: `${baseUrl}/api`,
      params: { mode: 'queue', output: 'json', apikey: apiKey },
    },
    {
      url: `${baseUrl}/sabnzbd/api`,
      params: { mode: 'version', apikey: apiKey },
    },
    {
      url: `${baseUrl}/api`,
      params: { mode: 'version', apikey: apiKey },
    },
  ];

  let lastIssue = null;

  for (const attempt of attempts) {
    try {
      const response = await axios.get(attempt.url, {
        params: attempt.params,
        timeout,
        validateStatus: () => true,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error('Unauthorized: check NZBDav API key');
      }
      if (response.status >= 400) {
        let pathName = '/api';
        try {
          pathName = new URL(attempt.url).pathname;
        } catch (_) {
          pathName = attempt.url;
        }
        lastIssue = new Error(`${pathName} returned status ${response.status}`);
        continue;
      }

      const payload = response.data || {};
      if (payload.status === false || payload?.error) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'NZBDav rejected credentials');
      }

      const version = payload?.queue?.version || payload?.version || payload?.server_version || payload?.appVersion;
      return formatVersionLabel('Connected to NZBDav/SAB API', version);
    } catch (error) {
      lastIssue = error;
    }
  }

  throw lastIssue || new Error('Unable to reach NZBDav');
}

async function testUsenetConnection(values) {
  if (!NNTPClientCtor) throw new Error('NNTP client library unavailable on server');
  const host = (values?.NZB_TRIAGE_NNTP_HOST || '').trim();
  if (!host) throw new Error('Usenet provider host is required');
  const portValue = Number(values?.NZB_TRIAGE_NNTP_PORT);
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 119;
  const useTLS = parseBoolean(values?.NZB_TRIAGE_NNTP_TLS);
  const user = (values?.NZB_TRIAGE_NNTP_USER || '').trim();
  const pass = (values?.NZB_TRIAGE_NNTP_PASS || '').trim();
  const timeoutMs = 8000;

  return new Promise((resolve, reject) => {
    const client = new NNTPClientCtor();
    let settled = false;
    let reachedReady = false;
    let streamRef = null;

    const cleanup = () => {
      if (streamRef && typeof streamRef.removeListener === 'function') {
        streamRef.removeListener('error', onClientError);
      }
      client.removeListener('error', onClientError);
      client.removeListener('close', onClientClose);
      client.removeListener('ready', onClientReady);
    };

    const finalize = (err, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      try {
        if (reachedReady && typeof client.quit === 'function') {
          client.quit(() => client.end());
        } else if (typeof client.end === 'function') {
          client.end();
        }
      } catch (_) {
        try { client.end(); } catch (__) { /* noop */ }
      }
      if (err) reject(err);
      else resolve(message);
    };

    const onClientReady = () => {
      reachedReady = true;
      finalize(null, 'Connected to Usenet provider successfully');
    };

    const onClientError = (err) => {
      finalize(new Error(err?.message || 'NNTP error'));
    };

    const onClientClose = () => {
      if (!settled) finalize(new Error('Connection closed before verification'));
    };

    const timer = setTimeout(() => {
      finalize(new Error('Connection timed out'));
    }, timeoutMs);

    client.once('ready', onClientReady);
    client.once('error', onClientError);
    client.once('close', onClientClose);

    try {
      streamRef = client.connect({
        host,
        port,
        secure: useTLS,
        user: user || undefined,
        password: pass || undefined,
        connTimeout: timeoutMs,
      });
      if (streamRef && typeof streamRef.on === 'function') {
        streamRef.on('error', onClientError);
      }
    } catch (error) {
      finalize(error);
    }
  });
}

module.exports = {
  testIndexerConnection,
  testNzbdavConnection,
  testUsenetConnection,
  testNewznabConnection,
  testNewznabSearch,
};
