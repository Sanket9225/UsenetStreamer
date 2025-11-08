/*
Credit goes to panteLx for their work decoding and implementing proper header handling.
https://github.com/panteLx/UsenetStreamer

Tried my best not to use node stream... it's just not stable enough for long streams.
*/

import { Readable } from "node:stream";
import { extname } from "@std/path/posix";
import { Request, Response } from "express";
import {
    VIDEO_MIME_MAP,
    NZBDAV_URL,
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
} from "../../env.ts";

function inferMimeType(fileName: string) {
    const ext = extname(fileName.toLowerCase());
    return VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

function sanitizeFileName(file: string) {
    return file.replace(/[\\/:*?"<>|]+/g, "_") || "stream";
}

// ─── Disable all timeouts to avoid 1hr stream death ───
const zeroTimeout = (obj: Request | Response) => {
    if (!obj) return;
    if (typeof obj.setTimeout === "function") try { obj.setTimeout(0); } catch { }
    if (obj.socket && typeof obj.socket.setTimeout === "function") try { obj.socket.setTimeout(0); } catch { }
};

export async function proxyNzbdavStream(
    req: Request,
    res: Response,
    viewPath: string,
    fileNameHint = ""
) {

    zeroTimeout(res);
    zeroTimeout(req);

    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", "timeout=0");

    const method = req.method.toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
        res.status(405).end("Method Not Allowed");
        return;
    }

    const emulateHead = method === "HEAD";
    const upstreamMethod = emulateHead ? "GET" : method;

    const cleanPath = viewPath.replace(/^\/+/, "");
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    const base = NZBDAV_URL.replace(/\/+$/, "");
    const targetUrl = `${base}/${encodedPath}`;

    let fileName = fileNameHint || cleanPath.split("/").pop() || "stream";
    fileName = sanitizeFileName(decodeURIComponent(fileName));

    const headers: Record<string, string> = {
        "Connection": "keep-alive",
        "Accept-Encoding": req.headers["accept-encoding"] || "identity",
    };

    if (req.headers.range) headers["Range"] = req.headers.range;
    if (req.headers["if-range"]) headers["If-Range"] = req.headers["if-range"];

    if (emulateHead && !headers.Range) {
        headers.Range = "bytes=0-0";
    }

    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS) {
        const token = btoa(
            `${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`,
        );
        headers.Authorization = `Basic ${token}`;
    }

    const ac = new AbortController();
    res.on("close", () => ac.abort());

    const upstream = await fetch(targetUrl, {
        method: upstreamMethod,
        headers,
        signal: ac.signal,
    }).catch(() => null);

    if (!upstream || !upstream.ok || !upstream.body) {
        res.sendStatus(upstream?.status || 502);
        return;
    }

    const block = new Set(["transfer-encoding", "set-cookie", "authorization"]);
    upstream.headers.forEach((value, key) => {
        if (!block.has(key.toLowerCase())) res.setHeader(key, value);
    });

    if (!res.getHeader("Content-Disposition")) {
        res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    }

    if (!res.getHeader("Content-Type") || res.getHeader("Content-Type") === "application/octet-stream") {
        res.setHeader("Content-Type", inferMimeType(fileName));
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Length,Content-Range,Content-Type",
    );

    const rangeHeader = upstream.headers.get("content-range");
    const match = rangeHeader?.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    if (match && match[3] !== "*") {
        const len = Number(match[2]) - Number(match[1]) + 1;
        res.setHeader("Content-Length", String(len));
    }

    res.status(upstream.status === 206 ? 206 : 200);

    if (emulateHead) {
        upstream.body.cancel();
        res.end();
        return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
}
