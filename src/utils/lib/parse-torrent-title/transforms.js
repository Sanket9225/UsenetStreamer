"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toValue = toValue;
exports.toLowercase = toLowercase;
exports.toUppercase = toUppercase;
exports.toTrimmed = toTrimmed;
exports.toCleanDate = toCleanDate;
exports.toCleanMonth = toCleanMonth;
exports.toDate = toDate;
exports.toYear = toYear;
exports.toIntRange = toIntRange;
exports.toWithSuffix = toWithSuffix;
exports.toBoolean = toBoolean;
exports.toValueSet = toValueSet;
exports.toValueSetWithTransform = toValueSetWithTransform;
exports.toValueSetMultiWithTransform = toValueSetMultiWithTransform;
exports.toIntArray = toIntArray;
exports.toIntRangeTill = toIntRangeTill;
const types_js_1 = require("./types.js");
const utils_js_1 = require("./utils.js");
/**
 * Transformers - matching Go to_* functions
 */
function toValue(value) {
    return (title, m) => {
        m.value = value;
    };
}
function toLowercase() {
    return (title, m) => {
        m.value = m.value.toLowerCase();
    };
}
function toUppercase() {
    return (title, m) => {
        m.value = m.value.toUpperCase();
    };
}
function toTrimmed() {
    return (title, m) => {
        m.value = m.value.trim();
    };
}
function toCleanDate() {
    const re = /(\d+)(?:st|nd|rd|th)/g;
    return (title, m) => {
        if (typeof m.value === 'string') {
            m.value = m.value.replace(re, '$1');
        }
    };
}
function toCleanMonth() {
    const re = /(?:feb(?:ruary)?|jan(?:uary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/gi;
    return (title, m) => {
        if (typeof m.value === 'string') {
            m.value = m.value.replace(re, (str) => str.substring(0, 3));
        }
    };
}
function toDate(format) {
    const separatorRe = /[.\-/\\]/g;
    return (title, m) => {
        if (typeof m.value === 'string') {
            const normalized = m.value.replace(separatorRe, ' ');
            const parsed = parseDate(normalized, format);
            m.value = parsed || '';
        }
    };
}
/**
 * Simple date parser matching Go's time.Parse behavior
 */
function parseDate(dateStr, format) {
    try {
        // Handle compact formats like 20060102 (YYYYMMDD)
        if (format === '20060102' && dateStr.length === 8) {
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6));
            const day = parseInt(dateStr.substring(6, 8));
            if (year && month && day) {
                const date = new Date(Date.UTC(year, month - 1, day));
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
            }
            return null;
        }
        // Map Go format to JS parsing
        // This is a simplified version - you may need to enhance this
        const parts = dateStr.trim().split(/\s+/);
        const formatParts = format.split(/\s+/);
        let year = 0, month = 0, day = 0;
        for (let i = 0; i < formatParts.length && i < parts.length; i++) {
            const fmt = formatParts[i];
            const val = parts[i];
            if (fmt === '2006' || fmt === 'YYYY') {
                year = parseInt(val);
            }
            else if (fmt === '06' || fmt === 'YY') {
                year = 2000 + parseInt(val);
                if (year > 2069)
                    year -= 100;
            }
            else if (fmt === '01' || fmt === 'MM') {
                month = parseInt(val);
            }
            else if (fmt === '02' || fmt === 'DD' || fmt === '_2') {
                day = parseInt(val);
            }
            else if (fmt === 'Jan' || fmt === 'MMM') {
                const months = [
                    'jan',
                    'feb',
                    'mar',
                    'apr',
                    'may',
                    'jun',
                    'jul',
                    'aug',
                    'sep',
                    'oct',
                    'nov',
                    'dec'
                ];
                month = months.indexOf(val.toLowerCase().substring(0, 3)) + 1;
            }
            else if (fmt === 'YYYYMMDD') {
                year = parseInt(val.substring(0, 4));
                month = parseInt(val.substring(4, 6));
                day = parseInt(val.substring(6, 8));
            }
        }
        if (year && month && day) {
            // Use Date.UTC to avoid timezone conversion issues
            const date = new Date(Date.UTC(year, month - 1, day));
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
function toYear() {
    return (title, m) => {
        if (typeof m.value !== 'string') {
            m.value = '';
            return;
        }
        const parts = m.value.split(utils_js_1.nonDigitsRegex).filter((p) => p);
        if (parts.length === 1) {
            m.value = parts[0];
            return;
        }
        const start = parts[0];
        const end = parts[1];
        let endYear = parseInt(end);
        if (isNaN(endYear)) {
            m.value = start;
            return;
        }
        const startYear = parseInt(start);
        if (isNaN(startYear)) {
            m.value = '';
            return;
        }
        if (endYear < 100) {
            endYear = endYear + startYear - (startYear % 100);
        }
        if (endYear <= startYear) {
            m.value = '';
            return;
        }
        m.value = `${startYear}-${endYear}`;
    };
}
function toIntRange() {
    return (title, m) => {
        if (typeof m.value !== 'string') {
            m.value = null;
            return;
        }
        const parts = m.value
            .replace(utils_js_1.nonDigitsRegex, ' ')
            .trim()
            .split(' ')
            .filter((p) => p);
        const nums = parts.map((p) => parseInt(p)).filter((n) => !isNaN(n));
        if (nums.length === 2 && nums[0] < nums[1]) {
            const seq = [];
            for (let i = nums[0]; i <= nums[1]; i++) {
                seq.push(i);
            }
            m.value = seq;
            return;
        }
        // Check if in sequence and ascending order
        for (let i = 0; i < nums.length - 1; i++) {
            if (nums[i] + 1 !== nums[i + 1]) {
                m.value = null;
                return;
            }
        }
        m.value = nums;
    };
}
function toWithSuffix(suffix) {
    return (title, m) => {
        if (typeof m.value === 'string') {
            m.value = m.value + suffix;
        }
        else {
            m.value = '';
        }
    };
}
function toBoolean() {
    return (title, m) => {
        m.value = true;
    };
}
function toValueSet(v) {
    return (title, m) => {
        if (m.value instanceof types_js_1.ValueSet) {
            m.value.append(v);
        }
    };
}
function toValueSetWithTransform(toV) {
    return (title, m) => {
        if (m.value instanceof types_js_1.ValueSet) {
            m.value.append(toV(m.mValue));
        }
    };
}
function toValueSetMultiWithTransform(toV) {
    return (title, m) => {
        if (m.value instanceof types_js_1.ValueSet) {
            const values = toV(m.mValue);
            for (const val of values) {
                m.value.append(val);
            }
        }
    };
}
function toIntArray() {
    return (title, m) => {
        if (typeof m.value === 'string') {
            const num = parseInt(m.value);
            m.value = !isNaN(num) ? [num] : [];
        }
        else {
            m.value = [];
        }
    };
}
function toIntRangeTill() {
    return (title, m) => {
        if (typeof m.value !== 'string') {
            m.value = null;
            return;
        }
        const parts = m.value
            .replace(utils_js_1.nonDigitsRegex, ' ')
            .trim()
            .split(' ')
            .filter((p) => p);
        if (parts.length === 0) {
            m.value = null;
            return;
        }
        const num = parseInt(parts[0]);
        if (!isNaN(num)) {
            const nums = [];
            for (let i = 1; i <= num; i++) {
                nums.push(i);
            }
            m.value = nums;
            return;
        }
        m.value = null;
    };
}
