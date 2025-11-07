const { ADDON_BASE_URL, MANIFEST_AUTH_PASSWORD } = require('./environment');

/**
 * Generate manifest configuration for the addon
 * @param {boolean} requiresConfig - Whether to include configuration fields
 * @returns {object} Manifest configuration object
 */
function getManifestConfig(requiresConfig = false) {
  if (!ADDON_BASE_URL) {
    throw new Error('ADDON_BASE_URL is not configured');
  }

  const manifest = {
    id: 'com.usenet.streamer',
    version: '1.0.0',
    name: 'UsenetStreamer',
    description: 'Usenet-powered instant streams for Stremio via Prowlarr and NZBDav',
    logo: `${ADDON_BASE_URL.replace(/\/$/, '')}/assets/icon.png`,
    resources: ['stream'],
    types: ['movie', 'series', 'channel', 'tv'],
    catalogs: [],
    idPrefixes: ['tt']
  };

  // Add configuration if password is required
  if (requiresConfig && MANIFEST_AUTH_PASSWORD) {
    manifest.behaviorHints = {
      configurable: true,
      configurationRequired: true
    };
    manifest.config = [
      {
        key: 'password',
        type: 'password',
        title: 'UsenetStreamer Password',
        required: true
      }
    ];
  }

  return manifest;
}

module.exports = {
  getManifestConfig
};
