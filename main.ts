import { join } from "@std/path/posix";
import { getMediaAndSearchResults } from "./utils/getMediaAndSearchResults.ts";

import { ADDON_BASE_URL, PORT, } from "./env.ts";
import { md5 } from "./utils/md5Encoder.ts";
import { streamNzbdavProxy } from "./lib/nzbDav/nzbDav.ts";
import { parseRequestedEpisode, type EpisodeInfo } from "./utils/parseRequestedEpisode.ts";
import { redis } from "./utils/redis.ts";

import { streamFailureVideo } from "./lib/streamFailureVideo.ts";
import { jsonResponse, textResponse } from "./utils/responseUtils.ts";

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    if (method === "OPTIONS") {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
            "Access-Control-Max-Age": "86400",
        };
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/assets/icon.png" && method === "GET") {
        try {
            const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
            const file = await Deno.readFile(iconPath);
            return new Response(file, {
                headers: {
                    "Content-Type": "image/png",
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*", // Manual CORS
                },
            });
        } catch (err) {
            console.error("Failed to load icon.png:", err);
            return textResponse("Not found", 404);
        }
    }

    if (pathname === "/" && method === "GET") {
        return textResponse("Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.");
    }

    if (pathname === "/manifest.json" && method === "GET") {
        const manifest = {
            id: "com.usenet.streamer",
            version: "1.0.1",
            name: "UsenetStreamer",
            description:
                "Usenet-powered instant streams for Stremio via Prowlarr and NZBDav",
            logo: `${ADDON_BASE_URL.replace(/\/$/, "")}/assets/icon.png`,
            resources: ["stream"],
            types: ["movie", "series"],
            catalogs: [],
            idPrefixes: ["tt"],
        };
        return jsonResponse(manifest);
    }

    // /stream/:type/:imdbId
    const streamMatch = pathname.match(/^\/stream\/(movie|series)\/(.+)$/);
    if (streamMatch && method === "GET") {
        const type = streamMatch[1] as "movie" | "series";
        const imdbIdParam = streamMatch[2];
        const decodedIdParam = decodeURIComponent(imdbIdParam);

        const fullId = decodedIdParam.replace(".json", "");

        const requestedInfo = type === 'series' ? parseRequestedEpisode(type, fullId) ?? ({} as Partial<EpisodeInfo>) : { imdbid: fullId };

        console.log(`requestedInfo: ${JSON.stringify(requestedInfo)}`);

        try {
            const { results } = await getMediaAndSearchResults(type, requestedInfo);

            const getPipeline = redis.pipeline();
            results.forEach(r => {
                const hash = md5(r.downloadUrl);
                const streamKey = `streams:${hash}`;
                getPipeline.call("JSON.GET", streamKey, "$");
            });
            const execResult = await getPipeline.exec() as any[] | null;
            const existingResults = execResult ?? [];

            const setPipeline = redis.pipeline();
            const streams = results.map((r, idx) => {
                const hash = md5(r.downloadUrl);
                const streamKey = `streams:${hash}`;
                const existingTuple = existingResults[idx];
                const existingRaw = existingTuple && !existingTuple[0] ? existingTuple[1] : null;

                let name = '';

                if (existingRaw) {
                    try {
                        const data = JSON.parse(existingRaw)[0];
                        if (data?.nzoId) name = '⚡';
                    } catch {
                        // JSON parse failed, treat as NEW
                    }
                } else {
                    const streamData = {
                        downloadUrl: r.downloadUrl,
                        title: r.title,
                        size: r.size,
                        fileName: r.fileName,
                        rawImdbId: fullId,
                    };

                    setPipeline.call("JSON.SET", streamKey, "$", JSON.stringify(streamData), "NX");
                    setPipeline.expire(streamKey, 60 * 60 * 48);
                }

                return {
                    name,
                    title: r.title,
                    url: `${ADDON_BASE_URL}/nzb/stream/${hash}`,
                    size: r.size,
                };
            });

            await setPipeline.exec();
            return jsonResponse({ streams });

        } catch (err) {
            console.error("Stream list error:", err);
            return jsonResponse({ error: "Failed to load streams" }, 502);
        }
    }

    if ((method === "GET" || method === "HEAD") && pathname.startsWith("/nzb/stream/")) {
        const match = pathname.match(/^\/nzb\/stream\/([^/]+)$/);
        const key = match?.[1];

        if (!key) {
            const failureResponse = await streamFailureVideo(req);
            if (failureResponse) return failureResponse;
            return jsonResponse({ error: "Missing key" }, 502);
        }

        console.log(`${method} Request made for ${key}`);
        try {
            return await streamNzbdavProxy(key, req);
        } catch (err) {
            console.error("NZBDAV proxy error:", err);

            const failureResponse = await streamFailureVideo(req);
            if (failureResponse) return failureResponse;

            if (method === "GET") {
                return jsonResponse({ error: "UPSTREAM ERROR" }, 502);
            } else { // HEAD
                return jsonResponse({ error: "Failed to stream file" }, 502);
            }
        }
    }

    // 404
    return textResponse("Not Found", 404);
}

Deno.serve({ port: Number(PORT) }, handler);