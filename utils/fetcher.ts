// deno-lint-ignore-file no-explicit-any
export interface FetcherOptions extends RequestInit {
    parseJson?: boolean;
    timeoutMs?: number;
}

export async function fetcher<T = any>(
    url: string,
    options: FetcherOptions = {}
): Promise<T> {
    const { parseJson = true, timeoutMs = 10000, ...fetchOptions } = options;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}: ${response.statusText}`);
        }

        if (!parseJson) {
            return response as unknown as T;
        }

        return await response.json();
    } catch (err) {
        if ((err as any).name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}