const axios = require('axios');

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
};
