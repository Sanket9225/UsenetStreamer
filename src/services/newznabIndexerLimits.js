const { normalizeIndexerToken } = require('../utils/parsers');

function getPaidDirectIndexerTokens(configs = []) {
  return configs
    .filter((config) => config && config.isPaid)
    .map((config) => normalizeIndexerToken(config.slug || config.dedupeKey || config.displayName || config.id))
    .filter(Boolean);
}

function buildPaidIndexerLimitMap(configs = []) {
  const limitMap = new Map();
  (configs || []).forEach((config) => {
    if (!config || !config.isPaid) return;
    const limit = Number.isFinite(config.paidLimit) ? config.paidLimit : 6;
    const tokens = [
      config.slug,
      config.dedupeKey,
      config.displayName,
      config.name,
      config.id,
    ].map((token) => normalizeIndexerToken(token)).filter(Boolean);
    tokens.forEach((token) => {
      const existing = limitMap.get(token);
      if (!existing || limit < existing) {
        limitMap.set(token, limit);
      }
    });
  });
  return limitMap;
}

module.exports = { getPaidDirectIndexerTokens, buildPaidIndexerLimitMap };
