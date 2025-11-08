// deno-lint-ignore-file no-explicit-any
import { getJsonValue, redis, setJsonValue } from "../utils/redis.ts";
import { getWebdavClient } from "../utils/webdav.ts";
import type { Request, Response } from "express";
import { findBestVideoFile } from "../utils/findBestVideoFile.ts";
import { streamFailureVideo } from "./streamFailureVideo.ts";
import { parseRequestedEpisode } from "../utils/parseRequestedEpisode.ts";
import type { EpisodeInfo, QueryParams } from "../utils/parseRequestedEpisode.ts";

import { STREAM_HIGH_WATER_MARK, NZBDAV_POLL_TIMEOUT_MS, NZBDAV_HISTORY_TIMEOUT_MS, NZBDAV_CATEGORY_SERIES, NZBDAV_CATEGORY_MOVIES, NZBDAV_CATEGORY_DEFAULT, NZBDAV_URL, NZBDAV_API_KEY, NZBDAV_API_TIMEOUT_MS, NZBDAV_POLL_INTERVAL_MS } from "../env.ts";
import { md5 } from "../utils/md5Encoder.ts";

interface StreamCache {
    downloadUrl: string;
    size: number;
    title: string;
    fileName: string;
    prowlarrId: string;
    // infoUrl: string;
    // indexer: string;
    // posterUrl: string;
    // publishDate: string;
    nzbId?: string;
    type: "series" | "movie";
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getNzbdavCategory(type: string): string {
    if (type === 'series' || type === 'tv') {
        return NZBDAV_CATEGORY_SERIES;
    }
    if (type === 'movie') {
        return NZBDAV_CATEGORY_MOVIES;
    }
    return NZBDAV_CATEGORY_DEFAULT;
}

function buildNzbdavApiParams(mode: string, extra: Record<string, any> = {}) {
    return {
        mode,
        // apikey: NZBDAV_API_KEY, // why send more data then we need?
        ...extra,
        output: "json",
    };
}

async function addNzbToNzbdav(nzbUrl: string, category: string, jobLabel: string): Promise<{ nzoId: string }> {

    if (!nzbUrl) {
        throw new Error("Missing NZB download URL");
    }
    if (!category) {
        throw new Error("Missing NZBDav category");
    }

    const jobName = jobLabel || "untitled";
    console.log(
        `[NZBDAV] Queueing NZB for category=${category} (${jobName})`
    );

    const params = buildNzbdavApiParams("addurl", {
        name: nzbUrl,
        cat: category,
        nzbname: jobName,
    });

    const url = new URL(`${NZBDAV_URL}/api`);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    });

    const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(NZBDAV_API_TIMEOUT_MS),
        headers: { "x-api-key": NZBDAV_API_KEY },
    });

    if (response.status >= 500) {
        throw new Error(`[NZBDAV] Server error (${response.status}) when calling addurl`);
    }

    const json = await response.json();

    if (!json?.status) {
        const errorMessage =
            json?.error || `addurl returned status ${response.status} (no status property)`;
        throw new Error(`[NZBDAV] Failed to queue NZB: ${errorMessage}`);
    }

    const nzoId =
        json?.nzo_id ||
        json?.nzoId ||
        json?.NzoId ||
        (Array.isArray(json?.nzo_ids) && json.nzo_ids[0]) ||
        (Array.isArray(json?.queue) && json.queue[0]?.nzo_id);

    if (!nzoId) {
        console.log(`[NZBDAV] Raw Response on failure to get nzoId:`, json);
        throw new Error("[NZBDAV] addurl succeeded but no nzo_id returned");
    }

    console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
    return { nzoId };
}

async function waitForNzbdavHistorySlot(nzoId: string, category: string): Promise<any> {
    const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const params = buildNzbdavApiParams("history", {
            start: "0",
            limit: "50",
            category: category,
        });

        const url = new URL(`${NZBDAV_URL}/api`);

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        });

        const response = await fetch(url.toString(), {
            headers: { "x-api-key": NZBDAV_API_KEY },
            signal: AbortSignal.timeout(NZBDAV_HISTORY_TIMEOUT_MS || NZBDAV_POLL_INTERVAL_MS),
        });

        if (response.status >= 500) {
            throw new Error(`[NZBDAV] Server error (${response.status}) when querying history`);
        }

        const json = await response.json();

        if (!json?.status) {
            const errorMessage =
                json?.error || `history returned status ${response.status} (no status property)`;
            throw new Error(`[NZBDAV] Failed to query history: ${errorMessage}`);
        }

        const history = json?.history || json?.History;
        const slots: any[] = history?.slots || history?.Slots || [];

        const slot = slots.find((entry) => {
            const entryId = entry?.nzo_id || entry?.nzoId || entry?.NzoId;
            return entryId === nzoId;
        });

        if (slot) {
            const status = (slot.status || slot.Status || "")
                .toString()
                .toLowerCase();

            if (status === "completed" || status === "success") {
                console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
                return slot;
            }

            if (status === "failed" || status === "error") {
                const failMessage =
                    slot.fail_message ||
                    slot.failMessage ||
                    slot.FailMessage ||
                    "Unknown NZBDav error";

                const failureError: any = new Error(`[NZBDAV] NZB failed: ${failMessage}`);
                failureError.isNzbdavFailure = true;
                failureError.failureMessage = failMessage;
                failureError.nzoId = nzoId;
                failureError.category = category;
                throw failureError;
            }
        }

        slot ? console.log(`[NZBDAV:history] NZB ${nzoId}. Polling...`) : console.warn(`[NZBDAV:history] Job ${nzoId} not yet confirmed in history, continuing poll.`);

        await sleep(NZBDAV_POLL_INTERVAL_MS);
    }

    throw new Error(
        `[NZBDAV] Timeout while waiting for NZB ${nzoId} to become streamable`
    );
}

const nzbdavStreamCache = new Map();
const NZBDAV_CACHE_TTL_MS = 3600000; // Existing cache for NZBDav stream data

const streamMetadataCache = new Map<string, { data: StreamCache; expiresAt: number | null }>();
const STREAM_METADATA_CACHE_TTL_MS = 60000; // Cache for 1 minute, adjust as needed

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

function cleanupStreamMetadataCache() {
    if (STREAM_METADATA_CACHE_TTL_MS <= 0) {
        return;
    }

    const now = Date.now();
    for (const [key, entry] of streamMetadataCache.entries()) {
        if (entry.expiresAt && entry.expiresAt <= now) {
            streamMetadataCache.delete(key);
        }
    }
}

async function getOrCreateNzbdavStream(cacheKey: string, builder: () => Promise<any>) {
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
            expiresAt: NZBDAV_CACHE_TTL_MS > 0 ? Date.now() + NZBDAV_CACHE_TTL_MS : null,
        });
        return data;
    })();

    nzbdavStreamCache.set(cacheKey, { status: "pending", promise });

    try {
        return await promise;
    } catch (error) {
        if ((error as any)?.isNzbdavFailure) {
            nzbdavStreamCache.set(cacheKey, {
                status: "failed",
                error,
                expiresAt: NZBDAV_CACHE_TTL_MS > 0 ? Date.now() + NZBDAV_CACHE_TTL_MS : null,
            });
        } else {
            nzbdavStreamCache.delete(cacheKey);
        }
        throw error;
    }
}

async function buildNzbdavStream({
    downloadUrl,
    category,
    title,
    requestedEpisode,
}: {
    downloadUrl: string;
    category: string;
    title: string;
    requestedEpisode: EpisodeInfo | undefined;
}) {
    const cacheKey = `streams:${md5(downloadUrl)}`;
    const cachedArray = await getJsonValue<any>(cacheKey, '$');
    const cached = cachedArray?.[0] ?? null;

    if (cached?.viewPath) {
        console.log(`[NZBDAV] Instant cache hit: ${cached.viewPath}`);
        return cached;
    }

    // Only do full work if cache miss
    const { nzoId } = await addNzbToNzbdav(downloadUrl, category, title);
    const slot = await waitForNzbdavHistorySlot(nzoId, category);

    const slotCategory = slot?.category || slot?.Category || category;
    const slotJobName = slot?.job_name || slot?.JobName || slot?.name || slot?.Name;
    if (!slotJobName) throw new Error("[NZBDAV] No job name");

    const bestFile = await findBestVideoFile({
        category: slotCategory,
        jobName: slotJobName,
        requestedEpisode,
    });
    if (!bestFile) throw new Error("[NZBDAV] No video file");

    const result = {
        nzoId,
        category: slotCategory,
        jobName: slotJobName,
        viewPath: bestFile.viewPath,
        size: bestFile.size,
        fileName: bestFile.name,
    };

    await setJsonValue(cacheKey, '$', result);
    console.log(`[NZBDAV] Stream ready: ${result.viewPath}`);

    return result;
}

export async function streamNzbdavProxy(
    keyHash: string,
    req: Request,
    res: Response,
) {
    const redisKey = `streams:${keyHash}`;
    cleanupStreamMetadataCache();

    let meta = streamMetadataCache.get(redisKey)?.data || null;

    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (meta) {
            streamMetadataCache.set(redisKey, {
                data: meta,
                expiresAt: STREAM_METADATA_CACHE_TTL_MS > 0
                    ? Date.now() + STREAM_METADATA_CACHE_TTL_MS
                    : null,
            });
        }
    }

    if (!meta) {
        //@TODO: An "old link" video would be cool here
        const served = await streamFailureVideo(req, res);
        if (!served && !res.headersSent) res.status(502).json({ error: "This shit is broke as fuuuuck" });
        return;
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId } = meta;
    const id = (meta as any).id ?? "";

    const category = getNzbdavCategory(type);
    const episode = parseRequestedEpisode(type, id, req.query as QueryParams);

    const cacheKey = [
        downloadUrl,
        category,
        episode ? `${episode.season}x${episode.episode}` : undefined,
    ].join("|");

    try {
        const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
            buildNzbdavStream({ downloadUrl, category, title, requestedEpisode: episode })
        );

        await proxyNzbdavStream(req, res, streamData.viewPath, streamData.fileName ?? "");
    } catch (err: any) {
        const msg = err.message ?? String(err);
        const isNzbdavFail = !!err.isNzbdavFailure;

        if (isNzbdavFail) {
            console.warn("[NZBDAV] Failed → cleaning up", err.failureMessage || msg);

            // Clean everything in one go
            await redis.del(redisKey);

            if (prowlarrId && downloadUrl) {
                const searchKey = `prowlarr:search:${prowlarrId}`;
                const script = `
          local key = KEYS[1]
          local url = ARGV[1]
          local arr = redis.call('JSON.GET', key, '$[0]') or '[]'
          arr = cjson.decode(arr)
          local idx = -1
          for i = 1, #arr do
            if arr[i].downloadUrl == url then idx = i-1 break end
          end
          if idx >= 0 then
            redis.call('JSON.ARRPOP', key, '$', idx)
            local len = redis.call('JSON.ARRLEN', key, '$[0]') or 0
            if len == 0 then redis.call('DEL', key) end
            return 1
          end
          return 0
        `;

                await redis.eval(script, 1, searchKey, downloadUrl);
            }

            const served = await streamFailureVideo(req, res, err);
            if (!served && !res.headersSent) res.status(502).json({ error: err.failureMessage || msg });
            return;
        }

        // Generic error
        console.error("[NZBDAV] Proxy error:", msg);
        if (!res.headersSent) res.status(err.response?.status || 502).json({ error: msg });
    }
}

export async function proxyNzbdavStream(
    req: Request,
    res: Response,
    viewPath: string,
    fileNameHint = "",
) {
    if (!new Set(["GET", "HEAD"]).has(req.method)) return res.status(405).end();

    const client = getWebdavClient();
    const path = viewPath.replace(/^\/+/, "");

    const filename = (fileNameHint || path.split("/").pop() || "stream")
        .replace(/[\\/:*?"<>|]/g, "_");

    let stat;
    try {
        stat = await client.stat(path);
    } catch {
        const served = await streamFailureVideo(req, res);
        if (!served && !res.headersSent) res.status(502).json({ error: "UPSTREAM HERE" });
        return;
    }

    const size = stat.size;
    res.set("Accept-Ranges", "bytes");
    res.set("Content-Disposition", `inline; filename="${filename}"`);
    res.set("Content-Type", stat.mime || "video/mp4");

    if (req.method === "HEAD") return res.set("Content-Length", size).status(200).end();

    let start = 0;
    let end = size - 1;
    if (req.headers.range) {
        const parts = req.headers.range.replace(/bytes=/, "").split("-");
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : size - 1;
    }

    const stream = client.createReadStream(path, {
        headers: { range: `bytes=${start}-${end}` },
        highWaterMark: STREAM_HIGH_WATER_MARK,
    });

    res.status(start === 0 ? 200 : 206);
    if (start > 0) res.set("Content-Range", `bytes ${start}-${end}/${size}`);
    res.set("Content-Length", (end - start + 1).toString());

    stream.pipe(res);

    req.on("close", () => stream.destroy());
}