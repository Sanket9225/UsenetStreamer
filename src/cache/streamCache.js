// Stream response cache module
const streamResponseCache = new Map();
let streamCacheBytes = 0;

// Parse cache configuration from environment
const STREAM_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.STREAM_CACHE_TTL_MINUTES);
  if (Number.isFinite(raw) && raw >= 0) return raw * 60 * 1000;
  return 10 * 60 * 1000; // Default 10 minutes
})();

const STREAM_CACHE_MAX_BYTES = (() => {
  const raw = Number(process.env.STREAM_CACHE_MAX_SIZE_MB);
  if (Number.isFinite(raw) && raw > 0) return raw * 1024 * 1024;
  return 50 * 1024 * 1024; // Default 50MB
})();

const STREAM_CACHE_MAX_ENTRIES = 1000;

function estimateCacheEntrySize(payload, meta) {
  try {
    return Buffer.byteLength(JSON.stringify({ payload, meta }));
  } catch (error) {
    return 0;
  }
}

function cleanupStreamCache(now = Date.now()) {
  if (streamResponseCache.size === 0) return;
  
  // Remove expired entries
  if (STREAM_CACHE_TTL_MS > 0) {
    for (const [key, entry] of streamResponseCache.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        streamResponseCache.delete(key);
        streamCacheBytes -= entry.size;
      }
    }
  }
  
  // Enforce size and count limits (FIFO)
  while (
    (STREAM_CACHE_MAX_BYTES > 0 && streamCacheBytes > STREAM_CACHE_MAX_BYTES)
    || (STREAM_CACHE_MAX_ENTRIES > 0 && streamResponseCache.size > STREAM_CACHE_MAX_ENTRIES)
  ) {
    const oldestKey = streamResponseCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = streamResponseCache.get(oldestKey);
    streamResponseCache.delete(oldestKey);
    if (oldest) streamCacheBytes -= oldest.size;
  }
}

function clearStreamResponseCache(reason = 'manual') {
  if (streamResponseCache.size > 0) {
    console.log('[CACHE] Cleared stream response cache', { reason, entries: streamResponseCache.size });
  }
  streamResponseCache.clear();
  streamCacheBytes = 0;
}

function getStreamCacheEntry(cacheKey) {
  if (!cacheKey || STREAM_CACHE_MAX_ENTRIES <= 0) return null;
  cleanupStreamCache();
  const entry = streamResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    streamResponseCache.delete(cacheKey);
    streamCacheBytes -= entry.size;
    return null;
  }
  return entry;
}

function setStreamCacheEntry(cacheKey, payload, meta = null) {
  if (!cacheKey || STREAM_CACHE_MAX_ENTRIES <= 0) return;
  const size = estimateCacheEntrySize(payload, meta);
  if (size <= 0 || (STREAM_CACHE_MAX_BYTES > 0 && size > STREAM_CACHE_MAX_BYTES)) return;
  const expiresAt = STREAM_CACHE_TTL_MS > 0 ? Date.now() + STREAM_CACHE_TTL_MS : null;
  const existing = streamResponseCache.get(cacheKey);
  if (existing) {
    streamCacheBytes -= existing.size;
    streamResponseCache.delete(cacheKey);
  }
  streamResponseCache.set(cacheKey, { payload, meta, expiresAt, size });
  streamCacheBytes += size;
  cleanupStreamCache();
}

function getStreamCacheStats() {
  return {
    entries: streamResponseCache.size,
    bytes: streamCacheBytes,
    maxBytes: STREAM_CACHE_MAX_BYTES,
    maxEntries: STREAM_CACHE_MAX_ENTRIES,
    ttlMs: STREAM_CACHE_TTL_MS,
  };
}

module.exports = {
  cleanupStreamCache,
  clearStreamResponseCache,
  getStreamCacheEntry,
  setStreamCacheEntry,
  getStreamCacheStats,
};
