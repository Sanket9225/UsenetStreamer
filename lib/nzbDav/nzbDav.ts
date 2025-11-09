// deno-lint-ignore-file no-explicit-any
import { getJsonValue, redis, setJsonValue } from "../../utils/redis.ts";
import { LRUCache as LRU } from 'lru-cache';
import { findBestVideoFile } from "../../utils/findBestVideoFile.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";
import { parseRequestedEpisode } from "../../utils/parseRequestedEpisode.ts";
import type { EpisodeInfo } from "../../utils/parseRequestedEpisode.ts";
import { proxyNzbdavStream } from "./proxyNzbdav.ts";
import { buildNzbdavApiParams, getNzbdavCategory, sleep } from "./nzbUtils.ts";

import {
    NZBDAV_POLL_TIMEOUT_MS, NZBDAV_HISTORY_TIMEOUT_MS, NZBDAV_URL, NZBDAV_API_KEY, NZBDAV_API_TIMEOUT_MS, NZBDAV_POLL_INTERVAL_MS,
    NZBDAV_CACHE_TTL_MS, STREAM_METADATA_CACHE_TTL_MS, NZBDAV_CACHE_MAX_ITEMS, STREAM_METADATA_CACHE_MAX_ITEMS
} from "../../env.ts";
import { md5 } from "../../utils/md5Encoder.ts";

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

// LRU cache for NZBDAV streams
const nzbdavStreamCache = new LRU<string, any>({
    max: NZBDAV_CACHE_MAX_ITEMS,
    ttl: NZBDAV_CACHE_TTL_MS,
});

// LRU cache for stream metadata
const streamMetadataCache = new LRU<string, { data: StreamCache }>({
    max: STREAM_METADATA_CACHE_MAX_ITEMS,
    ttl: STREAM_METADATA_CACHE_TTL_MS,
});

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

async function getOrCreateNzbdavStream(cacheKey: string, builder: () => Promise<any>) {
    const existing = nzbdavStreamCache.get(cacheKey);

    if (existing) {
        switch (existing.status) {
            case "ready":
                return existing.data;
            case "pending":
                return existing.promise;
            case "failed":
                throw existing.error;
        }
    }

    const promise = (async () => {
        const data = await builder();
        nzbdavStreamCache.set(cacheKey, {
            status: "ready",
            data,
        });
        return data;
    })();

    nzbdavStreamCache.set(cacheKey, { status: "pending", promise });

    try {
        return await promise;
    } catch (error: any) {
        if (error?.isNzbdavFailure) {
            nzbdavStreamCache.set(cacheKey, {
                status: "failed",
                error,
            });
        } else {
            nzbdavStreamCache.delete(cacheKey);
        }
        throw error;
    }
}

export async function streamNzbdavProxy(
    keyHash: string,
    req: Request,
): Promise<Response> {
    const redisKey = `streams:${keyHash}`;

    let meta = streamMetadataCache.get(redisKey)?.data || null;

    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (meta) {
            streamMetadataCache.set(redisKey, { data: meta });
        }
    }

    if (!meta) {
        const failureResponse = await streamFailureVideo(req);
        if (failureResponse) return failureResponse;

        return new Response(JSON.stringify({ error: "This shit is broke as fuuuuck" }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
        });
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId } = meta;
    const id = (meta as any).rawImdbId ?? "";
    console.log("THIS IS ID: ", id);

    const category = getNzbdavCategory(type);
    const episode = parseRequestedEpisode(type, id);

    const cacheKey = [
        downloadUrl,
        category,
        episode ? `${episode.season}x${episode.episode}` : undefined,
    ].join("|");

    try {
        const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
            buildNzbdavStream({ downloadUrl, category, title, requestedEpisode: episode })
        );

        return await proxyNzbdavStream(req, streamData.viewPath, streamData.fileName ?? "");

    } catch (err: any) {
        const msg = err.message ?? String(err);
        const isNzbdavFail = !!err.isNzbdavFailure;

        // 6. Handle NZBDav failures
        if (isNzbdavFail) {
            console.warn("[NZBDAV] Failed → cleaning up", err.failureMessage || msg);

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

            const failureResponse = await streamFailureVideo(req, err);
            if (failureResponse) return failureResponse;

            return new Response(JSON.stringify({ error: err.failureMessage || msg }), {
                status: 502,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 7. Handle other errors
        console.error("[NZBDAV] Proxy error:", msg);
        const status = err.response?.status || 502;
        return new Response(JSON.stringify({ error: msg }), {
            status: status,
            headers: { "Content-Type": "application/json" }
        });
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
    const cached = cachedArray ?? null;

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
        downloadUrl: downloadUrl,
        title: title,
        rawImdbId: cached?.rawImdbId,
    };

    await setJsonValue(cacheKey, '$', result);
    console.log(`[NZBDAV] Stream ready: ${result.viewPath}`);

    return result;
}


