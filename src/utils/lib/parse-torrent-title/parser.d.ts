import { Handler, ParsedResult } from './types.js';
/**
 * Main parse function matching Go parse() function
 */
export declare function parse(title: string, handlers: Handler[]): ParsedResult;
