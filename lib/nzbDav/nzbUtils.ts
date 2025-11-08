import { NZBDAV_CATEGORY_DEFAULT, NZBDAV_CATEGORY_MOVIES, NZBDAV_CATEGORY_SERIES } from "../../env.ts";

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getNzbdavCategory(type: string): string {
    if (type === 'series' || type === 'tv') {
        return NZBDAV_CATEGORY_SERIES;
    }
    if (type === 'movie') {
        return NZBDAV_CATEGORY_MOVIES;
    }
    return NZBDAV_CATEGORY_DEFAULT;
}

export function buildNzbdavApiParams(mode: string, extra: Record<string, any> = {}) {
    return {
        mode,
        // apikey: NZBDAV_API_KEY, // why send more data then we need?
        ...extra,
        output: "json",
    };
}