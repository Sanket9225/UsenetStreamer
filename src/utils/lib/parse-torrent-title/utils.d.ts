/**
 * Utility regex patterns and helper functions
 * Matching ptt.go patterns
 */
export declare const NON_ENGLISH_CHARS = "\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF\\u0400-\\u04FF";
export declare const russianCastRegex: RegExp;
export declare const altTitlesRegex: RegExp;
export declare const notOnlyNonEnglishRegex: RegExp;
export declare const notAllowedSymbolsAtStartAndEndRegex: RegExp;
export declare const remainingNotAllowedSymbolsAtStartAndEndRegex: RegExp;
export declare const movieIndicatorRegex: RegExp;
export declare const releaseGroupMarkingAtStartRegex: RegExp;
export declare const releaseGroupMarkingAtEndRegex: RegExp;
export declare const beforeTitleRegex: RegExp;
export declare const nonDigitRegex: RegExp;
export declare const nonDigitsRegex: RegExp;
export declare const nonAlphasRegex: RegExp;
export declare const underscoresRegex: RegExp;
export declare const whitespacesRegex: RegExp;
export declare const redundantSymbolsAtEnd: RegExp;
export declare const trailingEpisodePattern: RegExp;
export declare const curlyBrackets: string[];
export declare const squareBrackets: string[];
export declare const parentheses: string[];
export declare const brackets: string[][];
/**
 * Clean title matching Go clean_title function
 */
export declare function cleanTitle(rawTitle: string): string;
/**
 * Helper to get all regex match indices (like Go FindStringSubmatchIndex)
 */
export declare function getMatchIndices(regex: RegExp, str: string): number[];
