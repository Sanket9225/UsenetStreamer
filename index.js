const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const path = require('path');

// Configuration
const { PORT, MANIFEST_AUTH_PASSWORD } = require('./src/config/environment');
const { getManifestConfig } = require('./src/config/manifest');

// Handlers
const { handleStreamRequest } = require('./src/handlers/stream');
const { handleNzbdavStream } = require('./src/handlers/nzbStream');

// Middleware
const { validateUserData } = require('./src/middleware/auth');

// Utils
const { generateLandingPage } = require('./src/utils/landingPage');

// Create addon builder with base manifest
// If password is set, include config fields in manifest
const manifest = getManifestConfig(!!MANIFEST_AUTH_PASSWORD);
const builder = new addonBuilder(manifest);

// Define stream handler
builder.defineStreamHandler(async (args) => {
  try {
    return await handleStreamRequest(args);
  } catch (error) {
    console.error('[ERROR] Stream handler failed:', error.message);
    return { streams: [] };
  }
});

// Get the addon interface
const addonInterface = builder.getInterface();

// Create Express app for custom routes
const app = express();

// Parse JSON bodies for API endpoints
app.use(express.json());

// Serve static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Landing page routes
app.get('/', (req, res) => {
  if (MANIFEST_AUTH_PASSWORD) {
    res.redirect('/configure');
  } else {
    const manifest = getManifestConfig(false);
    res.send(generateLandingPage(manifest));
  }
});

app.get('/configure', (req, res) => {
  const manifest = getManifestConfig(MANIFEST_AUTH_PASSWORD ? true : false);
  res.send(generateLandingPage(manifest));
});

// CORS middleware for custom routes (SDK normally handles this)
const setCorsHeaders = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
};

// Password verification endpoint for config page authentication
app.post('/verify-password', setCorsHeaders, (req, res) => {
  const { password } = req.body;

  // If no password is set in environment, deny verification
  if (!MANIFEST_AUTH_PASSWORD) {
    return res.status(400).json({
      valid: false,
      error: 'Password authentication not configured'
    });
  }

  // Check if password matches
  if (password === MANIFEST_AUTH_PASSWORD) {
    return res.json({ valid: true });
  } else {
    return res.json({ valid: false });
  }
});

// Indexers endpoint to fetch available Prowlarr indexers
app.get('/indexers', setCorsHeaders, async (req, res) => {
  try {
    const { getIndexers } = require('./src/services/prowlarr');
    const indexers = await getIndexers();
    res.json({ indexers });
  } catch (error) {
    console.error('[ERROR] Failed to fetch indexers:', error.message);
    res.status(500).json({
      error: 'Failed to fetch indexers',
      message: error.message
    });
  }
});

// Manifest routes (handled by SDK but we add auth middleware for user data)
// The SDK automatically adds these routes:
// - GET /manifest.json
// - GET /:userData/manifest.json
// - GET /stream/:type/:id.json
// - GET /:userData/stream/:type/:id.json

// However, we need to handle authentication for the user data routes
// This is done by wrapping the addon interface

// NZB stream endpoint (custom route not handled by SDK)
app.get('/nzb/stream', handleNzbdavStream);
app.head('/nzb/stream', handleNzbdavStream);

// Custom manifest endpoints to handle authentication properly
// These override the SDK's default manifest routes
app.get('/manifest.json', setCorsHeaders, (req, res) => {
  if (MANIFEST_AUTH_PASSWORD) {
    // Return manifest with config requirement
    const manifest = getManifestConfig(true);
    res.json(manifest);
  } else {
    // No password, use SDK's manifest
    res.json(addonInterface.manifest);
  }
});

app.get('/:userData/manifest.json', setCorsHeaders, validateUserData, (req, res) => {
  // User authenticated, return manifest without config requirement
  const manifest = getManifestConfig(false);
  res.json(manifest);
});

// Handle OPTIONS preflight requests for CORS
app.options('/manifest.json', setCorsHeaders);
app.options('/:userData/manifest.json', setCorsHeaders);

// Authentication middleware for stream routes with userData prefix
if (MANIFEST_AUTH_PASSWORD) {
  app.use('/:userData/stream', setCorsHeaders, validateUserData);
}

// Apply CORS to all SDK stream routes
app.use('/stream', setCorsHeaders);

// Custom stream route handlers to inject config before SDK processes it
// This ensures the SDK's handler receives the decoded config
const { decodeUserData } = require('./src/middleware/auth');

// Stream handler WITH userData (configured addon)
app.get('/:userData/stream/:type/:id.json', async (req, res, next) => {
  try {
    console.log(`[BRIDGE] Intercepting stream request with userData`);

    // Decode userData to get config
    const config = decodeUserData(req.params.userData);
    console.log(`[BRIDGE] Decoded config:`, config);

    // Call the addon's stream handler directly with config
    const result = await handleStreamRequest({
      type: req.params.type,
      id: req.params.id,
      config: config || {},
      extra: req.query || {}
    });

    res.json(result);
  } catch (error) {
    console.error('[BRIDGE ERROR]', error);
    res.json({ streams: [] });
  }
});

// Stream handler WITHOUT userData (unconfigured addon - uses defaults)
app.get('/stream/:type/:id.json', async (req, res, next) => {
  try {
    console.log(`[BRIDGE] Intercepting stream request without userData (using defaults)`);

    // Call the addon's stream handler with empty config (will use defaults)
    const result = await handleStreamRequest({
      type: req.params.type,
      id: req.params.id,
      config: {},
      extra: req.query || {}
    });

    res.json(result);
  } catch (error) {
    console.error('[BRIDGE ERROR]', error);
    res.json({ streams: [] });
  }
});

// Mount the addon interface routes (mostly for other endpoints)
// Our custom handlers above take precedence for stream endpoints
const addonRouter = getRouter(addonInterface);
app.use(addonRouter);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`UsenetStreamer addon running at http://0.0.0.0:${PORT}`);
  console.log(`Manifest available at: http://0.0.0.0:${PORT}/manifest.json`);
});
