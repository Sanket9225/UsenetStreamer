import { HandlerMatchValidator } from './types.js';
/**
 * Validators - matching Go validate_* functions
 */
export declare function validateOr(...validators: HandlerMatchValidator[]): HandlerMatchValidator;
export declare function validateAnd(...validators: HandlerMatchValidator[]): HandlerMatchValidator;
export declare function validateLookbehind(pattern: string, flags: string, polarity: boolean): HandlerMatchValidator;
export declare function validateLookahead(pattern: string, flags: string, polarity: boolean): HandlerMatchValidator;
export declare function validateNotAtStart(): HandlerMatchValidator;
export declare function validateNotAtEnd(): HandlerMatchValidator;
export declare function validateNotMatch(re: RegExp): HandlerMatchValidator;
export declare function validateMatch(re: RegExp): HandlerMatchValidator;
export declare function validateMatchedGroupsAreSame(...indices: number[]): HandlerMatchValidator;
