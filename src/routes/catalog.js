const nzbdavService = require('../services/nzbdav');
const { sanitizeErrorForClient } = require('../utils/helpers');
const { buildNzbdavMetas } = require('./buildNzbdavMeta');

module.exports = function createCatalogHandler(getConfig) {
  return async function catalogHandler(req, res) {
    const { STREAMING_MODE, NZBDAV_HISTORY_CATALOG_LIMIT, ADDON_BASE_URL } = getConfig();

    if (STREAMING_MODE === 'native' || NZBDAV_HISTORY_CATALOG_LIMIT <= 0) {
      res.status(404).json({ metas: [] });
      return;
    }

    const { type, id } = req.params;
    if (id !== 'nzbdav_completed') {
      res.status(404).json({ metas: [] });
      return;
    }

    try {
      nzbdavService.ensureNzbdavConfigured();
    } catch (error) {
      res.status(500).json({ metas: [], error: sanitizeErrorForClient(error) });
      return;
    }

    const skip = Math.max(0, parseInt(req.query.skip || '0', 10) || 0);
    const limit = Math.max(0, Math.min(200, NZBDAV_HISTORY_CATALOG_LIMIT));
    if (limit === 0) {
      res.json({ metas: [] });
      return;
    }

    const categoryForType = nzbdavService.getNzbdavCategory(type);
    const historyMap = await nzbdavService.fetchCompletedNzbdavHistory([categoryForType], limit + skip);
    const entries = Array.from(historyMap.values());
    const slice = entries.slice(skip, skip + limit);

    const metas = await buildNzbdavMetas(slice, type, ADDON_BASE_URL);

    res.json({ metas });
  };
};
