// Parsing utilities for releases, episodes, and titles
const path = require('path');
const { VIDEO_EXTENSIONS } = require('../config/constants');

const posixPath = path.posix;

function normalizeReleaseTitle(title) {
  if (title === undefined || title === null) return '';
  const raw = title.toString().trim();
  if (!raw) return '';

  let working = raw.replace(/\.(nzb|zip)$/i, '');
  working = working
    .replace(/[._-]+/g, ' ')
    .replace(/['"`]+/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

  return working;
}

function parseRequestedEpisode(type, id, query = {}) {
  if (type !== 'series') return null;

  const rawId = String(id || '');
  const parts = rawId.split(':');
  const season = parts[1] ? Number(parts[1]) : null;
  const episode = parts[2] ? Number(parts[2]) : null;

  if (Number.isFinite(season) && Number.isFinite(episode)) {
    return { season, episode };
  }

  if (query.season !== undefined && query.episode !== undefined) {
    const s = Number(query.season);
    const e = Number(query.episode);
    if (Number.isFinite(s) && Number.isFinite(e)) {
      return { season: s, episode: e };
    }
  }

  return null;
}

function isVideoFileName(fileName = '') {
  if (!fileName) return false;
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_EXTENSIONS.has(ext);
}

function fileMatchesEpisode(fileName, requestedEpisode) {
  if (!requestedEpisode || !Number.isFinite(requestedEpisode.season) || !Number.isFinite(requestedEpisode.episode)) {
    return true;
  }
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  const s = requestedEpisode.season;
  const e = requestedEpisode.episode;
  const patterns = [
    `s${String(s).padStart(2, '0')}e${String(e).padStart(2, '0')}`,
    `${s}x${String(e).padStart(2, '0')}`,
  ];
  return patterns.some((pattern) => lower.includes(pattern));
}

function normalizeNzbdavPath(pathValue) {
  if (!pathValue) return '/';
  const normalized = pathValue.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function inferMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const VIDEO_MIME_MAP = new Map([
    ['.mp4', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.mkv', 'video/x-matroska'],
    ['.webm', 'video/webm'],
    ['.avi', 'video/x-msvideo'],
    ['.mov', 'video/quicktime'],
    ['.wmv', 'video/x-ms-wmv'],
    ['.flv', 'video/x-flv'],
    ['.ts', 'video/mp2t'],
    ['.m2ts', 'video/mp2t'],
    ['.mpg', 'video/mpeg'],
    ['.mpeg', 'video/mpeg'],
  ]);
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || 'application/octet-stream';
}

function normalizeIndexerToken(value) {
  if (value === undefined || value === null) return null;
  const token = String(value).trim().toLowerCase();
  return token.length > 0 ? token : null;
}

function nzbMatchesIndexer(result, tokenSet) {
  if (!tokenSet || tokenSet.size === 0) return true;
  const idToken = normalizeIndexerToken(result?.indexerId);
  if (idToken && tokenSet.has(idToken)) return true;
  const nameToken = normalizeIndexerToken(result?.indexer);
  if (nameToken && tokenSet.has(nameToken)) return true;
  return false;
}

function cleanSpecialSearchTitle(rawTitle) {
  if (!rawTitle) return '';
  const noiseTokens = new Set([
    'mb', 'gb', 'kb', 'tb', 'xxx', 'hevc', 'x265', 'x264', 'h265', 'h264',
    'hdr', 'dv', 'uhd', 'web', 'webdl', 'web-dl', 'webrip', 'bluray', 'bdrip',
    'remux', 'prt', 'aac', 'ddp', 'ddp5', 'ddp5.1', 'ddp51', 'atmos', 'dts'
  ]);
  const removeEverywherePatterns = [
    /^\d+(mb|gb|kb|tb)$/i,
    /^[0-9]{3,4}p$/i,
    /^s\d{2}e\d{2}$/i,
    /^\d+x\d+$/,
    /^x?26[45]$/i,
    /^h26[45]$/i
  ];

  const normalizeChunk = (value) =>
    value
      .replace(/[\[\](){}]/g, ' ')
      .replace(/[._]/g, ' ')
      .replace(/[:\-–—]/g, ' ')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normalized = normalizeChunk(rawTitle);
  if (!normalized) return '';

  const tokens = normalized.split(' ');
  const filteredTokens = [];
  let contentStarted = false;

  const isRemovableToken = (token, phase) => {
    const lower = token.toLowerCase();
    if (!lower) return true;
    if (noiseTokens.has(lower)) return true;
    if (/^\d+$/.test(lower)) return true;
    if (removeEverywherePatterns.some((pattern) => pattern.test(lower))) return true;
    if (phase === 'prefix') {
      if (/^\d{1,3}mb$/i.test(lower)) return true;
      if (/^\d{1,4}$/.test(lower)) return true;
    }
    return false;
  };

  for (const token of tokens) {
    if (!token) continue;
    if (!contentStarted && isRemovableToken(token, 'prefix')) {
      continue;
    }
    contentStarted = true;
    if (isRemovableToken(token, 'anywhere')) {
      continue;
    }
    filteredTokens.push(token);
  }

  if (filteredTokens.length === 0) {
    filteredTokens.push(tokens[tokens.length - 1]);
  }

  return normalizeChunk(filteredTokens.join(' '));
}

function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, '');
}

module.exports = {
  normalizeReleaseTitle,
  parseRequestedEpisode,
  isVideoFileName,
  fileMatchesEpisode,
  normalizeNzbdavPath,
  inferMimeType,
  normalizeIndexerToken,
  nzbMatchesIndexer,
  cleanSpecialSearchTitle,
  stripTrailingSlashes,
};
