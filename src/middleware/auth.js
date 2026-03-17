// Authentication middleware for shared secret / stream token validation
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Rate-limiter: sliding-window counter per IP
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60;              // max requests per window
const rateLimitBuckets = new Map();

function pruneRateLimitBuckets() {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitBuckets.delete(ip);
    }
  }
}
// Periodic cleanup every 5 minutes
setInterval(pruneRateLimitBuckets, 5 * 60 * 1000).unref();

/**
 * Returns true if the request should be allowed, false if rate-limited.
 */
function rateLimitCheck(req) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------
function extractTokenFromRequest(req) {
  const pathMatch = (req.path || '').match(/^\/([^\/]+)\/(manifest\.json|stream|catalog|meta|nzb|easynews)(?:\b|\/)/i);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1].trim();
  }
  if (req.params && typeof req.params.token === 'string') {
    return req.params.token.trim();
  }
  const authHeader = req.headers['authorization'] || req.headers['x-addon-token'];
  if (typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^token$/i.test(parts[0])) {
      return parts[1].trim();
    }
    return authHeader.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Timing-safe string comparison
// ---------------------------------------------------------------------------
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 && b.length === 0) return true;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Prevent length-based timing leak: compare with self so runtime is constant
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Resolve effective stream token (ADDON_STREAM_TOKEN ?? ADDON_SHARED_SECRET)
// ---------------------------------------------------------------------------
function getEffectiveStreamToken() {
  return (process.env.ADDON_STREAM_TOKEN || '').trim();
}

// ---------------------------------------------------------------------------
// Middleware: protect admin API routes (checks ADDON_SHARED_SECRET only)
// Explicitly rejects the stream token if it differs from the admin secret.
// ---------------------------------------------------------------------------
function ensureAdminSecret(req, res, next) {
  const secret = (process.env.ADDON_SHARED_SECRET || '').trim();

  // ADDON_SHARED_SECRET is mandatory since v1.7.6
  if (!secret) {
    res.status(503).json({ error: 'ADDON_SHARED_SECRET is not configured. Set it in your Docker/environment config and restart.' });
    return;
  }
  if (req.method === 'OPTIONS') { next(); return; }

  if (!rateLimitCheck(req)) {
    res.status(429).json({ error: 'Too many requests — try again later' });
    return;
  }

  const provided = extractTokenFromRequest(req);

  // Explicitly reject if the caller supplied the stream token instead of the admin secret
  const streamToken = getEffectiveStreamToken();
  if (provided && streamToken && !safeEqual(streamToken, secret) && safeEqual(provided, streamToken)) {
    res.status(403).json({ error: 'Forbidden: stream tokens cannot access the admin panel' });
    return;
  }

  if (!provided || !safeEqual(provided, secret)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing admin token' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Middleware: protect stream / manifest routes (checks stream token)
// ---------------------------------------------------------------------------
function ensureStreamToken(req, res, next) {
  const token = getEffectiveStreamToken();

  // No stream token configured — allow through
  if (!token) { next(); return; }
  if (req.method === 'OPTIONS') { next(); return; }

  if (!rateLimitCheck(req)) {
    res.status(429).json({ error: 'Too many requests — try again later' });
    return;
  }

  const provided = extractTokenFromRequest(req);
  if (!provided || !safeEqual(provided, token)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing stream token' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Legacy alias — routes that haven't been split yet fall back to admin check
// ---------------------------------------------------------------------------
function ensureSharedSecret(req, res, next) {
  return ensureAdminSecret(req, res, next);
}

module.exports = {
  extractTokenFromRequest,
  ensureSharedSecret,
  ensureAdminSecret,
  ensureStreamToken,
  getEffectiveStreamToken,
};
