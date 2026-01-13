const axios = require('axios');
// Import version from package.json or define a constant
const ADDON_VERSION = require('../../package.json').version || '1.0.0';

// Get the User-Agent string from environment variables and remove extra spaces
const globalUa = (process.env.ADDON_USER_AGENT_GLOBAL || '').trim();
// Define a default User-Agent if none is provided 
const defaultUa = `UsenetStreamer/${ADDON_VERSION}`;
// Define the baseline UA to simplify logic. Priority: Global Env Var > Default
const baselineUa = globalUa || defaultUa;

// Log the baseline UA at startup
console.log('[USERAGENT] Baseline User-Agent:', baselineUa);

// Initialize a configuration object with the baseline UA
const config = {
  headers: { 
    'User-Agent': baselineUa
  }
};

// Create the isolated instance
const externalApi = axios.create(config);

/**
 * SMART INTERCEPTOR
 * This runs automatically before every request to check for service-specific overrides.
 * 
 * Services: 
 *      ADDON_USER_AGENT_GLOBAL
 *      ADDON_USER_AGENT_EASYNEWS
 *      ADDON_USER_AGENT_INDEXER
 *      ADDON_USER_AGENT_NEWZNAB
 *      ADDON_USER_AGENT_NZBDAV
 *      ADDON_USER_AGENT_SPECIALMETADATA
 *      ADDON_USER_AGENT_TMDB
 *      ADDON_USER_AGENT_TRIAGE 
 */

externalApi.interceptors.request.use((config) => {

  // Skip the intercept if the caller explicitly provided a custom User-Agent
  if (config.headers['User-Agent'] && config.headers['User-Agent'] !== baselineUa) {
    return config;
  }

  // Check for an explicit service flag (ex: { service: 'easynews' })
  const service = (config.service || '').toLowerCase().trim();

  // Map the service names to their corresponding env var names
  const envMap = {
    easynews: 'ADDON_USER_AGENT_EASYNEWS',
    indexer:  'ADDON_USER_AGENT_INDEXER',
    newznab:  'ADDON_USER_AGENT_NEWZNAB',
    nzbdav:   'ADDON_USER_AGENT_NZBDAV',
    specialmetadata: 'ADDON_USER_AGENT_SPECIALMETADATA',
    tmdb:     'ADDON_USER_AGENT_TMDB',
    triage:   'ADDON_USER_AGENT_TRIAGE'
  };

  // If the service is recognized, attempt to get its custom UA
  if (service) {
    const envVarName = envMap[service];
    const customUa = envVarName ? (process.env[envVarName] || '').trim() : null;
    
    // If a custom UA is found, set it in the headers
    if (customUa) {
      config.headers['User-Agent'] = customUa;
      console.log(`[USERAGENT] Overriding for service: ${service}:`, customUa);
    }
  }
  // Return the modified config
  return config;
  // If an error occurs, reject the promise
}, (error) => Promise.reject(error));

// Export the configured axios instance
module.exports = externalApi;
