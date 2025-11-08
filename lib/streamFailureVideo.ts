import { Request, Response } from "express";
import { streamFileResponse } from "../utils/streamFileResponse.ts";
import { resolve } from "@std/path/posix";
import { FAILURE_VIDEO_FILENAME } from "../env.ts";

const FAILURE_VIDEO_PATH = resolve(
    Deno.cwd(), // use deno built in
    "public",
    "assets",
    FAILURE_VIDEO_FILENAME
);

async function safeStat(filePath: string): Promise<Deno.FileInfo | null> {
    try {
        return await Deno.stat(filePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return null;
        }
        throw error;
    }
}

export async function streamFailureVideo(req: Request, res: Response, failureError?: any): Promise<boolean> {
    const stats = await safeStat(FAILURE_VIDEO_PATH);
    if (!stats || !stats.isFile) {
        console.error(
            `[FAILURE STREAM] Failure video not found at ${FAILURE_VIDEO_PATH}`
        );
        return false;
    }

    const emulateHead = (req.method || "GET").toUpperCase() === "HEAD";
    const failureMessage =
        failureError?.failureMessage ||
        failureError?.message ||
        "NZBDav download failed";

    if (!res.headersSent) {
        res.setHeader("X-NZBDav-Failure", failureMessage);
    }

    console.warn(
        `[FAILURE STREAM] Serving fallback video due to NZBDav failure: ${failureMessage}`
    );
    return streamFileResponse(
        req,
        res,
        FAILURE_VIDEO_PATH,
        emulateHead,
        "FAILURE STREAM",
        stats
    );
}