/**
 * Processors
 */
import { HandlerProcessor, HandlerMatchValidator } from './types.js';
export declare function removeFromValue(re: RegExp): HandlerProcessor;
export declare function regexMatchUntilValid(re: RegExp, validator: HandlerMatchValidator): HandlerProcessor;
