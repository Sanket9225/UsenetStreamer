export interface EpisodeInfo {
    season: number;
    episode: number;
}

export interface QueryParams {
    [key: string]: string | string[] | undefined;
}


export function parseRequestedEpisode(type: string, id: string | null | undefined, query: QueryParams = {}): EpisodeInfo | undefined {

    const seasonFromQuery = extractInt(query.season ?? query.Season ?? query.S);
    const episodeFromQuery = extractInt(
        query.episode ?? query.Episode ?? query.E
    );

    if (seasonFromQuery !== null && episodeFromQuery !== null) {
        return { season: seasonFromQuery, episode: episodeFromQuery };
    }

    // 2. Check ID String (e.g., used in routing: series:S01:E01)
    if (type === "series" && typeof id === "string" && id.includes(":")) {
        const parts = id.split(":");
        if (parts.length >= 3) {
            // parts[0] is type, parts[1] is season, parts[2] is episode
            const season = extractInt(parts[1]);
            const episode = extractInt(parts[2]);
            if (season !== null && episode !== null) {
                return { season, episode };
            }
        }
    }

    return undefined;
}

const extractInt = (value: string | string[] | undefined) => {
    if (value === undefined || value === null) return null;

    // Ensure we only parse the first value if it's an array
    const strValue = Array.isArray(value) ? value[0] : String(value);

    const parsed = parseInt(strValue, 10);
    return Number.isFinite(parsed) ? parsed : null;
};