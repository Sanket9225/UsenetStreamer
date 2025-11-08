/*
Credit goes to panteLx for their work decoding and implementing proper header handling.
https://github.com/panteLx/UsenetStreamer
*/

import { VIDEO_MIME_MAP, NZBDAV_URL, NZBDAV_WEBDAV_USER, NZBDAV_WEBDAV_PASS, } from "../../env.ts";
import { extname } from "@std/path/posix";
import { Request, Response } from "express";

function inferMimeType(fileName: string) {
    if (!fileName) return "application/octet-stream";
    const ext = extname(fileName.toLowerCase());
    return VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

function sanitizeFileName(fileName: string) {
    return fileName.replace(/[\\/:*?"<>|]+/g, "_") || "stream";
}

export async function proxyNzbdavStream(
    req: Request,
    res: Response,
    viewPath: string,
    fileNameHint = ""
) {
    const NZBDAV_SUPPORTED_METHODS = new Set(["GET", "HEAD"]);
    const method = (req.method || "GET").toUpperCase();

    if (!NZBDAV_SUPPORTED_METHODS.has(method)) {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const emulateHead = method === "HEAD";
    const proxiedMethod = emulateHead ? "GET" : method;

    // Normalize and encode path
    const normalizedPath = viewPath.replace(/^\/+/, "");
    const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
    const webdavBase = NZBDAV_URL.replace(/\/+$/, "");
    const targetUrl = `${webdavBase}/${encodedPath}`;

    // File name
    let derivedFileName = fileNameHint.trim() || normalizedPath.split("/").pop() || "stream";
    derivedFileName = sanitizeFileName(decodeURIComponent(derivedFileName));

    // Upstream headers
    const headers: Record<string, string> = {};
    const range = req.headers.range || req.headers["Range"];
    const ifRange = req.headers["if-range"] || req.headers["If-Range"];
    const acceptEncoding = req.headers["accept-encoding"] || req.headers["Accept-Encoding"];
    if (range) headers.Range = range;
    if (ifRange) headers["If-Range"] = ifRange;
    headers["Accept-Encoding"] = acceptEncoding || "identity";

    if (emulateHead && !headers.Range) {
        headers.Range = "bytes=0-0";
    }

    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
        const token = btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`);
        headers.Authorization = `Basic ${token}`;
    }

    console.log(`[NZBDAV] Proxying ${proxiedMethod} ${targetUrl}`);

    const ac = new AbortController();
    const signal = ac.signal;

    let clientAborted = false;
    res.on("close", () => {
        if (!clientAborted) {
            clientAborted = true;
            console.warn("[NZBDAV] Stream aborted by client");
            ac.abort();
        }
    });

    let upstream: Response;
    try {
        upstream = await fetch(targetUrl, { method: proxiedMethod, headers, signal });
    } catch (err) {
        console.error("[NZBDAV] Fetch failed:", err);
        res.sendStatus(502);
        return;
    }

    if (!upstream.ok || !upstream.body) {
        res.sendStatus(upstream.status);
        return;
    }

    const headerBlocklist = new Set([
        "transfer-encoding",
        "www-authenticate",
        "set-cookie",
        "cookie",
        "authorization",
    ]);

    upstream.headers.forEach((value: string, key: string) => {
        if (!headerBlocklist.has(key.toLowerCase())) {
            res.setHeader(key, value);
        }
    });

    if (!upstream.headers.get("content-disposition")) {
        res.setHeader("Content-Disposition", `inline; filename="${derivedFileName}"`);
    }
    if (!res.getHeader("Content-Type") || res.getHeader("Content-Type") === "application/octet-stream") {
        res.setHeader("Content-Type", inferMimeType(derivedFileName));
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Range,Content-Type");

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) {
        // Example: Content-Range: bytes 100-999/2000
        const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            res.setHeader("Content-Length", String(end - start + 1));
        }
    }

    res.status(upstream.status === 206 ? 206 : 200);

    if (emulateHead) {
        res.end();
        return;
    }

    const writable = new WritableStream<Uint8Array>({
        write(chunk) {
            return new Promise<void>((resolve, reject) => {
                if (!res.writableEnded) {
                    res.write(chunk, (err: Error) => (err ? reject(err) : resolve()));
                } else {
                    reject(new Error("Client disconnected"));
                }
            });
        },
        close() {
            res.end();
        },
        abort(err) {
            // Already logged above, so avoid duplicate
            if (!clientAborted) console.warn("[NZBDAV] Stream aborted:", err);
            res.end();
        },
    });

    try {
        await upstream.body!.pipeTo(writable);
    } catch (err: unknown) {
        if (err.name !== "AbortError") {
            console.error("[NZBDAV] Streaming error:", err);
        }
    }
}