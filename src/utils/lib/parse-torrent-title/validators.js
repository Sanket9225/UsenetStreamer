"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOr = validateOr;
exports.validateAnd = validateAnd;
exports.validateLookbehind = validateLookbehind;
exports.validateLookahead = validateLookahead;
exports.validateNotAtStart = validateNotAtStart;
exports.validateNotAtEnd = validateNotAtEnd;
exports.validateNotMatch = validateNotMatch;
exports.validateMatch = validateMatch;
exports.validateMatchedGroupsAreSame = validateMatchedGroupsAreSame;
/**
 * Validators - matching Go validate_* functions
 */
function validateOr(...validators) {
    return (input, idxs) => {
        return validators.some((v) => v(input, idxs));
    };
}
function validateAnd(...validators) {
    return (input, idxs) => {
        return validators.every((v) => v(input, idxs));
    };
}
function validateLookbehind(pattern, flags, polarity) {
    const flagStr = flags.toLowerCase().replace(/[^gimsuy]/g, '');
    const re = new RegExp(pattern + '$', flagStr);
    return (input, match) => {
        const rv = input.substring(0, match[0]);
        if (polarity) {
            return re.test(rv);
        }
        return !re.test(rv);
    };
}
function validateLookahead(pattern, flags, polarity) {
    const flagStr = flags.toLowerCase().replace(/[^gimsuy]/g, '');
    const re = new RegExp('^' + pattern, flagStr);
    return (input, match) => {
        const rv = input.substring(match[1]);
        if (polarity) {
            return re.test(rv);
        }
        return !re.test(rv);
    };
}
function validateNotAtStart() {
    return (input, match) => {
        return match[0] !== 0;
    };
}
function validateNotAtEnd() {
    return (input, match) => {
        return match[1] !== input.length;
    };
}
function validateNotMatch(re) {
    return (input, match) => {
        const rv = input.substring(match[0], match[1]);
        return !re.test(rv);
    };
}
function validateMatch(re) {
    return (input, match) => {
        const rv = input.substring(match[0], match[1]);
        return re.test(rv);
    };
}
function validateMatchedGroupsAreSame(...indices) {
    return (input, match) => {
        const first = input.substring(match[indices[0] * 2], match[indices[0] * 2 + 1]);
        for (let i = 1; i < indices.length; i++) {
            const index = indices[i];
            const other = input.substring(match[index * 2], match[index * 2 + 1]);
            if (other !== first) {
                return false;
            }
        }
        return true;
    };
}
