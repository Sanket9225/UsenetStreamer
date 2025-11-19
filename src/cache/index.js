// Central cache management module
const streamCache = require('./streamCache');
const nzbCache = require('./nzbCache');
const nzbdavCache = require('./nzbdavCache');

function clearAllCaches(reason = 'manual') {
  streamCache.clearStreamResponseCache(reason);
  nzbCache.clearVerifiedNzbCache(reason);
  nzbdavCache.clearNzbdavStreamCache(reason);
}

function getAllCacheStats() {
  return {
    stream: streamCache.getStreamCacheStats(),
    nzb: nzbCache.getVerifiedNzbCacheStats(),
    nzbdav: nzbdavCache.getNzbdavCacheStats(),
  };
}

module.exports = {
  // Stream cache
  ...streamCache,
  
  // NZB cache
  ...nzbCache,
  
  // NZBDav cache
  ...nzbdavCache,
  
  // Combined operations
  clearAllCaches,
  getAllCacheStats,
};
