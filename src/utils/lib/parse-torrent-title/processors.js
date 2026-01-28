"use strict";
/**
 * Processors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeFromValue = removeFromValue;
exports.regexMatchUntilValid = regexMatchUntilValid;
const utils_js_1 = require("./utils.js");
function removeFromValue(re) {
    return (title, m) => {
        if (typeof m.value === 'string' && m.value !== '') {
            m.value = m.value.replace(re, '');
        }
        return m;
    };
}
function regexMatchUntilValid(re, validator) {
    return (title, m) => {
        let offset = 0;
        while (offset < title.length) {
            const substring = title.substring(offset);
            const idxs = (0, utils_js_1.getMatchIndices)(re, substring);
            if (idxs.length === 0) {
                return m;
            }
            // Adjust indices to account for offset
            for (let i = 0; i < idxs.length; i++) {
                if (idxs[i] >= 0) {
                    idxs[i] += offset;
                }
            }
            if (validator(title, idxs)) {
                m.mIndex = idxs[0];
                m.mValue = title.substring(idxs[0], idxs[1]);
                if (idxs.length >= 4 && idxs[2] >= 0 && idxs[3] >= 0) {
                    m.value = title.substring(idxs[2], idxs[3]);
                }
                else {
                    m.value = m.mValue;
                }
                return m;
            }
            offset = idxs[1];
            if (offset === idxs[0]) {
                offset++;
            }
        }
        return m;
    };
}
