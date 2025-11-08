import { getJsonValue, setJsonValue } from "./redis.ts";
import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";

interface RequestedEpisode {
    season: number;
    episode: number;
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
    imdbId: string,
    requestedEpisode?: RequestedEpisode | undefined
): Promise<{ cinemetaData: CinemetaData; results: ProwlarrResult[] }> {

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

    const episodeSuffix = requestedEpisode
        ? `S${requestedEpisode.season}E${requestedEpisode.episode}`
        : '';

    const searchKey = `prowlarr:search:${imdbId}${episodeSuffix}`;
    let results: ProwlarrResult[] | null = await getJsonValue<ProwlarrResult[]>(searchKey);

    if (!results) {
        console.log(`[Cache] Prowlarr search miss for ${searchKey}`);

        const seasonEpisodeQuery = requestedEpisode
            ? {
                season: requestedEpisode.season,
                episode: requestedEpisode.episode
            }
            : {};

        results = await searchProwlarr({
            imdbId,
            tvdbId,
            tmdbId,
            name: showName,
            year: String(year),
            type,
            usenetOnly: true,
            limit: 10,
            showName: showName,
            ...seasonEpisodeQuery
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