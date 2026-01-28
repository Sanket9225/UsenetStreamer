/**
 * Main result interface matching the Go Result struct
 * Using JavaScript/TypeScript camelCase naming conventions
 */
export interface ParsedResult {
    audio?: string[];
    bitDepth?: string;
    channels?: string[];
    codec?: string;
    commentary?: boolean;
    complete?: boolean;
    container?: string;
    convert?: boolean;
    date?: string;
    documentary?: boolean;
    ppv?: boolean;
    dubbed?: boolean;
    edition?: string;
    episodeCode?: string;
    episodes?: number[];
    extended?: boolean;
    extension?: string;
    group?: string;
    hdr?: string[];
    hardcoded?: boolean;
    languages?: string[];
    network?: string;
    proper?: boolean;
    quality?: string;
    region?: string;
    releaseTypes?: string[];
    remastered?: boolean;
    repack?: boolean;
    resolution?: string;
    retail?: boolean;
    seasons?: number[];
    site?: string;
    size?: string;
    subbed?: boolean;
    threeD?: string;
    title?: string;
    uncensored?: boolean;
    unrated?: boolean;
    upscaled?: boolean;
    volumes?: number[];
    year?: string;
}
/**
 * Internal parse metadata
 */
export interface ParseMeta {
    mIndex: number;
    mValue: string;
    value: any;
    remove: boolean;
    processed: boolean;
}
/**
 * Value set for handling unique collections
 */
export declare class ValueSet<T> {
    private existMap;
    private _values;
    append(v: T): ValueSet<T>;
    exists(v: T): boolean;
    get values(): T[];
}
/**
 * Handler validator function type
 */
export type HandlerMatchValidator = (input: string, idxs: number[]) => boolean;
/**
 * Handler processor function type
 */
export type HandlerProcessor = (title: string, m: ParseMeta, result: Map<string, ParseMeta>) => ParseMeta;
/**
 * Handler transformer function type
 */
export type HandlerTransformer = (title: string, m: ParseMeta, result: Map<string, ParseMeta>) => void;
/**
 * Handler configuration matching Go handler struct
 */
export interface Handler {
    field: string;
    pattern?: RegExp;
    validateMatch?: HandlerMatchValidator;
    transform?: HandlerTransformer;
    process?: HandlerProcessor;
    remove?: boolean;
    keepMatching?: boolean;
    skipIfFirst?: boolean;
    skipIfBefore?: string[];
    skipFromTitle?: boolean;
    matchGroup?: number;
    valueGroup?: number;
}
/**
 * Result of parsing with map structure
 */
export type ParseResult = Map<string, ParseMeta>;
