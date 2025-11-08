import { Request, Response } from "express";

export async function streamFileResponse(
    req: Request,
    res: Response,
    path: string,
    head = false,
    log = "STREAM",
    preStat?: Deno.FileInfo,
): Promise<boolean> {
    let stat = preStat;
    if (!stat) {
        try {
            stat = await Deno.stat(path);
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) return false;
            throw e;
        }
    }
    if (!stat.isFile) return false;

    const size = stat.size;
    res.set("Accept-Ranges", "bytes")
        .set("Last-Modified", stat.mtime?.toUTCString() ?? "")
        .type("video/mp4");

    if (head) {
        res.set("Content-Length", size.toString()).status(200).end();
        console.log(`[${log}] HEAD ${path}`);
        return true;
    }

    let start = 0;
    let end = size - 1;
    let code = 200;

    const m = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (m) {
        const s = m[1] ? Number(m[1]) : 0;
        const e = m[2] ? Number(m[2]) : size - 1;
        if (s >= size) {
            res.status(416).set("Content-Range", `bytes */${size}`).end();
            return true;
        }
        start = s;
        end = e < size ? e : size - 1;
        code = 206;
    }

    const length = end - start + 1;
    res.status(code)
        .set("Content-Length", length.toString());
    if (code === 206) res.set("Content-Range", `bytes ${start}-${end}/${size}`);
    console.log(`[${log}] ${code} ${start}-${end}/${size} ${path}`);

    let file: Deno.FsFile | null = null;
    try {
        file = await Deno.open(path, { read: true });
        await file.seek(start, Deno.SeekMode.Start);

        let sent = 0;
        for await (const chunk of file.readable) {
            if (res.destroyed) break;

            const remain = length - sent;
            if (chunk.byteLength > remain) {
                res.write(chunk.subarray(0, remain));
                break;
            }
            res.write(chunk);
            sent += chunk.byteLength;
        }
        res.end();
    } catch (err) {
        const msg = (err as Error)?.message ?? "";
        if (!msg.includes("Broken pipe") && !msg.includes("aborted") && err?.name !== "AbortError") {
            console.error(`[${log}] stream error`, err);
        }
    } finally {
        if (file !== null) {
            try { file.close(); } catch {
                //
            }
            file = null;
        }
    }

    return true;
}