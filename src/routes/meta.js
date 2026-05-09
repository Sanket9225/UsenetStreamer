const nzbdavService = require('../services/nzbdav');
const { sanitizeErrorForClient } = require('../utils/helpers');
const { buildNzbdavMetaWithDeadline } = require('./buildNzbdavMeta');

module.exports = function createMetaHandler(getConfig) {
  return async function metaHandler(req, res) {
    const { STREAMING_MODE, NZBDAV_HISTORY_CATALOG_LIMIT, ADDON_BASE_URL } = getConfig();

    if (STREAMING_MODE === 'native' || NZBDAV_HISTORY_CATALOG_LIMIT <= 0) {
      res.status(404).json({ meta: null });
      return;
    }

    const { type, id } = req.params;
    if (!id || !id.startsWith('nzbdav:')) {
      res.status(404).json({ meta: null });
      return;
    }

    try {
      nzbdavService.ensureNzbdavConfigured();
    } catch (error) {
      res.status(500).json({ meta: null, error: sanitizeErrorForClient(error) });
      return;
    }

    const nzoId = id.slice('nzbdav:'.length).trim();
    if (!nzoId) {
      res.status(404).json({ meta: null });
      return;
    }

    const categoryForType = nzbdavService.getNzbdavCategory(type);
    const historyMap = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType], Math.max(50, NZBDAV_HISTORY_CATALOG_LIMIT));
    const match = Array.from(historyMap.values()).find((entry) => String(entry.nzoId) === String(nzoId));
    if (!match) {
      res.status(404).json({ meta: null });
      return;
    }

    res.json({
      meta: await buildNzbdavMetaWithDeadline(match, type, ADDON_BASE_URL),
    });
  };
};
