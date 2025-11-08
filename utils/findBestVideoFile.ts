import { normalizeNzbdavPath, listWebdavDirectory, type WebdavEntry } from "./webdav.ts";
import { NZBDAV_MAX_DIRECTORY_DEPTH, NZBDAV_VIDEO_EXTENSIONS } from "../env.ts";
import { extname } from "@std/path/posix";


interface FileCandidate {
    name: string;
    size: number | string;
    matchesEpisode: boolean;
    absolutePath: string;
    viewPath: string;
}

interface FindFileParams {
    category: string;
    jobName: string;
    requestedEpisode: EpisodeInfo | undefined;
}

interface EpisodeInfo {
    season: number;
    episode: number;
}

export async function findBestVideoFile({
    category,
    jobName,
    requestedEpisode,
}: FindFileParams): Promise<FileCandidate | null> {
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`);

    const queue = [{ path: rootPath, depth: 0 }];
    const visited = new Set<string>();

    let bestMatch: FileCandidate | null = null;
    let bestEpisodeMatch: FileCandidate | null = null;

    while (queue.length > 0) {
        const { path: currentPath, depth } = queue.shift()!;
        if (depth > NZBDAV_MAX_DIRECTORY_DEPTH || visited.has(currentPath)) continue;
        visited.add(currentPath);

        let entries: WebdavEntry[] = [];
        try {
            entries = await listWebdavDirectory(currentPath);
        } catch (e) {
            console.error(`[NZBDAV] Failed to list ${currentPath}:`, e);
            continue;
        }

        for (const entry of entries) {
            if (!entry.name || entry.size === null) continue;

            const nextPath = normalizeNzbdavPath(`${currentPath}/${entry.name}`);

            if (entry.isDirectory) {
                queue.push({ path: nextPath + "/", depth: depth + 1 });
                continue;
            }

            if (!isVideoFileName(entry.name)) continue;

            const matchesEpisode = fileMatchesEpisode(entry.name, requestedEpisode);
            const candidate: FileCandidate = {
                name: entry.name,
                size: entry.size,
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

function fileMatchesEpisode(fileName: string, requestedEpisode: EpisodeInfo | undefined): boolean {
    if (!requestedEpisode) {
        return true;
    }
    const { season, episode } = requestedEpisode;

    const s = String(season);
    const e = String(episode);

    const patterns = [
        // S01E01 (must not be followed by another number, e.g., S01E010)
        new RegExp(`s0*${s}e0*${e}(?![0-9])`, "i"),
        // S01.E01 (with optional dot)
        new RegExp(`s0*${s}\\.?e0*${e}(?![0-9])`, "i"),
        // 1x01 (season X episode)
        new RegExp(`0*${s}[xX]0*${e}(?![0-9])`, "i"),
        // E01 (episode-only match, useful for single-season series)
        new RegExp(`[eE](?:pisode|p)\\.?\\s*0*${e}(?![0-9])`, "i"),
    ];

    return patterns.some((regex) => regex.test(fileName));
}

function isVideoFileName(fileName: string = ""): boolean {
    const extension = extname(fileName.toLowerCase());
    return NZBDAV_VIDEO_EXTENSIONS.has(extension);
}