const axios = require('axios');
const FormData = require('form-data');

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : fallback;
}

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(getEnv('UPSTREAM_HEALTH_TIMEOUT_MS', '5000'));
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
})();

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getEnv('UPSTREAM_HEALTH_TOKEN');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Health-Token'] = token; // support either header per upstream config
  }
  return headers;
}

async function queryHealth({ baseUrl, nzbPayload, filename, provider, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!baseUrl || !provider || !nzbPayload) return null;
  try {
    const form = new FormData();
    const buffer = Buffer.isBuffer(nzbPayload) ? nzbPayload : Buffer.from(String(nzbPayload), 'utf8');
    const safeName = filename && typeof filename === 'string' && filename.trim() ? filename.trim() : 'release.nzb';
    form.append('nzb', buffer, { filename: safeName, contentType: 'application/x-nzb' });
    form.append('provider', provider);
    const headers = { ...form.getHeaders(), ...buildHeaders() };
    const url = baseUrl.replace(/\/$/, '') + '/api/v1/health/check';
    const res = await axios.post(url, form, { headers, timeout: timeoutMs });
    return res.data;
  } catch (err) {
    return null; // treat upstream health as optional; failures should not block local triage
  }
}

async function writeHealth({ baseUrl, provider, isHealthy, nzbPayload = null, filename = 'release.nzb', segmentHash = null, segmentAnchor = null, details = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!baseUrl || !provider || typeof isHealthy !== 'boolean') return null;
  try {
    const form = new FormData();
    form.append('provider', provider);
    form.append('is_healthy', String(isHealthy));
    if (segmentHash) form.append('segment_hash', segmentHash);
    if (segmentAnchor) form.append('segment_anchor', segmentAnchor);
    if (details) form.append('details', String(details));
    if (nzbPayload && !segmentHash && !segmentAnchor) {
      const buffer = Buffer.isBuffer(nzbPayload) ? nzbPayload : Buffer.from(String(nzbPayload), 'utf8');
      const safeName = filename && typeof filename === 'string' && filename.trim() ? filename.trim() : 'release.nzb';
      form.append('nzb', buffer, { filename: safeName, contentType: 'application/x-nzb' });
    }
    const headers = { ...form.getHeaders(), ...buildHeaders() };
    const url = baseUrl.replace(/\/$/, '') + '/api/v1/health/check';
    const res = await axios.post(url, form, { headers, timeout: timeoutMs });
    return res.data;
  } catch (err) {
    return null;
  }
}

module.exports = {
  queryHealth,
  writeHealth,
};
