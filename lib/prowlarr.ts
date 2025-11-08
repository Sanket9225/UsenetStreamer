import { PROWLARR_API_KEY, PROWLARR_URL } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

interface ProwlarrSearchOptions {
    imdbId?: string;
    tvdbId?: string;
    tmdbId?: string;
    name?: string;
    year?: string;
    showName?: string;
    usenetOnly?: boolean;
    limit?: number;
    type?: 'movie' | 'series';
    season?: number;
    episode?: number;
}

interface SearchPlan {
    type: 'search' | 'movie' | 'tvsearch';
    query: string;
}

// Ensure ProwlarrResult is correctly typed to match usage
interface ProwlarrResult {
    guid: string | null;
    title: string;
    size: number;
    age: number;
    indexer: string;
    indexerId: number;
    protocol: string;
    downloadUrl: string;
    infoUrl: string;
    posterUrl: string;
    publishDate: string;
    fileName: string;
}

function isTorrentResult(result: ProwlarrResult): boolean {
    const protocol = (
        result.protocol ||
        ""
    ).toLowerCase();
    if (protocol === "torrent") {
        return true;
    }

    const guid = (result.guid || "").toLowerCase();
    const downloadUrl = (result.downloadUrl || "").toLowerCase();

    if (
        guid.startsWith("magnet:") ||
        downloadUrl.startsWith("magnet:")
    ) {
        return true;
    }

    if (
        guid.endsWith(".torrent") ||
        downloadUrl.endsWith(".torrent")
    ) {
        return true;
    }

    return false;
}

export async function searchProwlarr(opts: ProwlarrSearchOptions): Promise<ProwlarrResult[]> {
    const searchPlans: SearchPlan[] = [];
    const seenPlans = new Set<string>();

    const addPlan = (planType: SearchPlan['type'], query: string) => {
        if (!query) {
            return false;
        }
        const planKey = `${planType}|${query}`;
        if (seenPlans.has(planKey)) {
            return false;
        }
        seenPlans.add(planKey);
        searchPlans.push({ type: planType, query });
        return true;
    };

    let prowlarrSearchType: SearchPlan['type'];
    if (opts.type === "series") {
        prowlarrSearchType = "tvsearch";
    } else if (opts.type === "movie") {
        prowlarrSearchType = "movie";
    } else {
        prowlarrSearchType = "search";
    }

    // Plan 1: Search by IMDb ID
    if (opts.imdbId) {
        addPlan(prowlarrSearchType, `{ImdbId:${opts.imdbId}}`);
    }

    // Plan 2: Search by TVDB ID for series
    if (opts.type === "series" && opts.tvdbId) {
        addPlan("tvsearch", `{TvdbId:${opts.tvdbId}}`);
    }

    // Plan 3: Search by TMDB ID for movies
    if (opts.type === "movie" && opts.tmdbId) {
        addPlan("movie", `{TmdbId:${opts.tmdbId}}`);
    }

    // Fallback to text search if no ID-based plans were added or if specific season/episode is requested
    const textQueryParts: string[] = [];
    if (opts.name) {
        textQueryParts.push(opts.name);
    }
    if (opts.type === "movie" && opts.year) {
        textQueryParts.push(`(${opts.year})`);
    } else if (opts.type === "series" && opts.season && opts.episode) {
        textQueryParts.push(`S${String(opts.season).padStart(2, "0")}E${String(opts.episode).padStart(2, "0")}`);
    }

    interface RequestedEpisode {
        season: number;
        episode: number;
    }

    function fileMatchesEpisode(fileName: string, requestedEpisode: RequestedEpisode): boolean {
        if (!requestedEpisode) {
            return true;
        }
        const { season, episode } = requestedEpisode;
        const patterns = [
            new RegExp(`s0*${season}e0*${episode}(?![0-9])`, "i"),
            new RegExp(`s0*${season}\.?e0*${episode}(?![0-9])`, "i"),
            new RegExp(`0*${season}[xX]0*${episode}(?![0-9])`, "i"),
            new RegExp(`[eE](?:pisode|p)\.?\\s*0*${episode}(?![0-9])`, "i"),
        ];
        return patterns.some((regex) => regex.test(fileName));
    }

    const textQueryFallback = textQueryParts.filter(Boolean).join(" ").trim();
    if (textQueryFallback) {
        addPlan("search", textQueryFallback);
    }

    if (searchPlans.length === 0 && opts.imdbId) {
        // If no specific plans were added, but an IMDb ID is available, add a generic IMDb search
        addPlan(prowlarrSearchType, `{ImdbId:${opts.imdbId}}`);
    }


    const baseSearchParams = {
        apikey: PROWLARR_API_KEY,
        limit: String(opts.limit ?? 25),
        offset: "0",
        indexerIds: "-1",
    };

    // Category Logic Update: Check for season/episode first for TV category
    let categories: string;
    if (opts.season && opts.episode) {
        categories = "5000"; // Simplified to a single TV category (5000)
    } else if (opts.type === "series") {
        categories = "5000"; // Fallback to general TV categories
    } else {
        categories = "2000"; // Default to movie categories
    }

    const resultsByKey = new Map<string, ProwlarrResult>();

    const planExecutions = searchPlans.map(async (plan) => {
        const params = new URLSearchParams({
            ...baseSearchParams,
            type: plan.type,
            query: plan.query,
            categories: categories, // Apply categories to each plan
            ...(opts.season && { season: String(opts.season) }),
            ...(opts.episode && { ep: String(opts.episode) }),
            ...(opts.usenetOnly && { protocol: "usenet" }),
        });

        console.log("[Prowlarr] Dispatching plan:", plan, "with params:", params.toString());
        const url = `${PROWLARR_URL}/api/v1/search?${params.toString()}`;
        console.log(`[Prowlarr] → ${url}`);

        try {
            const data = await fetcher<ProwlarrResult[]>(url);
            if (!Array.isArray(data)) {
                console.warn("[Prowlarr] Unexpected response for plan", plan, data);
                return [];
            }
            return data;
        } catch (error: any) {
            console.error("[PROWLARR] ❌ Search plan failed", {
                message: error.message,
                type: plan.type,
                query: plan.query,
            });
            return [];
        }
    });

    const allResults = await Promise.all(planExecutions);

    for (const planResults of allResults) {
        const filteredResults = planResults.filter(r => {
            if (!r || typeof r !== "object" || !r.downloadUrl) {
                console.log(`[PROWLARR] Filtering out result (missing data): ${r?.title || 'N/A'}`);
                return false;
            }
            if (isTorrentResult(r)) {
                console.log(`[PROWLARR] Filtering out torrent result: ${r.title}`);
                return false;
            }
            if (opts.usenetOnly && r.protocol.toLowerCase() !== "usenet") {
                console.log(`[PROWLARR] Filtering out non-usenet result: ${r.title}`);
                return false;
            }

            // Stricter filtering for season/episode
            if (opts.season && opts.episode) {
                const requestedEpisode = { season: opts.season, episode: opts.episode };
                if (!fileMatchesEpisode(r.title, requestedEpisode)) {
                    console.log(`[PROWLARR] Filtering out result (episode mismatch): ${r.title} for S${opts.season}E${opts.episode}`);
                    return false;
                }
                console.log(`[PROWLARR] Keeping result (episode match): ${r.title} for S${opts.season}E${opts.episode}`);
            }

            // Stricter filtering for show name
            if (opts.showName) {
                const normalizedShowName = opts.showName.toLowerCase().replace(/[^a-z0-9]/g, '');
                const normalizedResultTitle = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!normalizedResultTitle.includes(normalizedShowName)) {
                    console.log(`[PROWLARR] Filtering out result (show name mismatch): ${r.title} for show ${opts.showName}`);
                    return false;
                }
                console.log(`[PROWLARR] Keeping result (show name match): ${r.title} for show ${opts.showName}`);
            }

            return true;
        });

        for (const item of filteredResults) {
            const key = `${item.indexerId}|${item.indexer}|${item.title}|${item.size}`;
            if (!resultsByKey.has(key)) {
                resultsByKey.set(key, item);
            }
        }
    }

    const dedupedNzbResults = Array.from(resultsByKey.values());

    // Sort: results with guid first
    dedupedNzbResults.sort((a, b) => {
        const aHasGuid = !!a.guid;
        const bHasGuid = !!b.guid;
        if (aHasGuid && !bHasGuid) return -1;
        if (!aHasGuid && bHasGuid) return 1;
        return 0; // keep relative order if both have or both lack guid
    });

    console.log(`[PROWLARR] Final aggregated unique NZB results: ${dedupedNzbResults.length}`);
    return dedupedNzbResults;
}