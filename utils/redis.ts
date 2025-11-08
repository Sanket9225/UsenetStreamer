import { Redis } from "ioredis";
import { REDIS_URL } from "../env.ts";

export const redis = new Redis(REDIS_URL);

/**
 * Sets a JSON value at a specific path in RedisJSON, with an optional expiration.
 * @param redisClient The Redis client instance.
 * @param key The Redis key to store the JSON in.
 * @param path The JSONPath to set the value (e.g., '$' for the root, '$.field').
 * @param data The data object/value to store.
 * @param expirationSeconds Optional TTL for the key in seconds.
 */

export async function setJsonValue(
    key: string,
    path: string,
    data: any,
    expirationSeconds?: number,
    mode?: 'NX' | 'XX'
): Promise<boolean> {
    const stringifiedData = JSON.stringify(data);

    const jsonSetArgs = [key, path, stringifiedData];
    if (mode) jsonSetArgs.push(mode);

    const result = await redis.call('JSON.SET', ...jsonSetArgs);

    const wasSet = result === 'OK';

    if (wasSet && expirationSeconds && expirationSeconds > 0) await redis.expire(key, expirationSeconds);

    return wasSet;
}

/**
 * Gets and parses a JSON value from a specific path in RedisJSON.
 * Defaults to the root path '$'.
 * @param key The Redis key containing the JSON.
 * @param path The JSONPath to retrieve the value from (defaults to '$').
 * @returns The parsed value of type T or null if the key/path doesn't exist or parsing fails.
 */
export async function getJsonValue<T>(
    key: string,
    path: string = '$'
): Promise<T | null> {
    try {
        const result = await redis.call('JSON.GET', key, path);
        if (result === null || result === undefined) return null;

        const jsonString = typeof result === 'string' ? result : result.toString();
        if (!jsonString) return null;

        const parsed = JSON.parse(jsonString);
        return (path.includes('$') && Array.isArray(parsed) ? parsed[0] : parsed) as T;
    } catch (e) {
        console.error(`[RedisJSON Helper] Failed to parse JSON for key ${key} at path ${path}.`, e);
        return null;
    }
}

/**
 * Deletes a specific path within a JSON document using JSON.DEL.
 * This is crucial for removing 'fail_status' without deleting the entire metadata.
 * @param key The Redis key containing the JSON document.
 * @param path The JSON path to delete (e.g., '$.fail_status').
 * @returns 1 if the path was deleted, 0 otherwise.
 */
export async function deleteJsonPath(key: string, path: string): Promise<number> {
    try {
        const deletedCount = await redis.call("JSON.del", key, path) as number;
        return deletedCount;
    } catch (e) {
        console.error("Error deleting Redis JSON path:", e);
        return 0;
    }
}