const { getNzbdavCategory, buildNzbdavStream, proxyNzbdavStream, streamFailureVideo, buildNzbdavCacheKey } = require('../services/nzbdav');
const { parseRequestedEpisode } = require('../utils/parsers');
const { getOrCreateNzbdavStream } = require('../utils/cache');
const { extractStreamParams } = require('../utils/streamToken');
const posixPath = require('path').posix;

/**
 * Map of video file extensions to MIME types
 */
const VIDEO_MIME_MAP = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mov', 'video/quicktime'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t'],
  ['.m2ts', 'video/mp2t'],
  ['.mpg', 'video/mpeg'],
  ['.mpeg', 'video/mpeg']
]);

/**
 * Infer MIME type from file name
 * @param {string} fileName - File name with extension
 * @returns {string} MIME type
 */
function inferMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || 'application/octet-stream';
}

/**
 * Handle NZBDav stream requests
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handleNzbdavStream(req, res) {
  // Debug logging for external player troubleshooting
  console.log('═══════════════════════════════════════════════════════════');
  console.log('[NZBDAV DEBUG] Incoming stream request:');
  console.log(`[NZBDAV DEBUG] Method: ${req.method}`);
  console.log(`[NZBDAV DEBUG] URL: ${req.url}`);
  console.log(`[NZBDAV DEBUG] Full path: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  console.log(`[NZBDAV DEBUG] Has token param:`, !!req.params?.token);
  console.log(`[NZBDAV DEBUG] Query params:`, req.query);
  console.log(`[NZBDAV DEBUG] Headers:`, {
    'user-agent': req.headers['user-agent'],
    'range': req.headers['range'],
    'accept': req.headers['accept'],
    'referer': req.headers['referer']
  });
  console.log('═══════════════════════════════════════════════════════════');

  // Extract parameters from token or query params
  const params = extractStreamParams(req);

  if (!params || !params.downloadUrl) {
    console.error('[NZBDAV ERROR] Missing downloadUrl parameter!');
    console.error('[NZBDAV ERROR] Token present:', !!req.params?.token);
    console.error('[NZBDAV ERROR] Available query params:', Object.keys(req.query));
    res.status(400).json({
      error: 'downloadUrl parameter is required',
      hint: 'Use token-based URL for external players: /nzb/stream/<token>'
    });
    return;
  }

  const { downloadUrl, type = 'movie', id = '', title = 'NZB Stream' } = params;

  try {
    const category = getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, params);

    // Build cache key using service function
    const cacheKey = buildNzbdavCacheKey(downloadUrl, category, requestedEpisode);

    // Extract history slot hint from params for reuse
    const existingSlotHint = params.historyNzoId
      ? {
          nzoId: params.historyNzoId,
          jobName: params.historyJobName,
          category: params.historyCategory
        }
      : null;

    const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
      buildNzbdavStream({ downloadUrl, category, title, requestedEpisode, existingSlot: existingSlotHint })
    );

    // Build display filename for external players
    // Prefer clean content title (e.g. "Frankenstein (2025).mkv") over release name
    let displayFilename = streamData.fileName || 'stream';
    if (params.contentTitle) {
      const ext = posixPath.extname(streamData.fileName || '.mkv');
      const cleanTitle = params.contentTitle.replace(/[\\/:*?"<>|]+/g, '_');
      const yearSuffix = params.contentYear ? ` (${params.contentYear})` : '';
      displayFilename = `${cleanTitle}${yearSuffix}${ext}`;
      console.log(`[NZBDAV] Using clean display filename: ${displayFilename}`);
    }

    // Handle HEAD requests before proxying
    if ((req.method || 'GET').toUpperCase() === 'HEAD') {
      const inferredMime = inferMimeType(streamData.fileName || title || 'stream');
      let totalSize = Number.isFinite(streamData.size) ? streamData.size : undefined;

      // If size is missing, try to fetch it via HEAD request to WebDAV
      if (!Number.isFinite(totalSize)) {
        const { NZBDAV_WEBDAV_URL, NZBDAV_WEBDAV_USER, NZBDAV_WEBDAV_PASS } = require('../config/environment');
        const { normalizeNzbdavPath } = require('../utils/parsers');
        const axios = require('axios');

        try {
          const normalizedPath = normalizeNzbdavPath(streamData.viewPath);
          const encodedPath = normalizedPath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
          const webdavBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, '');
          const targetUrl = `${webdavBase}${encodedPath}`;

          const headConfig = {
            url: targetUrl,
            method: 'HEAD',
            headers: { 'User-Agent': 'UsenetStreamer' },
            timeout: 30000,
            validateStatus: (status) => status < 500
          };

          if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
            headConfig.auth = {
              username: NZBDAV_WEBDAV_USER,
              password: NZBDAV_WEBDAV_PASS
            };
          }

          const headResponse = await axios.request(headConfig);
          const headContentLength = headResponse.headers?.['content-length'];
          if (headContentLength) {
            totalSize = Number(headContentLength);
            console.log(`[NZBDAV] HEAD fallback retrieved size: ${totalSize} bytes`);
          }
        } catch (headError) {
          console.warn('[NZBDAV] HEAD fallback failed:', headError.message);
        }
      }

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', inferredMime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
      res.setHeader('Content-Disposition', `inline; filename="${displayFilename.replace(/[\\/:*?"<>|]+/g, '_')}"`);

      if (Number.isFinite(totalSize)) {
        res.setHeader('Content-Length', String(totalSize));
        res.setHeader('X-Total-Length', String(totalSize));
      }

      res.status(200).end();
      return;
    }

    await proxyNzbdavStream(req, res, streamData.viewPath, displayFilename, streamData);
  } catch (error) {
    if (error?.isNzbdavFailure) {
      console.warn('[NZBDAV] Stream failure detected:', error.failureMessage || error.message);
      const served = await streamFailureVideo(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.failureMessage || error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    console.error('[NZBDAV] Stream proxy error:', error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: error.message });
    } else {
      res.end();
    }
  }
}

module.exports = {
  handleNzbdavStream
};
