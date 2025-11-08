// deno-lint-ignore-file no-explicit-any
import { CINEMETA_URL } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

export interface CinemetaMovie {
    id: string;
    title: string;
    year: number;
    [key: string]: any;
}

export interface CinemetaSeries {
    id: string;
    title: string;
    year: number;
    seasons: any[];
    [key: string]: any;
}

/**
 * Fetch movie or series data from Cinemeta
 * @param type "movie" | "series"
 * @param imdbId Optional IMDb ID to fetch a single item
 */
export async function getCinemetaData(
    type: "movie" | "series",
    imdbId?: string
): Promise<CinemetaMovie | CinemetaSeries | any> {

    const url = `${CINEMETA_URL}/${type}/${imdbId}.json`;

    try {
        const data = await fetcher(url);
        return {
            name: data.meta.name,
            year: data.meta.year,
            imdbId: data.meta.imdb_id || data.meta.id,
            tvdbId: data.meta.ids?.tvdb || data.meta.tvdb_id || data.meta.externals?.tvdb,
            tmdbId: data.meta.ids?.tmdb || data.meta.tmdb_id || data.meta.externals?.tmdb,
        }
    } catch (err) {
        console.error(`[CINEMETA] Error fetching ${type} ${imdbId || ""}:`, err);
        throw err;
    }
}