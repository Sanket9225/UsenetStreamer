const { MANIFEST_AUTH_PASSWORD } = require('../config/environment');

/**
 * Decode user data from base64
 * @param {string} userDataParam - Base64 encoded user data
 * @returns {object|null} Decoded user data or null
 */
function decodeUserData(userDataParam) {
  if (!userDataParam) {
    return null;
  }

  try {
    const decoded = Buffer.from(userDataParam, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[AUTH] Failed to decode user data:', error.message);
    return null;
  }
}

/**
 * Authentication middleware for user data validation
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
function validateUserData(req, res, next) {
  // If no password is configured, skip authentication
  if (!MANIFEST_AUTH_PASSWORD) {
    return next();
  }

  const userData = decodeUserData(req.params.userData);

  if (!userData) {
    return res.status(401).json({
      error: 'Authentication required. Please configure the addon with your password.'
    });
  }

  if (!userData.password) {
    return res.status(401).json({
      error: 'Password is required in configuration.'
    });
  }

  if (userData.password !== MANIFEST_AUTH_PASSWORD) {
    return res.status(403).json({
      error: 'Invalid password. Please reconfigure the addon with the correct password.'
    });
  }

  // Store validated user data in request for later use
  req.userData = userData;
  next();
}

module.exports = {
  decodeUserData,
  validateUserData
};
