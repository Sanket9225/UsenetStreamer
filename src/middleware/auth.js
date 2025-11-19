// Authentication middleware for shared secret validation

function extractTokenFromRequest(req) {
  const pathMatch = (req.path || '').match(/^\/([^\/]+)\/(manifest\.json|stream|nzb)(?:\b|\/)/i);
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

function ensureSharedSecret(req, res, next) {
  const secret = (process.env.ADDON_SHARED_SECRET || '').trim();
  
  if (!secret) {
    next();
    return;
  }
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const providedToken = extractTokenFromRequest(req);
  if (!providedToken || providedToken !== secret) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing addon token' });
    return;
  }
  next();
}

module.exports = {
  extractTokenFromRequest,
  ensureSharedSecret,
};
