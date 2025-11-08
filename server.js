require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const { pipeline } = require("stream");
const { promisify } = require("util");
// webdav is an ES module; we'll import it lazily when first needed
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 7000);

app.use(cors());
app.use("/assets", express.static(path.join(__dirname, "assets")));

function extractTokenFromRequest(req) {
  if (req.query && typeof req.query.token === "string") {
    return req.query.token.trim();
  }
  const authHeader = req.headers["authorization"] ||
    req.headers["x-addon-token"];
  if (typeof authHeader === "string") {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && /^token$/i.test(parts[0])) {
      return parts[1].trim();
    }
    return authHeader.trim();
  }
  return "";
}

function ensureSharedSecret(req, res, next) {
  if (!ADDON_SHARED_SECRET) {
    next();
    return;
  }
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  const providedToken = extractTokenFromRequest(req);
  if (!providedToken || providedToken !== ADDON_SHARED_SECRET) {
    res.status(401).json({
      error: "Unauthorized: invalid or missing addon token",
    });
    return;
  }
  next();
}

app.use((req, res, next) => {
  if (req.path.startsWith("/assets/")) {
    return next();
  }
  return ensureSharedSecret(req, res, next);
});

// Configure indexer manager (Prowlarr or NZBHydra)
const INDEXER_MANAGER = (process.env.INDEXER_MANAGER || "prowlarr").trim()
  .toLowerCase();
const INDEXER_MANAGER_URL =
  (process.env.INDEXER_MANAGER_URL || process.env.PROWLARR_URL || "").trim();
const INDEXER_MANAGER_API_KEY =
  (process.env.INDEXER_MANAGER_API_KEY || process.env.PROWLARR_API_KEY || "")
    .trim();
const INDEXER_MANAGER_STRICT_ID_MATCH =
  (process.env.INDEXER_MANAGER_STRICT_ID_MATCH ||
    process.env.PROWLARR_STRICT_ID_MATCH || "false").toLowerCase() === "true";
const INDEXER_MANAGER_INDEXERS = (() => {
  const fallback = INDEXER_MANAGER === "nzbhydra" ? "" : "-1";
  const raw =
    (process.env.INDEXER_MANAGER_INDEXERS || process.env.PROWLARR_INDEXER_IDS ||
      "").trim();
  if (!raw) return fallback;
  const joined = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .join(",");
  return joined || fallback;
})();
const INDEXER_MANAGER_LABEL = INDEXER_MANAGER === "nzbhydra"
  ? "NZBHydra"
  : "Prowlarr";
const INDEXER_LOG_PREFIX = `[${INDEXER_MANAGER_LABEL.toUpperCase()}]`;
const INDEXER_MANAGER_CACHE_MINUTES = (() => {
  const raw = Number(process.env.INDEXER_MANAGER_CACHE_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
})();
const INDEXER_MANAGER_BASE_URL = INDEXER_MANAGER_URL.replace(/\/+$/, "");
const ADDON_SHARED_SECRET = (process.env.ADDON_SHARED_SECRET || "").trim();

// Configure NZBDav
const ADDON_BASE_URL = (process.env.ADDON_BASE_URL || "").trim();
const NZBDAV_URL = (process.env.NZBDAV_URL || "").trim();
const NZBDAV_API_KEY = (process.env.NZBDAV_API_KEY || "").trim();
const NZBDAV_CATEGORY_MOVIES = process.env.NZBDAV_CATEGORY_MOVIES || "Movies";
const NZBDAV_CATEGORY_SERIES = process.env.NZBDAV_CATEGORY_SERIES || "Tv";
const NZBDAV_CATEGORY_DEFAULT = process.env.NZBDAV_CATEGORY_DEFAULT || "Movies";
const NZBDAV_CATEGORY_OVERRIDE = (process.env.NZBDAV_CATEGORY || "").trim();
const NZBDAV_POLL_INTERVAL_MS = 2000;
const NZBDAV_POLL_TIMEOUT_MS = 80000;
const NZBDAV_CACHE_TTL_MS = 3600000;
const NZBDAV_MAX_DIRECTORY_DEPTH = 6;
const NZBDAV_WEBDAV_USER = (process.env.NZBDAV_WEBDAV_USER || "").trim();
const NZBDAV_WEBDAV_PASS = (process.env.NZBDAV_WEBDAV_PASS || "").trim();
const NZBDAV_WEBDAV_ROOT = "/";
const NZBDAV_WEBDAV_URL = (process.env.NZBDAV_WEBDAV_URL || NZBDAV_URL).trim();
const NZBDAV_API_TIMEOUT_MS = 80000;
const NZBDAV_HISTORY_TIMEOUT_MS = 60000;
const NZBDAV_STREAM_TIMEOUT_MS = 240000;
const FAILURE_VIDEO_FILENAME = "failure_video.mp4";
const FAILURE_VIDEO_PATH = path.resolve(
  __dirname,
  "assets",
  FAILURE_VIDEO_FILENAME,
);
const STREAM_HIGH_WATER_MARK = (() => {
  const parsed = Number(process.env.STREAM_HIGH_WATER_MARK);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();

const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
const pipelineAsync = promisify(pipeline);

const posixPath = path.posix;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nzbdavStreamCache = new Map();
const NZBDAV_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".ts",
  ".m2ts",
  ".mpg",
  ".mpeg",
]);
const NZBDAV_SUPPORTED_METHODS = new Set(["GET", "HEAD"]);
const VIDEO_MIME_MAP = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mkv", "video/x-matroska"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".mov", "video/quicktime"],
  [".wmv", "video/x-ms-wmv"],
  [".flv", "video/x-flv"],
  [".ts", "video/mp2t"],
  [".m2ts", "video/mp2t"],
  [".mpg", "video/mpeg"],
  [".mpeg", "video/mpeg"],
]);

function ensureNzbdavConfigured() {
  if (!NZBDAV_URL) {
    throw new Error("NZBDAV_URL is not configured");
  }
  if (!NZBDAV_API_KEY) {
    throw new Error("NZBDAV_API_KEY is not configured");
  }
  if (!NZBDAV_WEBDAV_URL) {
    throw new Error("NZBDAV_WEBDAV_URL is not configured");
  }
}

function ensureIndexerManagerConfigured() {
  if (!INDEXER_MANAGER_URL) {
    throw new Error("INDEXER_MANAGER_URL is not configured");
  }
  if (!INDEXER_MANAGER_API_KEY) {
    throw new Error("INDEXER_MANAGER_API_KEY is not configured");
  }
}

function ensureAddonConfigured() {
  if (!ADDON_BASE_URL) {
    throw new Error("ADDON_BASE_URL is not configured");
  }
}

const isUsingProwlarr = () => INDEXER_MANAGER === "prowlarr";
const isUsingNzbhydra = () => INDEXER_MANAGER === "nzbhydra";

function buildProwlarrSearchParams(plan) {
  return {
    limit: "25",
    offset: "0",
    type: plan.type,
    query: plan.query,
    indexerIds: INDEXER_MANAGER_INDEXERS || undefined,
  };
}

async function executeProwlarrSearch(plan) {
  const params = buildProwlarrSearchParams(plan);
  const response = await axios.get(
    `${INDEXER_MANAGER_BASE_URL}/api/v1/search`,
    {
      params,
      headers: { "X-Api-Key": INDEXER_MANAGER_API_KEY },
      timeout: 60000,
    },
  );
  return Array.isArray(response.data) ? response.data : [];
}

function mapHydraSearchType(planType) {
  if (
    planType === "tvsearch" || planType === "movie" || planType === "search" ||
    planType === "book"
  ) {
    return planType;
  }
  return "search";
}

function applyTokenToHydraParams(token, params) {
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) {
    return;
  }
  const key = match[1].trim().toLowerCase();
  const rawValue = match[2].trim();

  switch (key) {
    case "imdbid": {
      const value = rawValue.replace(/^tt/i, "");
      if (value) params.imdbid = value;
      break;
    }
    case "tmdbid":
      if (rawValue) params.tmdbid = rawValue;
      break;
    case "tvdbid":
      if (rawValue) params.tvdbid = rawValue;
      break;
    case "season":
      if (rawValue) params.season = rawValue;
      break;
    case "episode":
      if (rawValue) params.ep = rawValue;
      break;
    default:
      break;
  }
}

function buildHydraSearchParams(plan) {
  const params = {
    apikey: INDEXER_MANAGER_API_KEY,
    t: mapHydraSearchType(plan.type),
    o: "json",
  };

  if (INDEXER_MANAGER_INDEXERS) {
    params.indexers = INDEXER_MANAGER_INDEXERS;
  }

  if (INDEXER_MANAGER_CACHE_MINUTES > 0) {
    params.cachetime = String(INDEXER_MANAGER_CACHE_MINUTES);
  }

  if (Array.isArray(plan.tokens)) {
    plan.tokens.forEach((token) => applyTokenToHydraParams(token, params));
  }

  if (plan.rawQuery) {
    params.q = plan.rawQuery;
  } else if ((!plan.tokens || plan.tokens.length === 0) && plan.query) {
    params.q = plan.query;
  }

  return params;
}

function extractHydraAttrMap(item) {
  const attrMap = {};
  const attrSources = [];

  const collectSource = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => attrSources.push(entry));
    } else {
      attrSources.push(source);
    }
  };

  collectSource(item.attr);
  collectSource(item.attrs);
  collectSource(item.attributes);
  collectSource(item["newznab:attr"]);
  collectSource(item["newznab:attrs"]);

  attrSources.forEach((attr) => {
    if (!attr) return;
    const entry = attr["@attributes"] || attr.attributes || attr.$ || attr;
    const rawName = entry.name ??
      entry.Name ??
      entry["@name"] ??
      entry["@Name"] ??
      entry.key ??
      entry.Key ??
      entry["@key"] ??
      entry["@Key"] ??
      entry.field ??
      entry.Field ??
      "";
    const name = rawName.toString().trim().toLowerCase();
    if (!name) return;
    const value = entry.value ??
      entry.Value ??
      entry["@value"] ??
      entry["@Value"] ??
      entry.val ??
      entry.Val ??
      entry.content ??
      entry.Content ??
      entry["#text"] ??
      entry.text ??
      entry["@text"];
    if (value !== undefined && value !== null) {
      attrMap[name] = value;
    }
  });

  return attrMap;
}

function normalizeHydraResults(data) {
  if (!data) return [];

  const resolveItems = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.item) return resolveItems(payload.item);
    return [payload];
  };

  const channel = data.channel || data.rss?.channel || data["rss"]?.channel;
  const items = resolveItems(channel || data.item || []);

  const results = [];

  for (const item of items) {
    if (!item) continue;
    const title = item.title || item["title"] || null;

    let downloadUrl = null;
    const enclosure = item.enclosure || item["enclosure"];
    if (enclosure) {
      const enclosureObj = Array.isArray(enclosure) ? enclosure[0] : enclosure;
      downloadUrl = enclosureObj?.url || enclosureObj?.["@url"] ||
        enclosureObj?.href || enclosureObj?.link;
    }
    if (!downloadUrl) {
      downloadUrl = item.link || item["link"];
    }
    if (!downloadUrl) {
      const guid = item.guid || item["guid"];
      if (typeof guid === "string") {
        downloadUrl = guid;
      } else if (guid && typeof guid === "object") {
        downloadUrl = guid._ || guid["#text"] || guid.url || guid.href;
      }
    }
    if (!downloadUrl) {
      continue;
    }

    const attrMap = extractHydraAttrMap(item);
    const resolveFirst = (...candidates) => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        if (Array.isArray(candidate)) {
          const inner = resolveFirst(...candidate);
          if (inner !== undefined && inner !== null) return inner;
          continue;
        }
        if (typeof candidate === "string") {
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          return trimmed;
        }
        return candidate;
      }
      return undefined;
    };

    const enclosureObj = Array.isArray(enclosure) ? enclosure?.[0] : enclosure;
    const enclosureLength = enclosureObj?.length || enclosureObj?.["@length"] ||
      enclosureObj?.["$"]?.length || enclosureObj?.["@attributes"]?.length;

    const sizeValue = resolveFirst(
      attrMap.size,
      attrMap.filesize,
      attrMap["contentlength"],
      attrMap["content-length"],
      attrMap.length,
      attrMap.nzbsize,
      item.size,
      item.Size,
      enclosureLength,
    );
    const parsedSize = sizeValue !== undefined
      ? Number.parseInt(String(sizeValue), 10)
      : NaN;
    const indexer = resolveFirst(
      attrMap.indexername,
      attrMap.indexer,
      attrMap["hydraindexername"],
      attrMap["hydraindexer"],
      item.hydraIndexerName,
      item.hydraindexername,
      item.hydraIndexer,
      item.hydraindexer,
      item.indexer,
      item.Indexer,
    );
    const indexerId =
      resolveFirst(
        attrMap.indexerid,
        attrMap["hydraindexerid"],
        item.hydraIndexerId,
        item.hydraindexerid,
        indexer,
      ) || "nzbhydra";

    const guidRaw = item.guid || item["guid"];
    let guidValue = null;
    if (typeof guidRaw === "string") {
      guidValue = guidRaw;
    } else if (guidRaw && typeof guidRaw === "object") {
      guidValue = guidRaw._ || guidRaw["#text"] || guidRaw.url ||
        guidRaw.href || null;
    }

    results.push({
      title: title || downloadUrl,
      downloadUrl,
      guid: guidValue,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
      indexer,
      indexerId,
    });
  }

  return results;
}

async function executeNzbhydraSearch(plan) {
  const params = buildHydraSearchParams(plan);
  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api`, {
    params,
    timeout: 60000,
  });
  return normalizeHydraResults(response.data);
}

function executeIndexerPlan(plan) {
  if (isUsingNzbhydra()) {
    return executeNzbhydraSearch(plan);
  }
  return executeProwlarrSearch(plan);
}

function getNzbdavCategory(type) {
  let baseCategory;
  let suffixKey;

  if (type === "series" || type === "tv") {
    baseCategory = NZBDAV_CATEGORY_SERIES;
    suffixKey = "TV";
  } else if (type === "movie") {
    baseCategory = NZBDAV_CATEGORY_MOVIES;
    suffixKey = "MOVIE";
  } else {
    baseCategory = NZBDAV_CATEGORY_DEFAULT;
    suffixKey = "DEFAULT";
  }

  if (NZBDAV_CATEGORY_OVERRIDE) {
    return `${NZBDAV_CATEGORY_OVERRIDE}_${suffixKey}`;
  }

  return baseCategory;
}

function buildNzbdavApiParams(mode, extra = {}) {
  return {
    mode,
    apikey: NZBDAV_API_KEY,
    ...extra,
  };
}

async function addNzbToNzbdav(nzbUrl, category, jobLabel) {
  ensureNzbdavConfigured();

  if (!nzbUrl) {
    throw new Error("Missing NZB download URL");
  }
  if (!category) {
    throw new Error("Missing NZBDav category");
  }

  console.log(
    `[NZBDAV] Queueing NZB for category=${category} (${
      jobLabel || "untitled"
    })`,
  );

  const params = buildNzbdavApiParams("addurl", {
    name: nzbUrl,
    cat: category,
    nzbname: jobLabel || undefined,
    output: "json",
  });

  const headers = {};
  if (NZBDAV_API_KEY) {
    headers["x-api-key"] = NZBDAV_API_KEY;
  }

  const response = await axios.get(`${NZBDAV_URL}/api`, {
    params,
    timeout: NZBDAV_API_TIMEOUT_MS,
    headers,
    validateStatus: (status) => status < 500,
  });

  if (!response.data?.status) {
    const errorMessage = response.data?.error ||
      `addurl returned status ${response.status}`;
    throw new Error(`[NZBDAV] Failed to queue NZB: ${errorMessage}`);
  }

  const nzoId = response.data?.nzo_id ||
    response.data?.nzoId ||
    response.data?.NzoId ||
    (Array.isArray(response.data?.nzo_ids) && response.data.nzo_ids[0]) ||
    (Array.isArray(response.data?.queue) && response.data.queue[0]?.nzo_id);

  if (!nzoId) {
    throw new Error("[NZBDAV] addurl succeeded but no nzo_id returned");
  }

  console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
  return { nzoId };
}

async function waitForNzbdavHistorySlot(nzoId, category) {
  ensureNzbdavConfigured();
  const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const params = buildNzbdavApiParams("history", {
      start: "0",
      limit: "50",
      category,
    });

    const headers = {};
    if (NZBDAV_API_KEY) {
      headers["x-api-key"] = NZBDAV_API_KEY;
    }

    const response = await axios.get(`${NZBDAV_URL}/api`, {
      params,
      timeout: NZBDAV_HISTORY_TIMEOUT_MS,
      headers,
      validateStatus: (status) => status < 500,
    });

    if (!response.data?.status) {
      const errorMessage = response.data?.error ||
        `history returned status ${response.status}`;
      throw new Error(`[NZBDAV] Failed to query history: ${errorMessage}`);
    }

    const history = response.data?.history || response.data?.History;
    const slots = history?.slots || history?.Slots || [];
    const slot = slots.find((entry) => {
      const entryId = entry?.nzo_id || entry?.nzoId || entry?.NzoId;
      return entryId === nzoId;
    });

    if (slot) {
      const status = (slot.status || slot.Status || "").toString()
        .toLowerCase();
      if (status === "completed") {
        console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
        return slot;
      }
      if (status === "failed") {
        const failMessage = slot.fail_message || slot.failMessage ||
          slot.FailMessage || "Unknown NZBDav error";
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

  throw new Error(
    "[NZBDAV] Timeout while waiting for NZB to become streamable",
  );
}

const getWebdavClient = (() => {
  let clientPromise = null;
  return async () => {
    if (clientPromise) return clientPromise;

    clientPromise = (async () => {
      const { createClient } = await import("webdav");

      const trimmedBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
      const rootSegment = (NZBDAV_WEBDAV_ROOT || "").replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const baseUrl = rootSegment
        ? `${trimmedBase}/${rootSegment}`
        : trimmedBase;

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

async function listWebdavDirectory(directory) {
  const client = await getWebdavClient();
  const normalizedPath = normalizeNzbdavPath(directory);
  const relativePath = normalizedPath === "/"
    ? "/"
    : normalizedPath.replace(/^\/+/, "");

  try {
    const entries = await client.getDirectoryContents(relativePath, {
      deep: false,
    });
    return entries.map((entry) => ({
      name: entry?.basename ?? entry?.filename ?? "",
      isDirectory: entry?.type === "directory",
      size: entry?.size ?? null,
      href: entry?.filename ?? entry?.href ?? null,
    }));
  } catch (error) {
    throw new Error(
      `[NZBDAV] Failed to list ${relativePath}: ${error.message}`,
    );
  }
}

function isVideoFileName(fileName = "") {
  const extension = posixPath.extname(fileName.toLowerCase());
  return NZBDAV_VIDEO_EXTENSIONS.has(extension);
}

function fileMatchesEpisode(fileName, requestedEpisode) {
  if (!requestedEpisode) {
    return true;
  }
  const { season, episode } = requestedEpisode;
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?![0-9])`, "i"),
    new RegExp(`s0*${season}\.?e0*${episode}(?![0-9])`, "i"),
    new RegExp(`0*${season}[xX]0*${episode}(?![0-9])`, "i"),
    new RegExp(`[eE](?:pisode|p)\.?\s*0*${episode}(?![0-9])`, "i"),
  ];
  return patterns.some((regex) => regex.test(fileName));
}

function parseRequestedEpisode(type, id, query = {}) {
  const extractInt = (value) => {
    if (value === undefined || value === null) return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const seasonFromQuery = extractInt(query.season ?? query.Season ?? query.S);
  const episodeFromQuery = extractInt(
    query.episode ?? query.Episode ?? query.E,
  );

  if (seasonFromQuery && episodeFromQuery) {
    return { season: seasonFromQuery, episode: episodeFromQuery };
  }

  if (type === "series" && typeof id === "string" && id.includes(":")) {
    const parts = id.split(":");
    if (parts.length >= 3) {
      const season = extractInt(parts[1]);
      const episode = extractInt(parts[2]);
      if (season && episode) {
        return { season, episode };
      }
    }
  }

  return null;
}

function normalizeNzbdavPath(pathValue) {
  if (!pathValue) {
    return "/";
  }
  const normalized = pathValue.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function inferMimeType(fileName) {
  if (!fileName) return "application/octet-stream";
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

async function safeStat(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    return null;
  }
}

async function streamFileResponse(
  req,
  res,
  absolutePath,
  emulateHead,
  logPrefix,
  existingStats = null,
) {
  const stats = existingStats || (await safeStat(absolutePath));
  if (!stats || !stats.isFile()) {
    return false;
  }

  const totalSize = stats.size;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Last-Modified", stats.mtime.toUTCString());
  res.setHeader("Content-Type", "application/octet-stream");

  if (emulateHead) {
    res.setHeader("Content-Length", totalSize);
    res.status(200).end();
    console.log(`[${logPrefix}] Served HEAD for ${absolutePath}`);
    return true;
  }

  let start = 0;
  let end = totalSize - 1;
  let statusCode = 200;

  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const [, rangeSpec] = rangeHeader.split("=");
    const [rangeStart, rangeEnd] = rangeSpec.split("-");

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
      res.status(416).setHeader("Content-Range", `bytes */${totalSize}`);
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
    highWaterMark: STREAM_HIGH_WATER_MARK,
  });

  if (statusCode === 206) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Content-Length", chunkSize);
    console.log(
      `[${logPrefix}] Serving partial bytes ${start}-${end} from ${absolutePath}`,
    );
  } else {
    res.status(200);
    res.setHeader("Content-Length", totalSize);
    console.log(`[${logPrefix}] Serving full file from ${absolutePath}`);
  }

  try {
    await pipelineAsync(readStream, res);
  } catch (error) {
    if (error?.code === "ERR_STREAM_PREMATURE_CLOSE") {
      console.warn(
        `[${logPrefix}] Stream closed early for ${absolutePath}: ${error.message}`,
      );
      return true;
    }
    console.error(
      `[${logPrefix}] Pipeline error for ${absolutePath}:`,
      error.message,
    );
    throw error;
  }

  return true;
}

async function streamFailureVideo(req, res, failureError) {
  const stats = await safeStat(FAILURE_VIDEO_PATH);
  if (!stats || !stats.isFile()) {
    console.error(
      `[FAILURE STREAM] Failure video not found at ${FAILURE_VIDEO_PATH}`,
    );
    return false;
  }

  const emulateHead = (req.method || "GET").toUpperCase() === "HEAD";
  const failureMessage = failureError?.failureMessage ||
    failureError?.message || "NZBDav download failed";

  if (!res.headersSent) {
    res.setHeader("X-NZBDav-Failure", failureMessage);
  }

  console.warn(
    `[FAILURE STREAM] Serving fallback video due to NZBDav failure: ${failureMessage}`,
  );
  return streamFileResponse(
    req,
    res,
    FAILURE_VIDEO_PATH,
    emulateHead,
    "FAILURE STREAM",
    stats,
  );
}

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
        viewPath: nextPath.replace(/^\/+/, ""),
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

function cleanupNzbdavCache() {
  if (NZBDAV_CACHE_TTL_MS <= 0) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of nzbdavStreamCache.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      nzbdavStreamCache.delete(key);
    }
  }
}

async function getOrCreateNzbdavStream(cacheKey, builder) {
  cleanupNzbdavCache();
  const existing = nzbdavStreamCache.get(cacheKey);

  if (existing) {
    if (existing.status === "ready") {
      return existing.data;
    }
    if (existing.status === "pending") {
      return existing.promise;
    }
    if (existing.status === "failed") {
      throw existing.error;
    }
  }

  const promise = (async () => {
    const data = await builder();
    nzbdavStreamCache.set(cacheKey, {
      status: "ready",
      data,
      expiresAt: NZBDAV_CACHE_TTL_MS > 0
        ? Date.now() + NZBDAV_CACHE_TTL_MS
        : null,
    });
    return data;
  })();

  nzbdavStreamCache.set(cacheKey, { status: "pending", promise });

  try {
    return await promise;
  } catch (error) {
    if (error?.isNzbdavFailure) {
      nzbdavStreamCache.set(cacheKey, {
        status: "failed",
        error,
        expiresAt: NZBDAV_CACHE_TTL_MS > 0
          ? Date.now() + NZBDAV_CACHE_TTL_MS
          : null,
      });
    } else {
      nzbdavStreamCache.delete(cacheKey);
    }
    throw error;
  }
}

async function buildNzbdavStream(
  { downloadUrl, category, title, requestedEpisode },
) {
  try {
    const { nzoId } = await addNzbToNzbdav(downloadUrl, category, title);
    const slot = await waitForNzbdavHistorySlot(nzoId, category);
    const slotCategory = slot?.category || slot?.Category || category;
    const slotJobName = slot?.job_name || slot?.JobName || slot?.name ||
      slot?.Name;

    if (!slotJobName) {
      throw new Error("[NZBDAV] Unable to determine job name from history");
    }

    const bestFile = await findBestVideoFile({
      category: slotCategory,
      jobName: slotJobName,
      requestedEpisode,
    });

    if (!bestFile) {
      throw new Error(
        "[NZBDAV] No playable video files found after mounting NZB",
      );
    }

    console.log(
      `[NZBDAV] Selected file ${bestFile.viewPath} (${bestFile.size} bytes)`,
    );

    return {
      nzoId,
      category: slotCategory,
      jobName: slotJobName,
      viewPath: bestFile.viewPath,
      size: bestFile.size,
      fileName: bestFile.name,
    };
  } catch (error) {
    if (error?.isNzbdavFailure) {
      error.downloadUrl = downloadUrl;
      error.category = category;
      error.title = title;
    }
    throw error;
  }
}

async function proxyNzbdavStream(req, res, viewPath, fileNameHint = "") {
  const originalMethod = (req.method || "GET").toUpperCase();
  if (!NZBDAV_SUPPORTED_METHODS.has(originalMethod)) {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const emulateHead = originalMethod === "HEAD";
  const proxiedMethod = emulateHead ? "GET" : originalMethod;

  const normalizedPath = normalizeNzbdavPath(viewPath);
  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const webdavBase = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
  const targetUrl = `${webdavBase}${encodedPath}`;
  const headers = {};

  console.log(`[NZBDAV] Streaming ${normalizedPath} via WebDAV`);

  const coerceToString = (value) => {
    if (Array.isArray(value)) {
      return value.find((item) =>
        typeof item === "string" && item.trim().length > 0
      ) || "";
    }
    return typeof value === "string" ? value : "";
  };

  let derivedFileName = typeof fileNameHint === "string"
    ? fileNameHint.trim()
    : "";
  if (!derivedFileName) {
    const segments = normalizedPath.split("/").filter(Boolean);
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
    derivedFileName = coerceToString(req.query?.title || "").trim();
  }
  if (!derivedFileName) {
    derivedFileName = "stream";
  }

  const sanitizedFileName = derivedFileName.replace(/[\\/:*?"<>|]+/g, "_") ||
    "stream";

  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers["if-range"]) headers["If-Range"] = req.headers["if-range"];
  if (req.headers.accept) headers.Accept = req.headers.accept;
  if (req.headers["accept-language"]) {
    headers["Accept-Language"] = req.headers["accept-language"];
  }
  if (req.headers["accept-encoding"]) {
    headers["Accept-Encoding"] = req.headers["accept-encoding"];
  }
  if (req.headers["user-agent"]) {
    headers["User-Agent"] = req.headers["user-agent"];
  }
  if (!headers["Accept-Encoding"]) headers["Accept-Encoding"] = "identity";
  if (emulateHead && !headers.Range) {
    headers.Range = "bytes=0-0";
  }

  const requestConfig = {
    url: targetUrl,
    method: proxiedMethod,
    headers,
    responseType: "stream",
    timeout: NZBDAV_STREAM_TIMEOUT_MS,
    validateStatus: (status) => status < 500,
  };

  if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
    requestConfig.auth = {
      username: NZBDAV_WEBDAV_USER,
      password: NZBDAV_WEBDAV_PASS,
    };
  }

  console.log(
    `[NZBDAV] Proxying ${proxiedMethod}${
      emulateHead ? " (HEAD emulation)" : ""
    } ${targetUrl}`,
  );

  const nzbdavResponse = await axios.request(requestConfig);

  let responseStatus = nzbdavResponse.status;
  const responseHeadersLower = Object.keys(nzbdavResponse.headers || {}).reduce(
    (map, key) => {
      map[key.toLowerCase()] = nzbdavResponse.headers[key];
      return map;
    },
    {},
  );

  const incomingContentRange = responseHeadersLower["content-range"];
  if (incomingContentRange && responseStatus === 200) {
    responseStatus = 206;
  }

  res.status(responseStatus);

  const headerBlocklist = new Set([
    "transfer-encoding",
    "www-authenticate",
    "set-cookie",
    "cookie",
    "authorization",
  ]);

  Object.entries(nzbdavResponse.headers || {}).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (headerBlocklist.has(lowerKey)) {
      return;
    }
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  });

  const incomingDisposition = nzbdavResponse.headers?.["content-disposition"];
  const hasFilenameInDisposition = typeof incomingDisposition === "string" &&
    /filename=/i.test(incomingDisposition);
  if (!hasFilenameInDisposition) {
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${sanitizedFileName}"`,
    );
  }

  const inferredMime = inferMimeType(sanitizedFileName);
  if (
    !res.getHeader("Content-Type") ||
    res.getHeader("Content-Type") === "application/octet-stream"
  ) {
    res.setHeader("Content-Type", inferredMime);
  }

  const acceptRangesHeader = res.getHeader("Accept-Ranges");
  if (!acceptRangesHeader) {
    res.setHeader("Accept-Ranges", "bytes");
  }

  let contentLengthHeader = res.getHeader("Content-Length");
  if (
    (!contentLengthHeader || Number(contentLengthHeader) === 0) &&
    incomingContentRange
  ) {
    const match = incomingContentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const chunkLength = Number.isFinite(start) && Number.isFinite(end)
        ? end - start + 1
        : null;
      if (Number.isFinite(chunkLength)) {
        res.setHeader("Content-Length", String(chunkLength));
      }
      if (match[3] && match[3] !== "*" && !res.getHeader("X-Total-Length")) {
        res.setHeader("X-Total-Length", match[3]);
      }
    }
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length,Content-Range,Content-Type",
  );

  if (
    emulateHead || !nzbdavResponse.data ||
    typeof nzbdavResponse.data.pipe !== "function"
  ) {
    if (
      nzbdavResponse.data && typeof nzbdavResponse.data.destroy === "function"
    ) {
      nzbdavResponse.data.destroy();
    }
    res.end();
    return;
  }

  try {
    await pipelineAsync(nzbdavResponse.data, res);
  } catch (error) {
    if (error?.code === "ERR_STREAM_PREMATURE_CLOSE") {
      console.warn("[NZBDAV] Stream closed early by client");
      return;
    }
    console.error("[NZBDAV] Error while piping stream:", error.message);
    throw error;
  }
}

// Manifest endpoint
app.get("/manifest.json", (req, res) => {
  ensureAddonConfigured();

  res.json({
    id: "com.usenet.streamer",
    version: "1.1.0",
    name: "UsenetStreamer",
    description:
      "Usenet-powered instant streams for Stremio via Prowlarr/NZBHydra and NZBDav",
    logo: `${ADDON_BASE_URL.replace(/\/$/, "")}/assets/icon.png`,
    resources: ["stream"],
    types: ["movie", "series", "channel", "tv"],
    catalogs: [],
    idPrefixes: ["tt"],
  });
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  console.log(`[REQUEST] Received request for ${type} ID: ${id}`);

  const primaryId = id.split(":")[0];
  if (!/^tt\d+$/.test(primaryId)) {
    res.status(400).json({
      error: `Unsupported ID prefix for indexer manager search: ${primaryId}`,
    });
    return;
  }

  try {
    ensureAddonConfigured();
    ensureIndexerManagerConfigured();
    ensureNzbdavConfigured();

    const pickFirstDefined = (...values) =>
      values.find((value) =>
        value !== undefined && value !== null && String(value).trim() !== ""
      ) || null;
    const meta = req.query || {};

    console.log("[REQUEST] Raw query payload from Stremio", meta);

    const hasTvdbInQuery = Boolean(
      pickFirstDefined(
        meta.tvdbId,
        meta.tvdb_id,
        meta.tvdb,
        meta.tvdbSlug,
        meta.tvdbid,
      ),
    );

    const hasTmdbInQuery = Boolean(
      pickFirstDefined(
        meta.tmdbId,
        meta.tmdb_id,
        meta.tmdb,
        meta.tmdbSlug,
        meta.tmdbid,
      ),
    );

    const hasTitleInQuery = Boolean(
      pickFirstDefined(
        meta.title,
        meta.name,
        meta.originalTitle,
        meta.original_title,
      ),
    );

    const metaSources = [meta];
    let cinemetaMeta = null;

    const needsCinemeta = (!hasTitleInQuery) ||
      (type === "series" && !hasTvdbInQuery) ||
      (type === "movie" && !hasTmdbInQuery);
    if (needsCinemeta) {
      const cinemetaPath = type === "series"
        ? `series/${primaryId}.json`
        : `${type}/${primaryId}.json`;
      const cinemetaUrl = `${CINEMETA_URL}/${cinemetaPath}`;
      try {
        console.log(`[CINEMETA] Fetching metadata from ${cinemetaUrl}`);
        const cinemetaResponse = await axios.get(cinemetaUrl, {
          timeout: 10000,
        });
        cinemetaMeta = cinemetaResponse.data?.meta || null;
        if (cinemetaMeta) {
          metaSources.push(cinemetaMeta);
          console.log("[CINEMETA] Received metadata identifiers", {
            imdb: cinemetaMeta?.ids?.imdb || cinemetaMeta?.imdb_id,
            tvdb: cinemetaMeta?.ids?.tvdb || cinemetaMeta?.tvdb_id,
            tmdb: cinemetaMeta?.ids?.tmdb || cinemetaMeta?.tmdb_id,
          });
        } else {
          console.warn(
            `[CINEMETA] No metadata payload returned for ${cinemetaUrl}`,
          );
        }
      } catch (error) {
        console.warn(
          `[CINEMETA] Failed to fetch metadata for ${primaryId}: ${error.message}`,
        );
      }
    }

    const collectValues = (...extractors) => {
      const collected = [];
      for (const source of metaSources) {
        if (!source) continue;
        for (const extractor of extractors) {
          try {
            const value = extractor(source);
            if (value !== undefined && value !== null) {
              collected.push(value);
            }
          } catch (error) {
            // ignore extractor errors on unexpected shapes
          }
        }
      }
      return collected;
    };

    let seasonNum = null;
    let episodeNum = null;
    if (type === "series" && id.includes(":")) {
      const [, season, episode] = id.split(":");
      const parsedSeason = Number.parseInt(season, 10);
      const parsedEpisode = Number.parseInt(episode, 10);
      seasonNum = Number.isFinite(parsedSeason) ? parsedSeason : null;
      episodeNum = Number.isFinite(parsedEpisode) ? parsedEpisode : null;
    }

    const normalizeImdb = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      const withPrefix = trimmed.startsWith("tt") ? trimmed : `tt${trimmed}`;
      return /^tt\d+$/.test(withPrefix) ? withPrefix : null;
    };

    const normalizeNumericId = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      if (!/^\d+$/.test(trimmed)) return null;
      return trimmed;
    };

    const metaIds = {
      imdb: normalizeImdb(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.imdb_id,
            (src) => src?.imdb,
            (src) => src?.imdbId,
            (src) => src?.imdbid,
            (src) => src?.ids?.imdb,
            (src) => src?.externals?.imdb,
          ),
          primaryId,
        ),
      ),
      tmdb: normalizeNumericId(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.tmdb_id,
            (src) => src?.tmdb,
            (src) => src?.tmdbId,
            (src) => src?.ids?.tmdb,
            (src) => src?.ids?.themoviedb,
            (src) => src?.externals?.tmdb,
            (src) => src?.tmdbSlug,
            (src) => src?.tmdbid,
          ),
        ),
      ),
      tvdb: normalizeNumericId(
        pickFirstDefined(
          ...collectValues(
            (src) => src?.tvdb_id,
            (src) => src?.tvdb,
            (src) => src?.tvdbId,
            (src) => src?.ids?.tvdb,
            (src) => src?.externals?.tvdb,
            (src) => src?.tvdbSlug,
            (src) => src?.tvdbid,
          ),
        ),
      ),
    };

    console.log("[REQUEST] Normalized identifier set", metaIds);

    const extractYear = (value) => {
      if (value === null || value === undefined) return null;
      const match = String(value).match(/\d{4}/);
      if (!match) return null;
      const parsed = Number.parseInt(match[0], 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const movieTitle = pickFirstDefined(
      ...collectValues(
        (src) => src?.title,
        (src) => src?.name,
        (src) => src?.originalTitle,
        (src) => src?.original_title,
      ),
    );

    const releaseYear = extractYear(
      pickFirstDefined(
        ...collectValues(
          (src) => src?.year,
          (src) => src?.releaseYear,
          (src) => src?.released,
          (src) => src?.releaseInfo?.year,
        ),
      ),
    );

    console.log("[REQUEST] Resolved title/year", { movieTitle, releaseYear });

    let searchType;
    if (type === "series") {
      searchType = "tvsearch";
    } else if (type === "movie") {
      searchType = "movie";
    } else {
      searchType = "search";
    }

    const seasonToken = Number.isFinite(seasonNum)
      ? `{Season:${seasonNum}}`
      : null;
    const episodeToken = Number.isFinite(episodeNum)
      ? `{Episode:${episodeNum}}`
      : null;

    const searchPlans = [];
    const seenPlans = new Set();
    const addPlan = (planType, { tokens = [], rawQuery = null } = {}) => {
      const tokenList = [...tokens];
      if (planType === "tvsearch") {
        if (seasonToken) tokenList.push(seasonToken);
        if (episodeToken) tokenList.push(episodeToken);
      }
      const normalizedTokens = tokenList.filter(Boolean);
      const query = rawQuery ? rawQuery : normalizedTokens.join(" ");
      if (!query) {
        return false;
      }
      const planKey = `${planType}|${query}`;
      if (seenPlans.has(planKey)) {
        return false;
      }
      seenPlans.add(planKey);
      searchPlans.push({
        type: planType,
        query,
        rawQuery: rawQuery ? rawQuery : null,
        tokens: normalizedTokens,
      });
      return true;
    };

    if (metaIds.imdb) {
      addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
    }

    if (type === "series" && metaIds.tvdb) {
      addPlan("tvsearch", { tokens: [`{TvdbId:${metaIds.tvdb}}`] });
    }

    if (type === "movie" && metaIds.tmdb) {
      addPlan("movie", { tokens: [`{TmdbId:${metaIds.tmdb}}`] });
    }

    if (searchPlans.length === 0 && metaIds.imdb) {
      addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
    }

    const textQueryParts = [];
    if (movieTitle) {
      textQueryParts.push(movieTitle);
    }
    if (type === "movie" && Number.isFinite(releaseYear)) {
      textQueryParts.push(String(releaseYear));
    } else if (
      type === "series" && Number.isFinite(seasonNum) &&
      Number.isFinite(episodeNum)
    ) {
      textQueryParts.push(
        `S${String(seasonNum).padStart(2, "0")}E${
          String(episodeNum).padStart(2, "0")
        }`,
      );
    }

    // Only add text-based search if strict ID matching is disabled
    if (!INDEXER_MANAGER_STRICT_ID_MATCH) {
      const textQueryFallback = (textQueryParts.join(" ").trim() || primaryId)
        .trim();
      const addedTextPlan = addPlan("search", { rawQuery: textQueryFallback });
      if (addedTextPlan) {
        console.log(`${INDEXER_LOG_PREFIX} Added text search plan`, {
          query: textQueryFallback,
        });
      } else {
        console.log(`${INDEXER_LOG_PREFIX} Text search plan already present`, {
          query: textQueryFallback,
        });
      }
    } else {
      console.log(
        `${INDEXER_LOG_PREFIX} Strict ID matching enabled; skipping text-based search`,
      );
    }

    if (INDEXER_MANAGER_INDEXERS) {
      console.log(
        `${INDEXER_LOG_PREFIX} Using configured indexers`,
        INDEXER_MANAGER_INDEXERS,
      );
    } else {
      console.log(
        `${INDEXER_LOG_PREFIX} Using manager default indexer selection`,
      );
    }

    const deriveResultKey = (result) => {
      if (!result) return null;
      const indexerId = result.indexerId || result.IndexerId || "unknown";
      const indexer = result.indexer || result.Indexer || "";
      const title = (result.title || result.Title || "").trim();
      const size = result.size || result.Size || 0;

      // Use title + indexer info + size as unique key for better deduplication
      return `${indexerId}|${indexer}|${title}|${size}`;
    };

    const usingStrictIdMatching = INDEXER_MANAGER_STRICT_ID_MATCH;
    const resultsByKey = usingStrictIdMatching ? null : new Map();
    const aggregatedResults = usingStrictIdMatching ? [] : null;
    const planSummaries = [];

    const planExecutions = searchPlans.map((plan) => {
      console.log(`${INDEXER_LOG_PREFIX} Dispatching plan`, plan);
      return executeIndexerPlan(plan)
        .then((data) => ({ plan, status: "fulfilled", data }))
        .catch((error) => ({ plan, status: "rejected", error }));
    });

    const planResultsSettled = await Promise.all(planExecutions);

    for (const result of planResultsSettled) {
      const { plan } = result;
      if (result.status === "rejected") {
        console.error(`${INDEXER_LOG_PREFIX} ❌ Search plan failed`, {
          message: result.error.message,
          type: plan.type,
          query: plan.query,
        });
        planSummaries.push({
          planType: plan.type,
          query: plan.query,
          total: 0,
          filtered: 0,
          uniqueAdded: 0,
          error: result.error.message,
        });
        continue;
      }

      const planResults = Array.isArray(result.data) ? result.data : [];
      console.log(
        `${INDEXER_LOG_PREFIX} ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`,
      );

      const filteredResults = planResults.filter((item) => {
        if (!item || typeof item !== "object") {
          return false;
        }
        if (!item.downloadUrl) {
          return false;
        }
        return true;
      });

      let addedCount = 0;
      if (usingStrictIdMatching) {
        aggregatedResults.push(
          ...filteredResults.map((item) => ({
            result: item,
            planType: plan.type,
          })),
        );
        addedCount = filteredResults.length;
      } else {
        const beforeSize = resultsByKey.size;
        for (const item of filteredResults) {
          const key = deriveResultKey(item);
          if (!key) continue;
          if (!resultsByKey.has(key)) {
            resultsByKey.set(key, { result: item, planType: plan.type });
          }
        }
        addedCount = resultsByKey.size - beforeSize;
      }

      planSummaries.push({
        planType: plan.type,
        query: plan.query,
        total: planResults.length,
        filtered: filteredResults.length,
        uniqueAdded: addedCount,
      });
      console.log(
        `${INDEXER_LOG_PREFIX} ✅ Plan summary`,
        planSummaries[planSummaries.length - 1],
      );
    }

    const aggregationCount = usingStrictIdMatching
      ? aggregatedResults.length
      : resultsByKey.size;
    if (aggregationCount === 0) {
      console.warn(
        `${INDEXER_LOG_PREFIX} ⚠ All ${searchPlans.length} search plans returned no NZB results`,
      );
    } else if (usingStrictIdMatching) {
      console.log(
        `${INDEXER_LOG_PREFIX} ✅ Aggregated NZB results with strict ID matching`,
        {
          plansRun: searchPlans.length,
          totalResults: aggregationCount,
        },
      );
    } else {
      console.log(`${INDEXER_LOG_PREFIX} ✅ Aggregated unique NZB results`, {
        plansRun: searchPlans.length,
        uniqueResults: aggregationCount,
      });
    }

    const dedupedNzbResults = usingStrictIdMatching
      ? aggregatedResults.map((entry) => entry.result)
      : Array.from(resultsByKey.values()).map((entry) => entry.result);

    const finalNzbResults = dedupedNzbResults
      .filter((result, index) => {
        if (!result.downloadUrl || !result.indexerId) {
          console.warn(
            `${INDEXER_LOG_PREFIX} Skipping NZB result ${index} missing required fields`,
            {
              hasDownloadUrl: !!result.downloadUrl,
              hasIndexerId: !!result.indexerId,
              title: result.title,
            },
          );
          return false;
        }
        return true;
      })
      .map((result) => ({ ...result, _sourceType: "nzb" }));

    console.log(
      `${INDEXER_LOG_PREFIX} Final NZB selection: ${finalNzbResults.length} results`,
    );

    const addonBaseUrl = ADDON_BASE_URL.replace(/\/$/, "");

    const streams = finalNzbResults
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .map((result) => {
        const sizeInGB = result.size
          ? (result.size / 1073741824).toFixed(2)
          : null;
        const sizeString = sizeInGB ? `${sizeInGB} GB` : "Size Unknown";

        const qualityMatch = result.title?.match(
          /(2160p|4K|UHD|1080p|720p|480p)/i,
        );
        const quality = qualityMatch ? qualityMatch[0] : "";

        const baseParams = new URLSearchParams({
          indexerId: String(result.indexerId),
          type,
          id,
        });

        baseParams.set("downloadUrl", result.downloadUrl);
        if (result.guid) baseParams.set("guid", result.guid);
        if (result.size) baseParams.set("size", String(result.size));
        if (result.title) baseParams.set("title", result.title);
        if (ADDON_SHARED_SECRET) baseParams.set("token", ADDON_SHARED_SECRET);

        const streamUrl = `${addonBaseUrl}/nzb/stream?${baseParams.toString()}`;
        const name = "UsenetStreamer";
        const behaviorHints = {
          notWebReady: true,
          externalPlayer: {
            isRequired: false,
            name: "NZBDav Instant Stream",
          },
        };

        return {
          title: `${result.title}\n${
            ["📰 NZB", quality, sizeString].filter(Boolean).join(" • ")
          }\n${result.indexer}`,
          name,
          url: streamUrl,
          behaviorHints,
          meta: {
            originalTitle: result.title,
            indexer: result.indexer,
            size: result.size,
            quality,
            age: result.age,
            type: "nzb",
          },
        };
      })
      .filter(Boolean);

    console.log(`[STREMIO] Returning ${streams.length} NZB streams`);

    res.json({ streams });
  } catch (error) {
    console.error("[ERROR] Processing failed:", error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || error.message,
      details: {
        type,
        id,
        indexerManager: INDEXER_MANAGER_LABEL,
        indexerManagerUrl: INDEXER_MANAGER_URL,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

async function handleNzbdavStream(req, res) {
  const { downloadUrl, type = "movie", id = "", title = "NZB Stream" } =
    req.query;

  if (!downloadUrl) {
    res.status(400).json({ error: "downloadUrl query parameter is required" });
    return;
  }

  try {
    const category = getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});
    const cacheKeyParts = [downloadUrl, category];
    if (requestedEpisode) {
      cacheKeyParts.push(
        `${requestedEpisode.season}x${requestedEpisode.episode}`,
      );
    }
    const cacheKey = cacheKeyParts.join("|");

    const streamData = await getOrCreateNzbdavStream(
      cacheKey,
      () =>
        buildNzbdavStream({ downloadUrl, category, title, requestedEpisode }),
    );

    if ((req.method || "GET").toUpperCase() === "HEAD") {
      const inferredMime = inferMimeType(
        streamData.fileName || title || "stream",
      );
      const totalSize = Number.isFinite(streamData.size)
        ? streamData.size
        : undefined;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", inferredMime);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Length,Content-Range,Content-Type",
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${
          (streamData.fileName || "stream").replace(/[\/:*?"<>|]+/g, "_")
        }"`,
      );
      if (Number.isFinite(totalSize)) {
        res.setHeader("Content-Length", String(totalSize));
        res.setHeader("X-Total-Length", String(totalSize));
      }
      res.status(200).end();
      return;
    }

    await proxyNzbdavStream(
      req,
      res,
      streamData.viewPath,
      streamData.fileName || "",
    );
  } catch (error) {
    if (error?.isNzbdavFailure) {
      console.warn(
        "[NZBDAV] Stream failure detected:",
        error.failureMessage || error.message,
      );
      const served = await streamFailureVideo(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.failureMessage || error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    console.error("[NZBDAV] Stream proxy error:", error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: error.message });
    } else {
      res.end();
    }
  }
}

app.get("/nzb/stream", handleNzbdavStream);
app.head("/nzb/stream", handleNzbdavStream);

app.listen(port, "0.0.0.0", () => {
  console.log(`Addon running at http://0.0.0.0:${port}`);
});
