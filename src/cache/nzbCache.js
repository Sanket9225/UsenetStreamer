// Verified NZB payload cache module
const verifiedNzbCacheByUrl = new Map();
let verifiedNzbCacheBytes = 0;

// Parse cache configuration from environment
const VERIFIED_NZB_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.VERIFIED_NZB_CACHE_TTL_MINUTES);
  if (Number.isFinite(raw) && raw >= 0) return raw * 60 * 1000;
  return 10 * 60 * 1000; // Default 1 hour
})();

const VERIFIED_NZB_CACHE_MAX_BYTES = (() => {
  const raw = Number(process.env.VERIFIED_NZB_CACHE_MAX_SIZE_MB);
  if (Number.isFinite(raw) && raw > 0) return raw * 1024 * 1024;
  return 100 * 1024 * 1024; // Default 100MB
})();

function cleanupVerifiedNzbCache(now = Date.now()) {
  if (verifiedNzbCacheByUrl.size === 0) return;
  
  // Remove expired entries
  if (VERIFIED_NZB_CACHE_TTL_MS > 0) {
    for (const [url, entry] of verifiedNzbCacheByUrl.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        verifiedNzbCacheByUrl.delete(url);
        verifiedNzbCacheBytes -= entry.size;
      }
    }
  }
  
  // Enforce size limit (FIFO)
  while (VERIFIED_NZB_CACHE_MAX_BYTES > 0 && verifiedNzbCacheBytes > VERIFIED_NZB_CACHE_MAX_BYTES) {
    const oldestKey = verifiedNzbCacheByUrl.keys().next().value;
    if (!oldestKey) break;
    const oldest = verifiedNzbCacheByUrl.get(oldestKey);
    verifiedNzbCacheByUrl.delete(oldestKey);
    if (oldest) verifiedNzbCacheBytes -= oldest.size;
  }
}

function getVerifiedNzbCacheEntry(downloadUrl) {
  if (!downloadUrl || VERIFIED_NZB_CACHE_MAX_BYTES <= 0) return null;
  cleanupVerifiedNzbCache();
  const entry = verifiedNzbCacheByUrl.get(downloadUrl);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    verifiedNzbCacheByUrl.delete(downloadUrl);
    verifiedNzbCacheBytes -= entry.size;
    return null;
  }
  entry.lastAccess = Date.now();
  return entry;
}

function cacheVerifiedNzbPayload(downloadUrl, nzbPayload, metadata = {}) {
  if (!downloadUrl || typeof nzbPayload !== 'string' || nzbPayload.length === 0) return;
  if (VERIFIED_NZB_CACHE_MAX_BYTES <= 0) return;
  
  const payloadBuffer = Buffer.from(nzbPayload, 'utf8');
  const size = payloadBuffer.length;
  if (size > VERIFIED_NZB_CACHE_MAX_BYTES) return;
  
  const expiresAt = VERIFIED_NZB_CACHE_TTL_MS > 0 ? Date.now() + VERIFIED_NZB_CACHE_TTL_MS : null;
  const existing = verifiedNzbCacheByUrl.get(downloadUrl);
  if (existing) {
    verifiedNzbCacheBytes -= existing.size;
  }
  
  verifiedNzbCacheByUrl.set(downloadUrl, {
    downloadUrl,
    payloadBuffer,
    size,
    metadata: {
      title: metadata.title || null,
      sizeBytes: metadata.size || null,
      fileName: metadata.fileName || null,
    },
    expiresAt,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  });
  
  verifiedNzbCacheBytes += size;
  cleanupVerifiedNzbCache();
}

function clearVerifiedNzbCache(reason = 'manual') {
  if (verifiedNzbCacheByUrl.size > 0) {
    console.log('[CACHE] Cleared verified NZB cache', { reason, entries: verifiedNzbCacheByUrl.size });
  }
  verifiedNzbCacheByUrl.clear();
  verifiedNzbCacheBytes = 0;
}

function buildVerifiedNzbFileName(entry, fallbackTitle = null) {
  const preferred = entry?.metadata?.fileName || entry?.metadata?.title || fallbackTitle || 'verified-nzb';
  const sanitized = preferred
    .toString()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return sanitized || 'verified-nzb';
}

function getVerifiedNzbCacheStats() {
  return {
    entries: verifiedNzbCacheByUrl.size,
    bytes: verifiedNzbCacheBytes,
    maxBytes: VERIFIED_NZB_CACHE_MAX_BYTES,
    ttlMs: VERIFIED_NZB_CACHE_TTL_MS,
  };
}

module.exports = {
  cleanupVerifiedNzbCache,
  getVerifiedNzbCacheEntry,
  cacheVerifiedNzbPayload,
  clearVerifiedNzbCache,
  buildVerifiedNzbFileName,
  getVerifiedNzbCacheStats,
};
