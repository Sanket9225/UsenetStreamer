"use strict";
/**
 * Parse Torrent Title - TypeScript Port
 *
 * A 1:1 port of the Go torrent title parser
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validators = exports.processors = exports.transforms = exports.handlers = exports.Parser = void 0;
exports.parseTorrentTitle = parseTorrentTitle;
exports.getPartialParser = getPartialParser;
const parser_js_1 = require("./parser.js");
const handlers_js_1 = require("./handlers.js");
/**
 * Parser class for customisable torrent title parsing
 */
class Parser {
    constructor() {
        this.handlers = [];
    }
    /**
     * Add a custom handler to the parser
     * @param handler - The handler to add
     * @returns The parser instance for chaining
     */
    addHandler(handler) {
        if (!handler) {
            throw new Error('Handler cannot be undefined or null');
        }
        this.handlers.push(handler);
        return this;
    }
    /**
     * Add multiple custom handlers to the parser
     * @param handlers - Array of handlers to add
     * @returns The parser instance for chaining
     */
    addHandlers(handlers) {
        if (!handlers || handlers.length === 0) {
            throw new Error('Handlers array cannot be undefined, null, or empty');
        }
        if (handlers.some((h) => h === null || h === undefined)) {
            throw new Error('Handlers array cannot contain null or undefined handlers');
        }
        this.handlers.push(...handlers);
        return this;
    }
    /**
     * Add default handlers for specific fields
     * @param fields - Optional array of field names to include. If empty, all default handlers are added.
     * @returns The parser instance for chaining
     */
    addDefaultHandlers(...fields) {
        if (fields.length === 0) {
            this.handlers.push(...handlers_js_1.handlers);
        }
        else {
            // Add only handlers for specified fields
            const selectedFieldMap = new Set(fields);
            const selectedHandlers = handlers_js_1.handlers.filter((h) => selectedFieldMap.has(h.field));
            this.handlers.push(...selectedHandlers);
        }
        return this;
    }
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
    parse(title) {
        return (0, parser_js_1.parse)(title, this.handlers);
    }
}
exports.Parser = Parser;
/**
 * Parse a torrent title and extract metadata using all default handlers
 * @param title - The torrent title to parse
 * @returns Parsed result with extracted metadata
 */
function parseTorrentTitle(title) {
    return (0, parser_js_1.parse)(title, handlers_js_1.handlers);
}
/**
 * Create a partial parser with only specific fields
 * @param fieldNames - Array of field names to parse
 * @returns A parser function that only extracts the specified fields
 */
function getPartialParser(fieldNames) {
    const selectedFieldMap = new Set(fieldNames);
    const selectedHandlers = handlers_js_1.handlers.filter((h) => selectedFieldMap.has(h.field));
    return (title) => (0, parser_js_1.parse)(title, selectedHandlers);
}
const transforms = __importStar(require("./transforms.js"));
exports.transforms = transforms;
const processors = __importStar(require("./processors.js"));
exports.processors = processors;
const validators = __importStar(require("./validators.js"));
exports.validators = validators;
var handlers_js_2 = require("./handlers.js");
Object.defineProperty(exports, "handlers", { enumerable: true, get: function () { return handlers_js_2.handlers; } });
