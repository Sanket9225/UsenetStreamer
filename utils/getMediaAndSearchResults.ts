import { getJsonValue, setJsonValue } from "./redis.ts";
import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";

interface RequestedEpisode {
    imdbid?: string;
    season?: number | undefined;
    episode?: number | undefined;
}

interface CinemetaData {
    name: string;
    year: string;
    tvdbId?: string;
    tmdbId?: string;
}


interface ProwlarrResult {
    guid: string | null;
    title: string;
    downloadUrl: string;
    size: number;
    fileName?: string;
    category?: string;
}

const CINEMETA_CACHE_TTL = 86400 * 7;
const PROWLARR_SEARCH_CACHE_TTL = 3600;

/**
 * Fetches media metadata and search results, utilizing Redis for caching both API calls.
 * * @param type The media type (must be 'movie' or 'series').
 * @param imdbId The IMDb ID of the media (e.g., "tt0088763").
 * @param requestedEpisode Optional season/episode data for TV series.
 * @returns An object containing the Cinemeta data and combined Prowlarr search results.
 */
export async function getMediaAndSearchResults(
    type: 'movie' | 'series',
    episodeInfo: RequestedEpisode
): Promise<{ cinemetaData: CinemetaData; results: ProwlarrResult[] }> {

    const { imdbid: imdbId, season, episode } = episodeInfo;

    const cinemetaKey = `cinemeta:${type}:${imdbId}`;
    let cinemetaData: CinemetaData | null = await getJsonValue<CinemetaData>(cinemetaKey);

    if (!cinemetaData) {
        console.log(`[Cache] Cinemeta miss for ${cinemetaKey}`);

        const fetchedData = await getCinemetaData(type, imdbId);
        cinemetaData = fetchedData as CinemetaData;

        await setJsonValue(
            cinemetaKey,
            '$',
            cinemetaData,
            CINEMETA_CACHE_TTL
        );
    }

    const { name: showName, year, tvdbId, tmdbId } = cinemetaData!;

    const searchKey = episode && season
        ? `prowlarr:search:${imdbId}:${season}:${episode}`
        : `prowlarr:search:${imdbId}`;
    let results: ProwlarrResult[] | null = await getJsonValue<ProwlarrResult[]>(searchKey);

    if (!results) {
        console.log(`[Cache] Prowlarr search miss for ${searchKey}`);

        results = await searchProwlarr({
            imdbId,
            tvdbId,
            tmdbId,
            name: showName,
            year: String(year),
            type,
            limit: 10,
            ...episode && season ? { season, episode } : {},
        });


        await setJsonValue(
            searchKey,
            '$',
            results,
            PROWLARR_SEARCH_CACHE_TTL
        );
    }

    return { cinemetaData: cinemetaData!, results: results! };
}