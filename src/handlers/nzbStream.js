const { getNzbdavCategory, buildNzbdavStream, proxyNzbdavStream, streamFailureVideo } = require('../services/nzbdav');
const { parseRequestedEpisode } = require('../utils/parsers');
const { getOrCreateNzbdavStream } = require('../utils/cache');

/**
 * Handle NZBDav stream requests
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handleNzbdavStream(req, res) {
  const { downloadUrl, type = 'movie', id = '', title = 'NZB Stream' } = req.query;

  if (!downloadUrl) {
    res.status(400).json({ error: 'downloadUrl query parameter is required' });
    return;
  }

  try {
    const category = getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const cacheKeyParts = [downloadUrl, category];
    if (requestedEpisode) {
      cacheKeyParts.push(`${requestedEpisode.season}x${requestedEpisode.episode}`);
    }
    const cacheKey = cacheKeyParts.join('|');

    const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
      buildNzbdavStream({ downloadUrl, category, title, requestedEpisode })
    );

    await proxyNzbdavStream(req, res, streamData.viewPath, streamData.fileName || '');
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
