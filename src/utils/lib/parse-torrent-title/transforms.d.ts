import { HandlerTransformer } from './types.js';
/**
 * Transformers - matching Go to_* functions
 */
export declare function toValue(value: string): HandlerTransformer;
export declare function toLowercase(): HandlerTransformer;
export declare function toUppercase(): HandlerTransformer;
export declare function toTrimmed(): HandlerTransformer;
export declare function toCleanDate(): HandlerTransformer;
export declare function toCleanMonth(): HandlerTransformer;
export declare function toDate(format: string): HandlerTransformer;
export declare function toYear(): HandlerTransformer;
export declare function toIntRange(): HandlerTransformer;
export declare function toWithSuffix(suffix: string): HandlerTransformer;
export declare function toBoolean(): HandlerTransformer;
export declare function toValueSet(v: any): HandlerTransformer;
export declare function toValueSetWithTransform(toV: (v: string) => any): HandlerTransformer;
export declare function toValueSetMultiWithTransform(toV: (v: string) => any[]): HandlerTransformer;
export declare function toIntArray(): HandlerTransformer;
export declare function toIntRangeTill(): HandlerTransformer;
