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
      },
      {
        key: 'preferredLanguage',
        type: 'select',
        title: 'Preferred Audio Language',
        options: [
          'No Preference',
          'English',
          'Spanish',
          'French',
          'German',
          'Italian',
          'Portuguese',
          'Russian',
          'Japanese',
          'Korean',
          'Chinese',
          'Arabic',
          'Hindi',
          'Dutch',
          'Polish',
          'Turkish'
        ],
        default: 'No Preference',
        required: false
      },
      {
        key: 'sortMethod',
        type: 'select',
        title: 'Sorting Method',
        options: [
          'Quality First',
          'Size First',
          'Date First'
        ],
        default: 'Quality First',
        required: false
      },
      {
        key: 'qualityFilter',
        type: 'select',
        title: 'Show Qualities',
        options: [
          'All',
          '4K/2160p',
          '1080p',
          '720p',
          '480p',
          '4K + 1080p',
          '1080p + 720p',
          '720p + 480p'
        ],
        default: 'All',
        required: false
      },
      {
        key: 'maxResults',
        type: 'number',
        title: 'Max Results (0 = unlimited)',
        default: '0',
        required: false
      }
    ];
  }

  return manifest;
}

module.exports = {
  getManifestConfig
};
