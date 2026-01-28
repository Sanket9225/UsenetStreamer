/**
 * Parse Torrent Title - TypeScript Port
 *
 * A 1:1 port of the Go torrent title parser
 */
import { ParsedResult, Handler } from './types.js';
/**
 * Parser class for customisable torrent title parsing
 */
export declare class Parser {
    private handlers;
    /**
     * Add a custom handler to the parser
     * @param handler - The handler to add
     * @returns The parser instance for chaining
     */
    addHandler(handler: Handler): Parser;
    /**
     * Add multiple custom handlers to the parser
     * @param handlers - Array of handlers to add
     * @returns The parser instance for chaining
     */
    addHandlers(handlers: Handler[]): Parser;
    /**
     * Add default handlers for specific fields
     * @param fields - Optional array of field names to include. If empty, all default handlers are added.
     * @returns The parser instance for chaining
     */
    addDefaultHandlers(...fields: string[]): Parser;
    /**
     * Parse a torrent title using the configured handlers
     * @param title - The torrent title to parse
     * @returns Parsed result with extracted metadata and any custom fields
     * @template T - Optional type for custom fields added by custom handlers
     *
     * @example
     * // Without custom fields
     * const result = parser.parse('Movie.2024.1080p');
     *
     * @example
     * // With typed custom fields
     * const result = parser.parse<{ customId: number[] }>('Movie.2024.custom-123.1080p');
     * console.log(result.customId); // Type-safe access
     */
    parse<T extends Record<string, any> = Record<string, never>>(title: string): ParsedResult & T;
}
/**
 * Parse a torrent title and extract metadata using all default handlers
 * @param title - The torrent title to parse
 * @returns Parsed result with extracted metadata
 */
export declare function parseTorrentTitle(title: string): ParsedResult;
/**
 * Create a partial parser with only specific fields
 * @param fieldNames - Array of field names to parse
 * @returns A parser function that only extracts the specified fields
 */
export declare function getPartialParser(fieldNames: string[]): (title: string) => ParsedResult;
import * as transforms from './transforms.js';
import * as processors from './processors.js';
import * as validators from './validators.js';
export { ParsedResult, Handler } from './types.js';
export { handlers } from './handlers.js';
export { transforms, processors, validators };
