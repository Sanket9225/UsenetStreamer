"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const types_js_1 = require("./types.js");
const utils_js_1 = require("./utils.js");
/**
 * Fields that use value sets
 */
const VALUE_SET_FIELDS = new Set([
    'audio',
    'channels',
    'hdr',
    'languages',
    'releaseTypes'
]);
function hasValueSet(field) {
    return VALUE_SET_FIELDS.has(field);
}
/**
 * Main parse function matching Go parse() function
 */
function parse(title, handlers) {
    const result = new Map();
    title = title.replace(utils_js_1.whitespacesRegex, ' ');
    title = title.replace(utils_js_1.underscoresRegex, ' ');
    let endOfTitle = title.length;
    for (const handler of handlers) {
        const field = handler.field;
        let skipFromTitle = handler.skipFromTitle ?? false;
        let m = result.get(field);
        const mFound = m !== undefined;
        if (handler.pattern) {
            if (mFound && !handler.keepMatching) {
                continue;
            }
            const idxs = (0, utils_js_1.getMatchIndices)(handler.pattern, title);
            if (idxs.length === 0) {
                continue;
            }
            if (handler.validateMatch && !handler.validateMatch(title, idxs)) {
                continue;
            }
            let shouldSkip = false;
            if (handler.skipIfFirst) {
                let hasOther = false;
                let hasBefore = false;
                for (const [f, fm] of result) {
                    if (f !== field) {
                        hasOther = true;
                        if (idxs[0] >= fm.mIndex) {
                            hasBefore = true;
                            break;
                        }
                    }
                }
                shouldSkip = hasOther && !hasBefore;
            }
            if (shouldSkip) {
                continue;
            }
            if (handler.skipIfBefore && handler.skipIfBefore.length > 0) {
                for (const skipField of handler.skipIfBefore) {
                    const fm = result.get(skipField);
                    if (fm && idxs[0] < fm.mIndex) {
                        shouldSkip = true;
                        break;
                    }
                }
                if (shouldSkip) {
                    continue;
                }
            }
            const rawMatchedPart = title.substring(idxs[0], idxs[1]);
            let matchedPart = rawMatchedPart;
            if (idxs.length > 2) {
                // Default to capture group 1 if valueGroup is not specified
                if (handler.valueGroup === undefined || handler.valueGroup === 0) {
                    matchedPart = title.substring(idxs[2], idxs[3]);
                }
                else if (idxs.length > handler.valueGroup * 2) {
                    matchedPart = title.substring(idxs[handler.valueGroup * 2], idxs[handler.valueGroup * 2 + 1]);
                }
            }
            const beforeTitleMatch = utils_js_1.beforeTitleRegex.exec(title);
            if (beforeTitleMatch && beforeTitleMatch[0].includes(rawMatchedPart)) {
                skipFromTitle = true;
            }
            if (!mFound) {
                m = {
                    mIndex: 0,
                    mValue: '',
                    value: hasValueSet(field) ? new types_js_1.ValueSet() : null,
                    remove: false,
                    processed: false
                };
                result.set(field, m);
            }
            if (m) {
                m.mIndex = idxs[0];
                m.mValue = rawMatchedPart;
                if (!hasValueSet(field)) {
                    m.value = matchedPart;
                }
                if (handler.matchGroup) {
                    m.mIndex = idxs[handler.matchGroup * 2];
                    m.mValue = title.substring(idxs[handler.matchGroup * 2], idxs[handler.matchGroup * 2 + 1]);
                }
            }
        }
        if (handler.process) {
            if (mFound && m) {
                m = handler.process(title, m, result);
            }
            else {
                const emptyMeta = {
                    mIndex: 0,
                    mValue: '',
                    value: null,
                    remove: false,
                    processed: false
                };
                m = handler.process(title, emptyMeta, result);
                if (m.value !== null) {
                    result.set(field, m);
                }
            }
        }
        if (!m) {
            continue;
        }
        if (m.value !== null && handler.transform) {
            handler.transform(title, m, result);
        }
        if (m.value === null) {
            result.delete(field);
            continue;
        }
        if (!result.has(field) ||
            (m.processed && !handler.keepMatching && !hasValueSet(field))) {
            continue;
        }
        if (handler.remove || m.remove) {
            m.remove = true;
            title =
                title.substring(0, m.mIndex) +
                    title.substring(m.mIndex + m.mValue.length);
        }
        if (!skipFromTitle && m.mIndex !== 0 && m.mIndex < endOfTitle) {
            endOfTitle = m.mIndex;
        }
        if (m.remove && skipFromTitle && m.mIndex < endOfTitle) {
            // adjust title index in case part of it should be removed and skipped
            endOfTitle -= m.mValue.length;
        }
        m.remove = false;
        m.processed = true;
    }
    // Build final result object
    const finalResult = {};
    for (const [field, fieldMeta] of result) {
        const v = fieldMeta.value;
        switch (field) {
            case 'audio':
                if (v instanceof types_js_1.ValueSet) {
                    finalResult.audio = v.values;
                }
                break;
            case 'bitDepth':
                finalResult.bitDepth = v;
                break;
            case 'channels':
                if (v instanceof types_js_1.ValueSet) {
                    finalResult.channels = v.values;
                }
                break;
            case 'codec':
                finalResult.codec = v;
                break;
            case 'commentary':
                finalResult.commentary = v;
                break;
            case 'complete':
                finalResult.complete = v;
                break;
            case 'container':
                finalResult.container = v;
                break;
            case 'convert':
                finalResult.convert = v;
                break;
            case 'date':
                finalResult.date = v;
                break;
            case 'documentary':
                finalResult.documentary = v;
                break;
            case 'ppv':
                finalResult.ppv = v;
                break;
            case 'dubbed':
                finalResult.dubbed = v;
                break;
            case 'edition':
                finalResult.edition = v;
                break;
            case 'episodeCode':
                finalResult.episodeCode = v;
                break;
            case 'episodes':
                finalResult.episodes = v;
                break;
            case 'extended':
                finalResult.extended = v;
                break;
            case 'extension':
                finalResult.extension = v;
                break;
            case 'group':
                finalResult.group = v;
                break;
            case 'hardcoded':
                finalResult.hardcoded = v;
                break;
            case 'hdr':
                if (v instanceof types_js_1.ValueSet) {
                    finalResult.hdr = v.values;
                }
                break;
            case 'languages':
                if (v instanceof types_js_1.ValueSet) {
                    const languages = v.values;
                    // If Latin American Spanish (es-419) is present, remove generic Spanish (es)
                    if (languages.includes('es-419') && languages.includes('es')) {
                        finalResult.languages = languages.filter((lang) => lang !== 'es');
                    }
                    else {
                        finalResult.languages = languages;
                    }
                }
                break;
            case 'network':
                finalResult.network = v;
                break;
            case 'proper':
                finalResult.proper = v;
                break;
            case 'region':
                finalResult.region = v;
                break;
            case 'remastered':
                finalResult.remastered = v;
                break;
            case 'repack':
                finalResult.repack = v;
                break;
            case 'resolution':
                finalResult.resolution = v;
                break;
            case 'retail':
                finalResult.retail = v;
                break;
            case 'seasons':
                finalResult.seasons = v;
                break;
            case 'size':
                finalResult.size = v;
                break;
            case 'site':
                finalResult.site = v;
                break;
            case 'quality':
                finalResult.quality = v;
                break;
            case 'releaseTypes':
                if (v instanceof types_js_1.ValueSet) {
                    finalResult.releaseTypes = v.values;
                }
                break;
            case 'subbed':
                finalResult.subbed = v;
                break;
            case 'threeD':
                finalResult.threeD = v;
                break;
            case 'uncensored':
                finalResult.uncensored = v;
                break;
            case 'unrated':
                finalResult.unrated = v;
                break;
            case 'upscaled':
                finalResult.upscaled = v;
                break;
            case 'volumes':
                finalResult.volumes = v;
                break;
            case 'year':
                finalResult.year = v;
                break;
            default:
                // Handle custom fields not in the predefined list
                finalResult[field] = v;
                break;
        }
    }
    const titleEnd = Math.max(Math.min(endOfTitle, title.length), 0);
    let rawTitle = title.substring(0, titleEnd);
    if (finalResult.episodes && finalResult.episodes.length > 0) {
        rawTitle = rawTitle.replace(utils_js_1.trailingEpisodePattern, '');
    }
    finalResult.title = (0, utils_js_1.cleanTitle)(rawTitle);
    return finalResult;
}
