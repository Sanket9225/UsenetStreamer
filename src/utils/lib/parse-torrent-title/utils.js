"use strict";
/**
 * Utility regex patterns and helper functions
 * Matching ptt.go patterns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.brackets = exports.parentheses = exports.squareBrackets = exports.curlyBrackets = exports.trailingEpisodePattern = exports.redundantSymbolsAtEnd = exports.whitespacesRegex = exports.underscoresRegex = exports.nonAlphasRegex = exports.nonDigitsRegex = exports.nonDigitRegex = exports.beforeTitleRegex = exports.releaseGroupMarkingAtEndRegex = exports.releaseGroupMarkingAtStartRegex = exports.movieIndicatorRegex = exports.remainingNotAllowedSymbolsAtStartAndEndRegex = exports.notAllowedSymbolsAtStartAndEndRegex = exports.notOnlyNonEnglishRegex = exports.altTitlesRegex = exports.russianCastRegex = exports.NON_ENGLISH_CHARS = void 0;
exports.cleanTitle = cleanTitle;
exports.getMatchIndices = getMatchIndices;
// Unicode property escapes aren't fully supported in JS regex
// We'll use XRegExp or create character ranges for non-English chars
exports.NON_ENGLISH_CHARS = '\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF\\u0400-\\u04FF';
// Main regex patterns from ptt.go
exports.russianCastRegex = new RegExp(`(\\([^)]*[${exports.NON_ENGLISH_CHARS}][^)]*\\))$|(?:\\/.*?)(\\(.*\\))$`, 'u');
exports.altTitlesRegex = new RegExp(`[^/|(]*[${exports.NON_ENGLISH_CHARS}][^/|]*[/|]|[/|][^/|(]*[${exports.NON_ENGLISH_CHARS}][^/|]*`, 'gu');
exports.notOnlyNonEnglishRegex = new RegExp(`(?:[a-zA-Z][^${exports.NON_ENGLISH_CHARS}]+)([${exports.NON_ENGLISH_CHARS}].*[${exports.NON_ENGLISH_CHARS}])|([${exports.NON_ENGLISH_CHARS}].*[${exports.NON_ENGLISH_CHARS}])(?:[^${exports.NON_ENGLISH_CHARS}]+[a-zA-Z])`, 'u');
exports.notAllowedSymbolsAtStartAndEndRegex = new RegExp(`^[^\\w${exports.NON_ENGLISH_CHARS}#[【★]+|[ \\-:/\\\\[|{(#$&^]+$`, 'gu');
exports.remainingNotAllowedSymbolsAtStartAndEndRegex = new RegExp(`^[^\\w${exports.NON_ENGLISH_CHARS}#]+|[\\[\\]({} ]+$`, 'gu');
exports.movieIndicatorRegex = /[[(]movie[)\]]/gi;
exports.releaseGroupMarkingAtStartRegex = /^[[【★].*[\]】★][ .]?(.+)/;
exports.releaseGroupMarkingAtEndRegex = /(.+)[ .]?[[【★].*[\]】★]$/;
exports.beforeTitleRegex = /^\[([^[\]]+)]/;
exports.nonDigitRegex = /\D/;
exports.nonDigitsRegex = /\D+/g;
exports.nonAlphasRegex = /\W+/g;
exports.underscoresRegex = /_+/g;
exports.whitespacesRegex = /\s+/g;
exports.redundantSymbolsAtEnd = /[ \-:./\\]+$/;
exports.trailingEpisodePattern = /[ .]*-[ .]*\d{1,4}[ .]*$/;
exports.curlyBrackets = ['{', '}'];
exports.squareBrackets = ['[', ']'];
exports.parentheses = ['(', ')'];
exports.brackets = [exports.curlyBrackets, exports.squareBrackets, exports.parentheses];
/**
 * Clean title matching Go clean_title function
 */
function cleanTitle(rawTitle) {
    let title = rawTitle.trim();
    title = title.replace(/_/g, ' ');
    title = title.replace(exports.movieIndicatorRegex, ''); // clear movie indication flag
    title = title.replace(exports.notAllowedSymbolsAtStartAndEndRegex, '');
    // clear russian cast information
    const russianMatches = title.match(exports.russianCastRegex);
    if (russianMatches) {
        for (let i = 1; i < russianMatches.length; i++) {
            if (russianMatches[i]) {
                title = title.replace(russianMatches[i], '');
            }
        }
    }
    title = title.replace(exports.releaseGroupMarkingAtStartRegex, '$1'); // remove release group markings sections from the start
    title = title.replace(exports.releaseGroupMarkingAtEndRegex, '$1'); // remove unneeded markings section at the end if present
    title = title.replace(exports.altTitlesRegex, ''); // remove alt language titles
    // remove non english chars if they are not the only ones left
    const notOnlyNonEnglishMatch = title.match(exports.notOnlyNonEnglishRegex);
    if (notOnlyNonEnglishMatch) {
        for (let i = 1; i < notOnlyNonEnglishMatch.length; i++) {
            if (notOnlyNonEnglishMatch[i]) {
                title = title.replace(notOnlyNonEnglishMatch[i], '');
                break;
            }
        }
    }
    title = title.replace(exports.remainingNotAllowedSymbolsAtStartAndEndRegex, '');
    if (!title.includes(' ') && title.includes('.')) {
        title = title.replace(/\./g, ' ');
    }
    for (const [open, close] of exports.brackets) {
        const openCount = (title.match(new RegExp('\\' + open, 'g')) || []).length;
        const closeCount = (title.match(new RegExp('\\' + close, 'g')) || [])
            .length;
        if (openCount !== closeCount) {
            title = title
                .replace(new RegExp('\\' + open, 'g'), '')
                .replace(new RegExp('\\' + close, 'g'), '');
        }
    }
    title = title.replace(exports.redundantSymbolsAtEnd, '');
    title = title.replace(exports.whitespacesRegex, ' ');
    return title.trim();
}
/**
 * Helper to get all regex match indices (like Go FindStringSubmatchIndex)
 */
function getMatchIndices(regex, str) {
    const match = regex.exec(str);
    if (!match)
        return [];
    const indices = [];
    indices.push(match.index, match.index + match[0].length);
    for (let i = 1; i < match.length; i++) {
        if (match[i] !== undefined) {
            const captureIndex = str.indexOf(match[i], match.index);
            indices.push(captureIndex, captureIndex + match[i].length);
        }
        else {
            indices.push(-1, -1);
        }
    }
    return indices;
}
