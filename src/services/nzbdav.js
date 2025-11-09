const axios = require('axios');
const fs = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const path = require('path');
const {
  NZBDAV_URL,
  NZBDAV_API_KEY,
  NZBDAV_CATEGORY_MOVIES,
  NZBDAV_CATEGORY_SERIES,
  NZBDAV_CATEGORY_DEFAULT,
  NZBDAV_WEBDAV_USER,
  NZBDAV_WEBDAV_PASS,
  NZBDAV_WEBDAV_URL,
  NZBDAV_WEBDAV_ROOT,
  NZBDAV_POLL_INTERVAL_MS,
  NZBDAV_POLL_TIMEOUT_MS,
  NZBDAV_API_TIMEOUT_MS,
  NZBDAV_HISTORY_TIMEOUT_MS,
  NZBDAV_STREAM_TIMEOUT_MS,
  NZBDAV_MAX_DIRECTORY_DEPTH,
  NZBDAV_SUPPORTED_METHODS,
  NZBDAV_HISTORY_FETCH_LIMIT,
  STREAM_HIGH_WATER_MARK,
  FAILURE_VIDEO_FILENAME
} = require('../config/environment');
const { ensureNzbdavConfigured } = require('../utils/validators');
const { normalizeNzbdavPath, isVideoFileName, fileMatchesEpisode } = require('../utils/parsers');

const pipelineAsync = promisify(pipeline);
const FAILURE_VIDEO_PATH = path.resolve(__dirname, '..', '..', 'assets', FAILURE_VIDEO_FILENAME);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize release title for matching
 * @param {string} title - Release title
 * @returns {string} Normalized title
 */
function normalizeReleaseTitle(title) {
  if (!title) return '';
  return title.toString().trim().toLowerCase();
}

/**
 * Fetch completed NZBs from NZBDav history
 * @param {Array<string>} categories - Categories to fetch
 * @returns {Promise<Map>} Map of normalized title -> { nzoId, jobName, category, size, slot }
 */
async function fetchCompletedNzbdavHistory(categories = []) {
  ensureNzbdavConfigured();
  const categoryList = Array.isArray(categories) && categories.length > 0
    ? Array.from(new Set(categories.filter((value) => value !== undefined && value !== null && String(value).trim() !== '')))
    : [null];

  const results = new Map();

  for (const category of categoryList) {
    try {
      const params = buildNzbdavApiParams('history', {
        start: '0',
        limit: String(NZBDAV_HISTORY_FETCH_LIMIT),
        category: category || undefined
      });

      const headers = {};
      if (NZBDAV_API_KEY) {
        headers['x-api-key'] = NZBDAV_API_KEY;
      }

      const response = await axios.get(`${NZBDAV_URL}/api`, {
        params,
        timeout: NZBDAV_HISTORY_TIMEOUT_MS,
        headers,
        validateStatus: (status) => status < 500
      });

      if (!response.data?.status) {
        const errorMessage = response.data?.error || `history returned status ${response.status}`;
        throw new Error(errorMessage);
      }

      const history = response.data?.history || response.data?.History;
      const slots = history?.slots || history?.Slots || [];

      for (const slot of slots) {
        const status = (slot?.status || slot?.Status || '').toString().toLowerCase();
        if (status !== 'completed') {
          continue;
        }

        const jobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || slot?.nzb_name || slot?.NzbName;
        const nzoId = slot?.nzo_id || slot?.nzoId || slot?.NzoId;
        if (!jobName || !nzoId) {
          continue;
        }

        const normalized = normalizeReleaseTitle(jobName);
        if (!normalized) {
          continue;
        }

        if (!results.has(normalized)) {
          results.set(normalized, {
            nzoId,
            jobName,
            category: slot?.category || slot?.Category || category || null,
            size: slot?.size || slot?.Size || null,
            slot
          });
        }
      }
    } catch (error) {
      console.warn(`[NZBDAV] Failed to fetch history for category ${category || 'all'}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Build NZBDav cache key
 * @param {string} downloadUrl - NZB download URL
 * @param {string} category - NZBDav category
 * @param {object} requestedEpisode - Requested episode info
 * @returns {string} Cache key
 */
function buildNzbdavCacheKey(downloadUrl, category, requestedEpisode = null) {
  const keyParts = [downloadUrl, category];
  if (requestedEpisode && Number.isFinite(requestedEpisode.season) && Number.isFinite(requestedEpisode.episode)) {
    keyParts.push(`${requestedEpisode.season}x${requestedEpisode.episode}`);
  }
  return keyParts.join('|');
}

/**
 * Get NZBDav category for content type
 * @param {string} type - Content type
 * @returns {string} Category name
 */
function getNzbdavCategory(type) {
  if (type === 'series' || type === 'tv') {
    return NZBDAV_CATEGORY_SERIES;
  }
  if (type === 'movie') {
    return NZBDAV_CATEGORY_MOVIES;
  }
  return NZBDAV_CATEGORY_DEFAULT;
}

/**
 * Build NZBDav API parameters
 * @param {string} mode - API mode
 * @param {object} extra - Extra parameters
 * @returns {object} API parameters
 */
function buildNzbdavApiParams(mode, extra = {}) {
  return {
    mode,
    apikey: NZBDAV_API_KEY,
    ...extra
  };
}

/**
 * Add NZB to NZBDav queue
 * @param {string} nzbUrl - NZB download URL
 * @param {string} category - NZBDav category
 * @param {string} jobLabel - Job label
 * @returns {Promise<object>} Object with nzoId
 */
async function addNzbToNzbdav(nzbUrl, category, jobLabel) {
  ensureNzbdavConfigured();

  if (!nzbUrl) {
    throw new Error('Missing NZB download URL');
  }
  if (!category) {
    throw new Error('Missing NZBDav category');
  }

  console.log(`[NZBDAV] Queueing NZB for category=${category} (${jobLabel || 'untitled'})`);

  const params = buildNzbdavApiParams('addurl', {
    name: nzbUrl,
    cat: category,
    nzbname: jobLabel || undefined,
    output: 'json'
  });

  const headers = {};
  if (NZBDAV_API_KEY) {
    headers['x-api-key'] = NZBDAV_API_KEY;
  }

  const response = await axios.get(`${NZBDAV_URL}/api`, {
    params,
    timeout: NZBDAV_API_TIMEOUT_MS,
    headers,
    validateStatus: (status) => status < 500
  });

  if (!response.data?.status) {
    const errorMessage = response.data?.error || `addurl returned status ${response.status}`;
    throw new Error(`[NZBDAV] Failed to queue NZB: ${errorMessage}`);
  }

  const nzoId = response.data?.nzo_id ||
                response.data?.nzoId ||
                response.data?.NzoId ||
                (Array.isArray(response.data?.nzo_ids) && response.data.nzo_ids[0]) ||
                (Array.isArray(response.data?.queue) && response.data.queue[0]?.nzo_id);

  if (!nzoId) {
    throw new Error('[NZBDAV] addurl succeeded but no nzo_id returned');
  }

  console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
  return { nzoId };
}

/**
 * Wait for NZBDav job to complete
 * @param {string} nzoId - NZB job ID
 * @param {string} category - NZBDav category
 * @returns {Promise<object>} History slot object
 */
async function waitForNzbdavHistorySlot(nzoId, category) {
  ensureNzbdavConfigured();
  const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const params = buildNzbdavApiParams('history', {
      start: '0',
      limit: '50',
      category
    });

    const headers = {};
    if (NZBDAV_API_KEY) {
      headers['x-api-key'] = NZBDAV_API_KEY;
    }

    const response = await axios.get(`${NZBDAV_URL}/api`, {
      params,
      timeout: NZBDAV_HISTORY_TIMEOUT_MS,
      headers,
      validateStatus: (status) => status < 500
    });

    if (!response.data?.status) {
      const errorMessage = response.data?.error || `history returned status ${response.status}`;
      throw new Error(`[NZBDAV] Failed to query history: ${errorMessage}`);
    }

    const history = response.data?.history || response.data?.History;
    const slots = history?.slots || history?.Slots || [];
    const slot = slots.find((entry) => {
      const entryId = entry?.nzo_id || entry?.nzoId || entry?.NzoId;
      return entryId === nzoId;
    });

    if (slot) {
      const status = (slot.status || slot.Status || '').toString().toLowerCase();
      if (status === 'completed') {
        console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
        return slot;
      }
      if (status === 'failed') {
        const failMessage = slot.fail_message || slot.failMessage || slot.FailMessage || 'Unknown NZBDav error';
        const failureError = new Error(`[NZBDAV] NZB failed: ${failMessage}`);
        failureError.isNzbdavFailure = true;
        failureError.failureMessage = failMessage;
        failureError.nzoId = nzoId;
        failureError.category = category;
        throw failureError;
      }
    }

    await sleep(NZBDAV_POLL_INTERVAL_MS);
  }

  throw new Error('[NZBDAV] Timeout while waiting for NZB to become streamable');
}

/**
 * Get WebDAV client (lazy-loaded)
 */
const getWebdavClient = (() => {
  let clientPromise = null;
  return async () => {
    if (clientPromise) return clientPromise;

    clientPromise = (async () => {
      const { createClient } = await import('webdav');

      const trimmedBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, '');
      const rootSegment = (NZBDAV_WEBDAV_ROOT || '').replace(/^\/+/, '').replace(/\/+$/, '');
      const baseUrl = rootSegment ? `${trimmedBase}/${rootSegment}` : trimmedBase;

      const authOptions = {};
      if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
        authOptions.username = NZBDAV_WEBDAV_USER;
        authOptions.password = NZBDAV_WEBDAV_PASS;
      }

      return createClient(baseUrl, authOptions);
    })();

    return clientPromise;
  };
})();

/**
 * List WebDAV directory contents
 * @param {string} directory - Directory path
 * @returns {Promise<Array>} Array of directory entries
 */
async function listWebdavDirectory(directory) {
  const client = await getWebdavClient();
  const normalizedPath = normalizeNzbdavPath(directory);
  const relativePath = normalizedPath === '/' ? '/' : normalizedPath.replace(/^\/+/, '');

  try {
    const entries = await client.getDirectoryContents(relativePath, { deep: false });
    return entries.map((entry) => ({
      name: entry?.basename ?? entry?.filename ?? '',
      isDirectory: entry?.type === 'directory',
      size: entry?.size ?? null,
      href: entry?.filename ?? entry?.href ?? null
    }));
  } catch (error) {
    throw new Error(`[NZBDAV] Failed to list ${relativePath}: ${error.message}`);
  }
}

/**
 * Find the best video file in NZBDav directory
 * @param {object} params - Search parameters
 * @param {string} params.category - NZBDav category
 * @param {string} params.jobName - Job name
 * @param {object} params.requestedEpisode - Requested episode info
 * @returns {Promise<object|null>} Best matching video file
 */
async function findBestVideoFile({ category, jobName, requestedEpisode }) {
  const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`);
  const queue = [{ path: rootPath, depth: 0 }];
  const visited = new Set();
  let bestMatch = null;
  let bestEpisodeMatch = null;

  while (queue.length > 0) {
    const { path: currentPath, depth } = queue.shift();
    if (depth > NZBDAV_MAX_DIRECTORY_DEPTH) {
      continue;
    }
    if (visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    let entries;
    try {
      entries = await listWebdavDirectory(currentPath);
    } catch (error) {
      console.error(`[NZBDAV] Failed to list ${currentPath}:`, error.message);
      continue;
    }

    for (const entry of entries) {
      const entryName = entry?.name || entry?.Name;
      const isDirectory = entry?.isDirectory ?? entry?.IsDirectory;
      const entrySize = Number(entry?.size ?? entry?.Size ?? 0);
      const nextPath = normalizeNzbdavPath(`${currentPath}/${entryName}`);

      if (isDirectory) {
        queue.push({ path: nextPath, depth: depth + 1 });
        continue;
      }

      if (!entryName || !isVideoFileName(entryName)) {
        continue;
      }

      const matchesEpisode = fileMatchesEpisode(entryName, requestedEpisode);
      const candidate = {
        name: entryName,
        size: entrySize,
        matchesEpisode,
        absolutePath: nextPath,
        viewPath: nextPath.replace(/^\/+/, '')
      };

      if (matchesEpisode) {
        if (!bestEpisodeMatch || candidate.size > bestEpisodeMatch.size) {
          bestEpisodeMatch = candidate;
        }
      }

      if (!bestMatch || candidate.size > bestMatch.size) {
        bestMatch = candidate;
      }
    }
  }

  return bestEpisodeMatch || bestMatch;
}

/**
 * Build NZBDav stream data
 * @param {object} params - Stream parameters
 * @param {string} params.downloadUrl - NZB download URL
 * @param {string} params.category - NZBDav category
 * @param {string} params.title - Content title
 * @param {object} params.requestedEpisode - Requested episode info
 * @param {object} params.existingSlot - Existing slot for reuse (optional)
 * @returns {Promise<object>} Stream data
 */
async function buildNzbdavStream({ downloadUrl, category, title, requestedEpisode, existingSlot = null }) {
  let reuseError = null;
  const attempts = [];
  if (existingSlot?.nzoId) {
    attempts.push('reuse');
  }
  attempts.push('queue');

  for (const mode of attempts) {
    try {
      let slot = null;
      let nzoId = null;
      let slotCategory = category;
      let slotJobName = title;

      if (mode === 'reuse') {
        const reuseCategory = existingSlot?.category || category;
        slot = await waitForNzbdavHistorySlot(existingSlot.nzoId, reuseCategory);
        nzoId = existingSlot.nzoId;
        slotCategory = slot?.category || slot?.Category || reuseCategory;
        slotJobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || existingSlot?.jobName || title;
        console.log(`[NZBDAV] Reusing completed NZB ${slotJobName} (${nzoId})`);
      } else {
        const added = await addNzbToNzbdav(downloadUrl, category, title);
        nzoId = added.nzoId;
        slot = await waitForNzbdavHistorySlot(nzoId, category);
        slotCategory = slot?.category || slot?.Category || category;
        slotJobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name || title;
      }

      if (!slotJobName) {
        throw new Error('[NZBDAV] Unable to determine job name from history');
      }

      const bestFile = await findBestVideoFile({
        category: slotCategory,
        jobName: slotJobName,
        requestedEpisode
      });

      if (!bestFile) {
        throw new Error('[NZBDAV] No playable video files found after mounting NZB');
      }

      console.log(`[NZBDAV] Selected file ${bestFile.viewPath} (${bestFile.size} bytes)`);

      return {
        nzoId,
        category: slotCategory,
        jobName: slotJobName,
        viewPath: bestFile.viewPath,
        size: bestFile.size,
        fileName: bestFile.name
      };
    } catch (error) {
      if (mode === 'reuse') {
        reuseError = error;
        console.warn(`[NZBDAV] Reuse attempt failed for NZB ${existingSlot?.nzoId || 'unknown'}: ${error.message}`);
        continue;
      }
      if (error?.isNzbdavFailure) {
        error.downloadUrl = downloadUrl;
        error.category = category;
        error.title = title;
      }
      throw error;
    }
  }

  if (reuseError) {
    if (reuseError?.isNzbdavFailure) {
      reuseError.downloadUrl = downloadUrl;
      reuseError.category = category;
      reuseError.title = title;
    }
    throw reuseError;
  }

  const fallbackError = new Error('[NZBDAV] Unable to prepare NZB stream');
  fallbackError.downloadUrl = downloadUrl;
  fallbackError.category = category;
  fallbackError.title = title;
  throw fallbackError;
}

/**
 * Safe file stat
 * @param {string} filePath - File path
 * @returns {Promise<fs.Stats|null>} Stats object or null
 */
async function safeStat(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    return null;
  }
}

/**
 * Stream a file with range support
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} absolutePath - File path
 * @param {boolean} emulateHead - Whether to emulate HEAD request
 * @param {string} logPrefix - Logging prefix
 * @param {fs.Stats} existingStats - Existing file stats
 * @returns {Promise<boolean>} True if successful
 */
async function streamFileResponse(req, res, absolutePath, emulateHead, logPrefix, existingStats = null) {
  const stats = existingStats || (await safeStat(absolutePath));
  if (!stats || !stats.isFile()) {
    return false;
  }

  const totalSize = stats.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', stats.mtime.toUTCString());
  res.setHeader('Content-Type', 'application/octet-stream');

  if (emulateHead) {
    res.setHeader('Content-Length', totalSize);
    res.status(200).end();
    console.log(`[${logPrefix}] Served HEAD for ${absolutePath}`);
    return true;
  }

  let start = 0;
  let end = totalSize - 1;
  let statusCode = 200;

  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const [, rangeSpec] = rangeHeader.split('=');
    const [rangeStart, rangeEnd] = rangeSpec.split('-');

    if (rangeStart) {
      const parsedStart = Number.parseInt(rangeStart, 10);
      if (Number.isFinite(parsedStart) && parsedStart >= 0) {
        start = parsedStart;
      }
    }

    if (rangeEnd) {
      const parsedEnd = Number.parseInt(rangeEnd, 10);
      if (Number.isFinite(parsedEnd) && parsedEnd >= 0) {
        end = parsedEnd;
      }
    }

    if (!rangeEnd) {
      end = totalSize - 1;
    }

    if (start >= totalSize) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`);
      res.end();
      return true;
    }

    if (end >= totalSize || end < start) {
      end = totalSize - 1;
    }

    statusCode = 206;
  }

  const chunkSize = end - start + 1;
  const readStream = fs.createReadStream(absolutePath, {
    start,
    end,
    highWaterMark: STREAM_HIGH_WATER_MARK
  });

  if (statusCode === 206) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', chunkSize);
    console.log(`[${logPrefix}] Serving partial bytes ${start}-${end} from ${absolutePath}`);
  } else {
    res.status(200);
    res.setHeader('Content-Length', totalSize);
    console.log(`[${logPrefix}] Serving full file from ${absolutePath}`);
  }

  try {
    await pipelineAsync(readStream, res);
  } catch (error) {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.warn(`[${logPrefix}] Stream closed early for ${absolutePath}: ${error.message}`);
      return true;
    }
    console.error(`[${logPrefix}] Pipeline error for ${absolutePath}:`, error.message);
    throw error;
  }

  return true;
}

/**
 * Stream failure video on NZBDav error
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {Error} failureError - Failure error
 * @returns {Promise<boolean>} True if successful
 */
async function streamFailureVideo(req, res, failureError) {
  const stats = await safeStat(FAILURE_VIDEO_PATH);
  if (!stats || !stats.isFile()) {
    console.error(`[FAILURE STREAM] Failure video not found at ${FAILURE_VIDEO_PATH}`);
    return false;
  }

  const emulateHead = (req.method || 'GET').toUpperCase() === 'HEAD';
  const failureMessage = failureError?.failureMessage || failureError?.message || 'NZBDav download failed';

  if (!res.headersSent) {
    res.setHeader('X-NZBDav-Failure', failureMessage);
  }

  console.warn(`[FAILURE STREAM] Serving fallback video due to NZBDav failure: ${failureMessage}`);
  return streamFileResponse(req, res, FAILURE_VIDEO_PATH, emulateHead, 'FAILURE STREAM', stats);
}

/**
 * Map of video file extensions to MIME types
 */
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
  ['.mpeg', 'video/mpeg']
]);

/**
 * Infer MIME type from file name
 * @param {string} fileName - File name with extension
 * @returns {string} MIME type
 */
function inferMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = path.posix.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || 'application/octet-stream';
}

/**
 * Proxy NZBDav stream through WebDAV
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} viewPath - WebDAV path
 * @param {string} fileNameHint - File name hint
 * @param {object} streamData - Stream data (optional, contains size info)
 */
async function proxyNzbdavStream(req, res, viewPath, fileNameHint = '', streamData = null) {
  const originalMethod = (req.method || 'GET').toUpperCase();
  if (!NZBDAV_SUPPORTED_METHODS.has(originalMethod)) {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const emulateHead = originalMethod === 'HEAD';
  const proxiedMethod = emulateHead ? 'GET' : originalMethod;

  const normalizedPath = normalizeNzbdavPath(viewPath);
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const webdavBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, '');
  const targetUrl = `${webdavBase}${encodedPath}`;
  const headers = {};

  console.log(`[NZBDAV] Streaming ${normalizedPath} via WebDAV`);

  const coerceToString = (value) => {
    if (Array.isArray(value)) {
      return value.find((item) => typeof item === 'string' && item.trim().length > 0) || '';
    }
    return typeof value === 'string' ? value : '';
  };

  let derivedFileName = typeof fileNameHint === 'string' ? fileNameHint.trim() : '';
  if (!derivedFileName) {
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      try {
        derivedFileName = decodeURIComponent(lastSegment);
      } catch (decodeError) {
        derivedFileName = lastSegment;
      }
    }
  }
  if (!derivedFileName) {
    derivedFileName = coerceToString(req.query?.title || '').trim();
  }
  if (!derivedFileName) {
    derivedFileName = 'stream';
  }

  const sanitizedFileName = derivedFileName.replace(/[\\/:*?"<>|]+/g, '_') || 'stream';

  // Set up request headers with hardening
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  if (req.headers.accept) headers.Accept = req.headers.accept;
  if (req.headers['accept-language']) headers['Accept-Language'] = req.headers['accept-language'];
  if (req.headers['accept-encoding']) headers['Accept-Encoding'] = req.headers['accept-encoding'];
  if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];

  // Ensure Accept-Encoding is set (default to 'identity' if missing)
  if (!headers['Accept-Encoding']) {
    headers['Accept-Encoding'] = 'identity';
  }

  if (emulateHead && !headers.Range) {
    headers.Range = 'bytes=0-0';
  }

  // Perform HEAD request to get total file size if not doing range request and not HEAD
  let totalFileSize = null;
  if (!req.headers.range && !emulateHead) {
    const headConfig = {
      url: targetUrl,
      method: 'HEAD',
      headers: {
        'User-Agent': headers['User-Agent'] || 'UsenetStreamer'
      },
      timeout: 30000,
      validateStatus: (status) => status < 500
    };

    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
      headConfig.auth = {
        username: NZBDAV_WEBDAV_USER,
        password: NZBDAV_WEBDAV_PASS
      };
    }

    try {
      const headResponse = await axios.request(headConfig);
      const headHeadersLower = Object.keys(headResponse.headers || {}).reduce((map, key) => {
        map[key.toLowerCase()] = headResponse.headers[key];
        return map;
      }, {});
      const headContentLength = headHeadersLower['content-length'];
      if (headContentLength) {
        totalFileSize = Number(headContentLength);
        console.log(`[NZBDAV] HEAD reported total size ${totalFileSize} bytes for ${normalizedPath}`);
      }
    } catch (headError) {
      console.warn('[NZBDAV] HEAD request failed; continuing without pre-fetched size:', headError.message);
    }
  }

  const requestConfig = {
    url: targetUrl,
    method: proxiedMethod,
    headers,
    responseType: 'stream',
    timeout: NZBDAV_STREAM_TIMEOUT_MS,
    validateStatus: (status) => status < 500
  };

  if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
    requestConfig.auth = {
      username: NZBDAV_WEBDAV_USER,
      password: NZBDAV_WEBDAV_PASS
    };
  }

  console.log(`[NZBDAV] Proxying ${proxiedMethod}${emulateHead ? ' (HEAD emulation)' : ''} ${targetUrl}`);

  const nzbdavResponse = await axios.request(requestConfig);

  // Fix range request status codes: if response has Content-Range but status is 200, change to 206
  // Exception: HEAD emulation should always return 200
  let responseStatus = nzbdavResponse.status;
  const responseHeadersLower = Object.keys(nzbdavResponse.headers || {}).reduce((map, key) => {
    map[key.toLowerCase()] = nzbdavResponse.headers[key];
    return map;
  }, {});

  const incomingContentRange = responseHeadersLower['content-range'];
  if (incomingContentRange && responseStatus === 200 && !emulateHead) {
    responseStatus = 206;
  }

  // HEAD requests should always return 200, not 206
  if (emulateHead) {
    responseStatus = 200;
  }

  res.status(responseStatus);

  // Header blocklist - block sensitive headers from being proxied
  const headerBlocklist = new Set([
    'transfer-encoding',
    'www-authenticate',
    'set-cookie',
    'cookie',
    'authorization'
  ]);

  // Proxy headers with blocklist filtering
  Object.entries(nzbdavResponse.headers || {}).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (headerBlocklist.has(lowerKey)) {
      return;
    }
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  });

  // Set Content-Disposition if not already set
  const incomingDisposition = nzbdavResponse.headers?.['content-disposition'];
  const hasFilenameInDisposition = typeof incomingDisposition === 'string' && /filename=/i.test(incomingDisposition);
  if (!hasFilenameInDisposition) {
    res.setHeader('Content-Disposition', `inline; filename="${sanitizedFileName}"`);
  }

  // MIME type inference - set Content-Type if missing or generic
  const inferredMime = inferMimeType(sanitizedFileName);
  if (!res.getHeader('Content-Type') || res.getHeader('Content-Type') === 'application/octet-stream') {
    res.setHeader('Content-Type', inferredMime);
  }

  // Ensure Accept-Ranges header is set
  const acceptRangesHeader = res.getHeader('Accept-Ranges');
  if (!acceptRangesHeader) {
    res.setHeader('Accept-Ranges', 'bytes');
  }

  // Content-Length recalculation for range requests
  const contentLengthHeader = res.getHeader('Content-Length');
  if (incomingContentRange) {
    // Parse Content-Range header (format: "bytes start-end/total")
    const match = incomingContentRange.match(/bytes\s+(\d+)-(\d+)\s*\/\s*(\d+|\*)/i);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const totalSize = match[3] !== '*' ? Number(match[3]) : null;

      // For HEAD emulation: use total size, not chunk length
      if (emulateHead) {
        if (Number.isFinite(totalSize)) {
          res.setHeader('Content-Length', String(totalSize));
          res.setHeader('X-Total-Length', String(totalSize));
          console.log(`[NZBDAV] ✅ HEAD emulation: Set Content-Length: ${totalSize} (total file size)`);
        }
      } else {
        // Calculate actual chunk length from range (end - start + 1)
        const chunkLength = Number.isFinite(start) && Number.isFinite(end) ? end - start + 1 : null;

        console.log('[NZBDAV] Calculated chunk length:', { start, end, chunkLength, totalSize });

        if (Number.isFinite(chunkLength) && chunkLength > 0) {
          // Set Content-Length to chunk length (not total size)
          res.setHeader('Content-Length', String(chunkLength));
          console.log(`[NZBDAV] ✅ Set Content-Length: ${chunkLength} (from Content-Range: bytes ${start}-${end}/${totalSize || '*'})`);
        } else {
          console.error('[NZBDAV] ❌ Failed to calculate valid chunk length!');
        }

        // Optionally set X-Total-Length to total file size
        if (Number.isFinite(totalSize)) {
          res.setHeader('X-Total-Length', String(totalSize));
        }
      }
    } else {
      console.error('[NZBDAV] ❌ Failed to parse Content-Range header!');
    }
  } else if ((!contentLengthHeader || Number(contentLengthHeader) === 0) && Number.isFinite(totalFileSize)) {
    res.setHeader('Content-Length', String(totalFileSize));
    console.log(`[NZBDAV] Set Content-Length: ${totalFileSize} (from HEAD request)`);
  } else if ((!contentLengthHeader || Number(contentLengthHeader) === 0) && streamData && Number.isFinite(streamData.size)) {
    res.setHeader('Content-Length', String(streamData.size));
    console.log(`[NZBDAV] Set Content-Length: ${streamData.size} (from streamData fallback)`);
  } else if (!contentLengthHeader || Number(contentLengthHeader) === 0) {
    console.warn('[NZBDAV] Warning: No Content-Length or Content-Range header available');
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');

  // Handle HEAD requests or non-streamable responses
  if (emulateHead || !nzbdavResponse.data || typeof nzbdavResponse.data.pipe !== 'function') {
    if (nzbdavResponse.data && typeof nzbdavResponse.data.destroy === 'function') {
      nzbdavResponse.data.destroy();
    }
    res.end();
    return;
  }

  try {
    await pipelineAsync(nzbdavResponse.data, res);
  } catch (error) {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.warn('[NZBDAV] Stream closed early by client');
      return;
    }
    console.error('[NZBDAV] Error while piping stream:', error.message);
    throw error;
  }
}

module.exports = {
  normalizeReleaseTitle,
  fetchCompletedNzbdavHistory,
  buildNzbdavCacheKey,
  getNzbdavCategory,
  buildNzbdavStream,
  proxyNzbdavStream,
  streamFailureVideo
};
