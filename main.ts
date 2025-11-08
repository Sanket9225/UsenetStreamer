import express, { Request, Response } from "express";
import cors from "cors";
import { join } from "@std/path/posix";
import { getMediaAndSearchResults } from "./utils/getMediaAndSearchResults.ts";

import { ADDON_BASE_URL, PORT, } from "./env.ts";
import { md5 } from "./utils/md5Encoder.ts";
import { streamNzbdavProxy } from "./lib/nzbDav/nzbDav.ts";
import { redis } from "./utils/redis.ts";

import { streamFailureVideo } from "./lib/streamFailureVideo.ts"

interface RequestedEpisode {
    season: number;
    episode: number;
}

const app = express();

app.use(cors());

app.get("/assets/icon.png", async (_req: Request, res: Response) => {
    try {
        const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
        const file = await Deno.readFile(iconPath);
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=86400");
        res.send(file);
    } catch (err) {
        console.error("Failed to load icon.png:", err);
        res.status(404).send("Not found");
    }
});

app.get("/", (_req: Request, res: Response) => {
    res.send("Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.");
});

app.get("/stream/:type/:imdbId", async (req: Request, res: Response) => {
    const fullId = req.params.imdbId.replace(".json", "");
    const type = req.params.type as "movie" | "series";

    if (!["movie", "series"].includes(type)) {
        return res.status(400).json({ error: "Invalid type" });
    }

    let imdbIdToUse = fullId;
    let requestedEpisode: RequestedEpisode | undefined = undefined;

    if (type === "series" && fullId.includes(":")) {
        const [imdb, s, e] = fullId.split(":");
        const season = parseInt(s, 10);
        const episode = parseInt(e, 10);
        if (!isNaN(season) && !isNaN(episode)) {
            imdbIdToUse = imdb;
            requestedEpisode = { season, episode };
        }
    }
    console.log(`imdbIdToUse: ${imdbIdToUse}, requestedEpisode: ${JSON.stringify(requestedEpisode)}`);

    try {
        const { results } = await getMediaAndSearchResults(type, imdbIdToUse, requestedEpisode);

        // Step 1: Check existing keys
        const getPipeline = redis.pipeline();
        results.forEach(r => {
            const hash = md5(r.downloadUrl);
            const streamKey = `streams:${hash}`;
            getPipeline.call("JSON.GET", streamKey, "$");
        });
        const execResult = await getPipeline.exec() as any[] | null;
        const existingResults = execResult ?? [];

        // Step 2: Prepare SET pipeline for new keys
        const setPipeline = redis.pipeline();
        const streams = results.map((r, idx) => {
            const hash = md5(r.downloadUrl);
            const streamKey = `streams:${hash}`;
            const existingTuple = existingResults[idx];
            const existingRaw = existingTuple && !existingTuple[0] ? existingTuple[1] : null;

            let name = 'NEW';

            if (existingRaw) {
                try {
                    const data = JSON.parse(existingRaw)[0];
                    if (data?.nzoId) name = 'CACHED';
                } catch {
                    // JSON parse failed, treat as NEW
                }
            } else {
                const streamData = {
                    downloadUrl: r.downloadUrl,
                    title: r.title,
                    size: r.size,
                    fileName: r.fileName,
                };
                setPipeline.call("JSON.SET", streamKey, "$", JSON.stringify(streamData), "NX");
                setPipeline.expire(streamKey, 60 * 60 * 48);
            }

            return {
                name,
                title: r.title,
                url: `${ADDON_BASE_URL}/nzb/stream?key=${hash}`,
                size: r.size,
            };
        });

        await setPipeline.exec();
        res.json({ streams });

    } catch (err) {
        console.error("Stream list error:", err);
        res.status(502).json({ error: "Failed to load streams" });
    }

});

app.get("/nzb/stream", async (req: Request, res: Response) => {
    const key = req.query.key as string;
    if (!key) {
        const served = await streamFailureVideo(req, res);
        if (!served && !res.headersSent) res.status(502).json({ error: "Missing key" });
        return;
    }
    console.log(`GET Request made for ${key}`);
    try {
        await streamNzbdavProxy(key, req, res);
    } catch (err) {
        console.error("NZBDAV proxy error:", err);
        const served = await streamFailureVideo(req, res);
        if (!served && !res.headersSent) res.status(502).json({ error: "UPSTREAM ERROR" });
        return;
    }
});

app.head("/nzb/stream", async (req: Request, res: Response) => {
    const key = req.query.key as string;
    if (!key) {
        res.status(400).json({ error: "Missing file key" });
        return;
    }
    console.log(`HEAD Request made for ${key}`);
    try {
        await streamNzbdavProxy(key, req, res);
    } catch (err) {
        console.error("NZBDAV proxy error:", err);
        res.status(502).json({ error: "Failed to stream file" });
    }
});

app.get("/manifest.json", (_req: Request, res: Response) => {
    res.json({
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
    });
});

// Start the server
app.listen(Number(PORT), () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
