const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const {
  getNewznabConfigsFromValues,
  filterUsableConfigs,
  searchNewznabIndexers,
  validateNewznabSearch,
} = require('../services/newznab');

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

const NEWZNAB_DEBUG_ENABLED = (parseBoolean(process.env.DEBUG_NEWZNAB_TEST) || parseBoolean(process.env.DEBUG_NEWZNAB_SEARCH))
  && !parseBoolean(process.env.DISABLE_NEWZNAB_TEST_LOGS);

const TEST_NZB_FILE_NAME = 'Test_Passed_ignore_failure.nzb';
const TEST_NZB_FILE_PATH = path.resolve(__dirname, '../../assets', TEST_NZB_FILE_NAME);
let cachedDiagnosticNzbBuffer = null;

async function getDiagnosticNzbBuffer() {
  if (cachedDiagnosticNzbBuffer) return cachedDiagnosticNzbBuffer;
  try {
    cachedDiagnosticNzbBuffer = await fs.promises.readFile(TEST_NZB_FILE_PATH);
    return cachedDiagnosticNzbBuffer;
  } catch (error) {
    throw new Error('Diagnostic NZB asset missing or unreadable');
  }
}

function resolveNzbdavTestCategory(values) {
  const override = (values?.NZBDAV_CATEGORY || '').trim();
  if (override) return `${override}_MOVIE`;
  const movieCategory = (values?.NZBDAV_CATEGORY_MOVIES || '').trim();
  if (movieCategory) return movieCategory;
  const defaultCategory = (values?.NZBDAV_CATEGORY_DEFAULT || '').trim();
  if (defaultCategory) return defaultCategory;
  return 'Movies';
}

async function verifyNzbdavDiagnosticUpload({ baseUrl, apiKey, category }) {
  const nzbBuffer = await getDiagnosticNzbBuffer();
  const form = new FormData();
  form.append('nzbfile', nzbBuffer, {
    filename: `UsenetStreamer_Diagnostic_${Date.now()}.nzb`,
    contentType: 'application/x-nzb+xml',
  });

  const params = {
    mode: 'addfile',
    output: 'json',
    apikey: apiKey,
    nzbname: 'UsenetStreamer Diagnostic NZB',
  };
  if (category) params.cat = category;

  const headers = {
    ...form.getHeaders(),
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await axios.post(`${baseUrl}/api`, form, {
    params,
    headers,
    timeout: 15000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('NZBDav rejected API key during diagnostic upload');
  }
  if (response.status >= 500) {
    throw new Error(`NZBDav returned status ${response.status} during diagnostic upload`);
  }

  const payload = response.data || {};
  if (payload?.status) {
    return 'diagnostic NZB accepted';
  }

  const errorText = (payload?.error || payload?.message || '').toString();
  if (errorText) {
    const lowered = errorText.toLowerCase();
    if (lowered.includes('unsupported') || lowered.includes('archive')) {
      return errorText;
    }
  }

  throw new Error(errorText || 'NZBDav rejected diagnostic NZB upload');
}

function logNewznabDebug(message, context = null) {
  if (!NEWZNAB_DEBUG_ENABLED) return;
  if (context && Object.keys(context).length > 0) {
    console.log(`[NEWZNAB][TEST][DEBUG] ${message}`, context);
  } else {
    console.log(`[NEWZNAB][TEST][DEBUG] ${message}`);
  }
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

async function testNzbdavConnection(values) {
  const baseUrl = sanitizeBaseUrl(values?.NZBDAV_URL || values?.NZBDAV_WEBDAV_URL);
  if (!baseUrl) throw new Error('NZBDav URL is required');
  const apiKey = (values?.NZBDAV_API_KEY || '').trim();
  if (!apiKey) throw new Error('NZBDav API key is required');
  const webdavUrl = sanitizeBaseUrl(values?.NZBDAV_WEBDAV_URL || values?.NZBDAV_URL);
  const webdavUser = (values?.NZBDAV_WEBDAV_USER || '').trim();
  const webdavPass = (values?.NZBDAV_WEBDAV_PASS || '').trim();
  if (!webdavUrl) throw new Error('NZBDav WebDAV URL is required');
  if (!webdavUser || !webdavPass) throw new Error('NZBDav WebDAV username/password are required');
  const timeout = 8000;

  try {
    const diagnosticCategory = resolveNzbdavTestCategory(values);
    const diagnosticNote = await verifyNzbdavDiagnosticUpload({
      baseUrl,
      apiKey,
      category: diagnosticCategory,
    });

    const webdavResponse = await axios.request({
      method: 'PROPFIND',
      url: `${webdavUrl}/`,
      auth: {
        username: webdavUser,
        password: webdavPass,
      },
      headers: {
        'Depth': '0',
      },
      timeout,
      maxRedirects: 0,
      validateStatus: () => true,
    });

    if (webdavResponse.status === 401 || webdavResponse.status === 403) {
      throw new Error('WebDAV authentication failed: check username/password');
    }
    if (webdavResponse.status >= 400) {
      throw new Error(`WebDAV endpoint returned status ${webdavResponse.status}`);
    }
    // PROPFIND should return 207 Multi-Status for valid WebDAV; anything else is suspicious
    if (webdavResponse.status !== 207 && webdavResponse.status !== 200) {
      throw new Error(`Unexpected WebDAV response status ${webdavResponse.status} (expected 207)`);
    }

    const diagnosticMessage = diagnosticNote
      ? `Diagnostic NZB upload verified (${diagnosticNote})`
      : 'Diagnostic NZB upload verified';

    return `WebDAV reachable; ${diagnosticMessage}`;
  } catch (error) {
    throw error;
  }
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

async function testNewznabConnection(values) {
  const configs = filterUsableConfigs(
    getNewznabConfigsFromValues(values, { includeEmpty: true }),
    { requireEnabled: true, requireApiKey: true }
  );
  if (!configs.length) {
    throw new Error('At least one enabled Newznab indexer with an API key is required');
  }
  const results = [];
  for (const config of configs) {
    const message = await validateNewznabSearch(config, {
      debug: NEWZNAB_DEBUG_ENABLED,
      label: `[NEWZNAB][${config.displayName || config.id}]`,
      query: values?.NEWZNAB_TEST_QUERY || 'usenetstreamer',
    });
    results.push(`${config.displayName || 'Newznab'}: ${message}`);
  }
  return results.join('; ');
}

async function testNewznabSearch(values) {
  const configs = filterUsableConfigs(
    getNewznabConfigsFromValues(values, { includeEmpty: true }),
    { requireEnabled: true, requireApiKey: true }
  );
  if (!configs.length) {
    throw new Error('Configure at least one enabled Newznab indexer (endpoint + API key) before running a test search');
  }
  const type = String(values?.NEWZNAB_TEST_TYPE || 'search').trim().toLowerCase() || 'search';
  const query = (values?.NEWZNAB_TEST_QUERY || '').trim();
  if (!query) {
    throw new Error('Provide a query before running a Newznab test search');
  }
  const plan = {
    type,
    query,
    rawQuery: query,
    tokens: [],
  };
  logNewznabDebug('Running admin Newznab test search', {
    plan,
    indexers: configs.map((config) => ({ id: config.id, name: config.displayName, endpoint: config.endpoint })),
  });
  const result = await searchNewznabIndexers(plan, configs, {
    filterNzbOnly: true,
    debug: NEWZNAB_DEBUG_ENABLED,
    label: '[NEWZNAB][TEST]',
  });
  logNewznabDebug('Admin Newznab test search completed', {
    totalResults: result?.results?.length || 0,
    endpoints: result?.endpoints || [],
    errors: result?.errors || [],
  });
  const total = result.results.length;
  const summaries = result.endpoints
    .map((endpoint) => `${endpoint.name}: ${endpoint.count}`)
    .join(', ');
  const sampleTitles = result.results
    .map((item) => item?.title)
    .filter(Boolean)
    .slice(0, 3);
  const baseMessage = total > 0
    ? `Found ${total} NZB${total === 1 ? '' : 's'} across ${result.endpoints.length} endpoint${result.endpoints.length === 1 ? '' : 's'}`
    : `No NZBs found for "${query}"`;
  const sampleMessage = sampleTitles.length ? ` Sample titles: ${sampleTitles.join(' | ')}` : '';
  const errorMessage = result.errors?.length ? ` Errors: ${result.errors.join('; ')}` : '';
  return `${baseMessage}${summaries ? ` (${summaries})` : ''}.${sampleMessage}${errorMessage}`.trim();
}

module.exports = {
  testIndexerConnection,
  testNzbdavConnection,
  testUsenetConnection,
  testNewznabConnection,
  testNewznabSearch,
};
