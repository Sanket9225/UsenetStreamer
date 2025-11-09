export const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
export const ADDON_BASE_URL = Deno.env.get("ADDON_BASE_URL") || '';
if (!ADDON_BASE_URL) throw new Error("Need ADDON_BASE_URL");
export const PORT = Number(Deno.env.get("PORT") || "7000");

export const PROWLARR_URL = String(Deno.env.get("PROWLARR_URL"));
export const PROWLARR_API_KEY = String(Deno.env.get("PROWLARR_API_KEY"));
if (!PROWLARR_API_KEY || !PROWLARR_URL) throw new Error("PROWLARR VARIABLES REQUIRED.");

export const REDIS_URL = String(Deno.env.get("REDIS_URL"));
if (!REDIS_URL) throw new Error("REDIS_URL is required!");

export const NZBDAV_URL = (Deno.env.get("NZBDAV_URL") || "").trim();
export const NZBDAV_API_KEY = (Deno.env.get("NZBDAV_API_KEY") || "").trim();
export const NZBDAV_CATEGORY_MOVIES = Deno.env.get("NZBDAV_CATEGORY_MOVIES") || "Movies";
export const NZBDAV_CATEGORY_SERIES = Deno.env.get("NZBDAV_CATEGORY_SERIES") || "Tv";
export const NZBDAV_CATEGORY_DEFAULT = Deno.env.get("NZBDAV_CATEGORY_DEFAULT") || "Movies";
export const NZBDAV_POLL_INTERVAL_MS = 2000;
export const NZBDAV_POLL_TIMEOUT_MS = 80000;
export const NZBDAV_CACHE_TTL_MS = 3600000;
export const NZBDAV_MAX_DIRECTORY_DEPTH = 6;
export const NZBDAV_WEBDAV_USER = (Deno.env.get("NZBDAV_WEBDAV_USER") || "").trim();
export const NZBDAV_WEBDAV_PASS = (Deno.env.get("NZBDAV_WEBDAV_PASS") || "").trim();
export const NZBDAV_WEBDAV_ROOT = "/";
export const NZBDAV_WEBDAV_URL = (Deno.env.get("NZBDAV_WEBDAV_URL") || NZBDAV_URL).trim();
export const NZBDAV_API_TIMEOUT_MS = 80000;
export const NZBDAV_HISTORY_TIMEOUT_MS = 60000;
export const FAILURE_VIDEO_FILENAME = "failure_video.mp4";

export const NZBDAV_VIDEO_EXTENSIONS = new Set([
    '.mp4',
    '.mkv',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.m4v',
    '.ts',
    '.m2ts',
    '.mpg',
    '.mpeg'
]);

export const VIDEO_MIME_MAP = new Map([
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

export const STREAM_METADATA_CACHE_TTL_MS = 60000; // 1 minute

export const NZBDAV_CACHE_MAX_ITEMS = 100;
export const STREAM_METADATA_CACHE_MAX_ITEMS = 500;
