// Special metadata service - External catalog provider integration
const externalApi = require('../utils/externalApi');
const { cleanSpecialSearchTitle, stripTrailingSlashes } = require('../utils/parsers');

// Configuration
const OBFUSCATED_SPECIAL_PROVIDER_URL = 'aHR0cHM6Ly9kaXJ0eS1waW5rLmVycy5wdw==';
const OBFUSCATED_SPECIAL_ID_PREFIX = 'cG9ybmRi';

function decodeBase64Value(encoded) {
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const SPECIAL_ID_PREFIX = decodeBase64Value(OBFUSCATED_SPECIAL_ID_PREFIX) || String.fromCharCode(112, 111, 114, 110, 100, 98);
const specialCatalogPrefixes = new Set(['pt', SPECIAL_ID_PREFIX]);

const EXTERNAL_SPECIAL_PROVIDER_URL = (() => {
  const decoded = decodeBase64Value(OBFUSCATED_SPECIAL_PROVIDER_URL);
  return decoded ? stripTrailingSlashes(decoded) : '';
})();

function ensureSpecialProviderConfigured() {
  if (!EXTERNAL_SPECIAL_PROVIDER_URL) {
    throw new Error('External metadata provider URL is not configured');
  }
}

async function fetchSpecialMetadata(identifier) {
  ensureSpecialProviderConfigured();
  const trimmedBase = stripTrailingSlashes(EXTERNAL_SPECIAL_PROVIDER_URL);
  const requestUrl = `${trimmedBase}/stream/movie/${encodeURIComponent(identifier)}.json`;
  console.log('[SPECIAL META] Fetching metadata for external catalog request');

  const response = await externalApi.get(requestUrl, { service: 'specialmetadata', timeout: 10000 });
  const streams = response.data?.streams;
  const firstTitle = Array.isArray(streams) && streams.length > 0 ? streams[0]?.title : null;

  const cleanedTitle = cleanSpecialSearchTitle(firstTitle);
  if (!cleanedTitle) {
    throw new Error('External metadata provider returned no usable title');
  }

  return {
    title: cleanedTitle
  };
}

module.exports = {
  SPECIAL_ID_PREFIX,
  specialCatalogPrefixes,
  EXTERNAL_SPECIAL_PROVIDER_URL,
  ensureSpecialProviderConfigured,
  fetchSpecialMetadata,
};
