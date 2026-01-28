"use strict";
/**
 * Handler definitions matching handlers.go
 *
 * IMPORTANT: The order of handlers matters! They must match the exact order in handlers.go
 * to ensure 1:1 parsing behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlers = void 0;
const types_js_1 = require("./types.js");
const utils_js_1 = require("./utils.js");
const transforms_js_1 = require("./transforms.js");
const validators_js_1 = require("./validators.js");
const processors_js_1 = require("./processors.js");
/**
 * All handlers in the exact order as handlers.go
 *
 * Start porting from line 284 of handlers.go
 */
exports.handlers = [
    // Title handlers (lines 285-292 in handlers.go)
    {
        field: 'title',
        pattern: /360.Degrees.of.Vision.The.Byakugan'?s.Blind.Spot/i,
        remove: true
    },
    {
        field: 'title',
        pattern: /\b(?:INTERNAL|HFR)\b/i,
        remove: true
    },
    // PPV handlers (lines 294-300 in handlers.go)
    {
        field: 'ppv',
        pattern: /\bPPV(?:HD)?\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'ppv',
        pattern: /\b\W?Fight.?Nights?\W?\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        skipFromTitle: true
    },
    // Site handlers (lines 302-317 in handlers.go)
    {
        field: 'site',
        pattern: /^(www?[., ][\w-]+[. ][\w-]+(?:[. ][\w-]+)?)\s+-\s*/i,
        keepMatching: true,
        skipFromTitle: true,
        remove: true
    },
    {
        field: 'site',
        pattern: /^((?:www?[\.,])?[\w-]+\.[\w-]+(?:\.[\w-]+)*?)\s+-\s*/i,
        keepMatching: true
    },
    {
        field: 'site',
        pattern: /\bwww[., ][\w-]+[., ](?:rodeo|hair)\b/i,
        remove: true,
        skipFromTitle: true
    },
    // Episode Code handlers (lines 319-328 in handlers.go)
    {
        field: 'episodeCode',
        pattern: /([\[(]([a-z0-9]{8}|[A-Z0-9]{8})[\])])(?:\.[a-zA-Z0-9]{1,5}$|$)/,
        transform: (0, transforms_js_1.toUppercase)(),
        remove: true,
        matchGroup: 1,
        valueGroup: 2
    },
    {
        field: 'episodeCode',
        pattern: /\[([A-Z0-9]{8})]/,
        validateMatch: (0, validators_js_1.validateMatch)(/(?:[A-Z]+\d|\d+[A-Z])/),
        transform: (0, transforms_js_1.toUppercase)(),
        remove: true
    },
    // Resolution handlers (lines 330-378 in handlers.go)
    {
        field: 'resolution',
        pattern: /\b(?:4k|2160p|1080p|720p|480p)\b.+\b(4k|2160p|1080p|720p|480p)\b/i,
        transform: (0, transforms_js_1.toLowercase)(),
        remove: true,
        matchGroup: 1
    },
    {
        field: 'resolution',
        pattern: /\b[(\[]?4k[)\]]?\b/i,
        transform: (0, transforms_js_1.toValue)('4k'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /21600?[pi]/i,
        transform: (0, transforms_js_1.toValue)('4k'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'resolution',
        pattern: /[(\[]?3840x\d{4}[)\]]?/i,
        transform: (0, transforms_js_1.toValue)('4k'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /[(\[]?1920x\d{3,4}[)\]]?/i,
        transform: (0, transforms_js_1.toValue)('1080p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /[(\[]?1280x\d{3}[)\]]?/i,
        transform: (0, transforms_js_1.toValue)('720p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /[(\[]?\d{3,4}x(\d{3,4})[)\]]?/i,
        transform: (0, transforms_js_1.toWithSuffix)('p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /(480|720|1080)0[pi]/i,
        transform: (0, transforms_js_1.toWithSuffix)('p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /(?:BD|HD|M)(720|1080|2160)/i,
        transform: (0, transforms_js_1.toWithSuffix)('p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /(480|576|720|1080|2160)[pi]/i,
        transform: (0, transforms_js_1.toWithSuffix)('p'),
        remove: true
    },
    {
        field: 'resolution',
        pattern: /(?:^|\D)(\d{3,4})[pi]/i,
        transform: (0, transforms_js_1.toWithSuffix)('p'),
        remove: true
    },
    // Date handlers (lines 380-451 in handlers.go)
    {
        field: 'date',
        pattern: /(?:\W|^)([(\[]?((?:19[6-9]|20[012])[0-9]([. \-/\\])(?:0[1-9]|1[012])([. \-/\\])(?:0[1-9]|[12][0-9]|3[01]))[)\]]?)(?:\W|$)/,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(3, 4),
        transform: (0, transforms_js_1.toDate)('2006 01 02'),
        remove: true,
        valueGroup: 2,
        matchGroup: 1
    },
    {
        field: 'date',
        pattern: /(?:\W|^)[(\[]?((?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:0[1-9]|1[012])([. \-/\\])(?:19[6-9]|20[012])[0-9])[)\]]?(?:\W|$)/,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (0, transforms_js_1.toDate)('02 01 2006'),
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W)[(\[]?((?:0[1-9]|1[012])([. \-/\\])(?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:19[6-9]|20[012])[0-9])[)\]]?(?:\W|$)/,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (0, transforms_js_1.toDate)('01 02 2006'),
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W)[(\[]?((?:0[1-9]|1[012])([. \-/\\])(?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:[0][1-9]|[0126789][0-9]))[)\]]?(?:\W|$)/,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (0, transforms_js_1.toDate)('01 02 06'),
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W)[(\[]?((?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:0[1-9]|1[012])([. \-/\\])(?:[0][1-9]|[0126789][0-9]))[)\]]?(?:\W|$)/,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (0, transforms_js_1.toDate)('02 01 06'),
        matchGroup: 1,
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W|^)[(\[]?((?:0?[1-9]|[12][0-9]|3[01])[. ]?(?:st|nd|rd|th)?([. \-/\\])(?:feb(?:ruary)?|jan(?:uary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)([. \-/\\])(?:19[7-9]|20[012])[0-9])[)\]]?(?:\W|$)/i,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (title, m, result) => {
            (0, transforms_js_1.toCleanDate)()(title, m, result);
            (0, transforms_js_1.toCleanMonth)()(title, m, result);
            (0, transforms_js_1.toDate)('_2 Jan 2006')(title, m, result);
        },
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W|^)[(\[]?((?:0?[1-9]|[12][0-9]|3[01])[. ]?(?:st|nd|rd|th)?([. \-/\\])(?:feb(?:ruary)?|jan(?:uary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)([. \-/\\])(?:0[1-9]|[0126789][0-9]))[)\]]?(?:\W|$)/i,
        validateMatch: (0, validators_js_1.validateMatchedGroupsAreSame)(2, 3),
        transform: (title, m, result) => {
            (0, transforms_js_1.toCleanDate)()(title, m, result);
            (0, transforms_js_1.toCleanMonth)()(title, m, result);
            (0, transforms_js_1.toDate)('_2 Jan 06')(title, m, result);
        },
        remove: true
    },
    {
        field: 'date',
        pattern: /(?:\W|^)[(\[]?(20[012][0-9](?:0[1-9]|1[012])(?:0[1-9]|[12][0-9]|3[01]))[)\]]?(?:\W|$)/,
        transform: (0, transforms_js_1.toDate)('20060102'),
        remove: true
    },
    // Year handlers (lines 456-542 in handlers.go)
    {
        field: 'year',
        pattern: /[ .]?([(\[*]?((?:19\d|20[012])\d[ .]?-[ .]?(?:19\d|20[012])\d)[*)\]]?)[ .]?/,
        transform: (title, m, result) => {
            (0, transforms_js_1.toYear)()(title, m, result);
            if (!result.has('complete') &&
                typeof m.value === 'string' &&
                m.value.includes('-')) {
                result.set('complete', {
                    mIndex: m.mIndex,
                    mValue: m.mValue,
                    value: true,
                    remove: false,
                    processed: false
                });
            }
        },
        matchGroup: 1,
        valueGroup: 2,
        remove: true
    },
    {
        field: 'year',
        pattern: /[(\[*][ .]?((?:19\d|20[012])\d[ .]?-[ .]?\d{2})(?:\s?[*)\]])?/,
        transform: (title, m, result) => {
            (0, transforms_js_1.toYear)()(title, m, result);
            if (!result.has('complete') &&
                typeof m.value === 'string' &&
                m.value.includes('-')) {
                result.set('complete', {
                    mIndex: m.mIndex,
                    mValue: m.mValue,
                    value: true,
                    remove: false,
                    processed: false
                });
            }
        },
        remove: true
    },
    {
        field: 'year',
        pattern: /[(\[*]?\b(20[0-9]{2}|2100)[*\])]?/i,
        validateMatch: (0, validators_js_1.validateLookahead)('(?:\\D*\\d{4}\\b)', '', false),
        transform: (0, transforms_js_1.toYear)(),
        remove: true
    },
    {
        field: 'year',
        pattern: /(?:[(\[*]|.)((?:\d|[SE]|Cap[. ]?)?(?:19\d|20[012])\d(?:\d|kbps)?)[*)\]]?/i,
        validateMatch: (input, match) => {
            if (match[0] < 2) {
                return false;
            }
            return input.substring(match[2], match[3]).length === 4;
        },
        transform: (0, transforms_js_1.toYear)(),
        remove: true,
        matchGroup: 1
    },
    {
        field: 'year',
        pattern: /^[(\[]?((?:19\d|20[012])\d)(?:\d|kbps)?[)\]]?/,
        validateMatch: (input, match) => {
            const mValue = input.substring(match[0], match[1]);
            if (mValue.length === 4) {
                return match[0] !== 0;
            }
            return mValue.replace(/[()[\]]/g, '').length === 4;
        },
        transform: (0, transforms_js_1.toYear)(),
        remove: true
    },
    // Extended handlers (lines 544-549 in handlers.go)
    {
        field: 'extended',
        pattern: /EXTENDED/,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'extended',
        pattern: /- Extended/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    // Edition handlers (lines 551-606 in handlers.go)
    {
        field: 'edition',
        pattern: /\b\d{2,3}(?:th)?[\.\s\-\+_\/(),]Anniversary[\.\s\-\+_\/(),](?:Edition|Ed)?\b/i,
        transform: (0, transforms_js_1.toValue)('Anniversary Edition'),
        remove: true
    },
    {
        field: 'dragonBox',
        pattern: /\bDBOX\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bCC\b/,
        transform: (0, transforms_js_1.toValue)('Color Corrected'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bUltimate[\.\s\-\+_\/(),]Edition\b/i,
        transform: (0, transforms_js_1.toValue)('Ultimate Edition'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bExtended[\.\s\-\+_\/(),]Director'?s\b/i,
        transform: (0, transforms_js_1.toValue)("Director's Cut"),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\b(?:custom.?)?Extended\b/i,
        transform: (0, transforms_js_1.toValue)('Extended Edition'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bDirector'?s.?Cut\b/i,
        transform: (0, transforms_js_1.toValue)("Director's Cut"),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bCollector'?s\b/i,
        transform: (0, transforms_js_1.toValue)("Collector's Edition"),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bTheatrical\b/i,
        transform: (0, transforms_js_1.toValue)('Theatrical'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\buncut(?:.gems)?\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:.gems)/i),
        transform: (0, transforms_js_1.toValue)('Uncut'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bIMAX\b/i,
        transform: (0, transforms_js_1.toValue)('IMAX'),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'edition',
        pattern: /\b\.Diamond\.\b/i,
        transform: (0, transforms_js_1.toValue)('Diamond Edition'),
        remove: true
    },
    {
        field: 'edition',
        pattern: /\bRemaster(?:ed)?\b|\b[\[(]?REKONSTRUKCJA[\])]?\b/i,
        transform: (0, transforms_js_1.toValue)('Remastered'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'edition',
        process: (title, m, result) => {
            if (m.value === 'Remastered') {
                if (!result.has('remastered')) {
                    result.set('remastered', {
                        mIndex: m.mIndex,
                        mValue: m.mValue,
                        value: true,
                        remove: false,
                        processed: false
                    });
                }
            }
            return m;
        }
    },
    // Release Types handlers (lines 608-623 in handlers.go)
    {
        field: 'releaseTypes',
        pattern: /\b((?:OAD|OAV|ODA|ONA|OVA)\b(?:[+&]\b(?:OAD|OAV|ODA|ONA|OVA)\b)?)/i,
        transform: (0, transforms_js_1.toValueSetMultiWithTransform)((v) => {
            const values = [];
            for (const part of v.split(utils_js_1.nonAlphasRegex)) {
                if (part) {
                    values.push(part.toUpperCase());
                }
            }
            return values;
        }),
        remove: true,
        matchGroup: 1
    },
    {
        field: 'releaseTypes',
        pattern: /\b(OAD|OAV|ODA|ONA|OVA)(?:[ .-]*\d{1,3})?(?:v\d)?\b/i,
        transform: (0, transforms_js_1.toValueSetWithTransform)((v) => v.toUpperCase()),
        remove: true,
        matchGroup: 1
    },
    // Upscaled handlers (lines 625-636 in handlers.go)
    {
        field: 'upscaled',
        pattern: /\b(?:AI.?)?(Upscal(ed?|ing)|Enhanced?)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'upscaled',
        pattern: /\b(?:iris2|regrade|ups(?:uhd|fhd|hd|4k)?)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'upscaled',
        pattern: /\b\.AI\.\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    // Convert handler (lines 638-643 in handlers.go)
    {
        field: 'convert',
        pattern: /\bCONVERT\b/,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Hardcoded handler (lines 645-650 in handlers.go)
    {
        field: 'hardcoded',
        pattern: /\bHC|HARDCODED\b/,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Proper handler (lines 652-657 in handlers.go)
    {
        field: 'proper',
        pattern: /\b(?:REAL.)?PROPER\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Repack handler (lines 659-664 in handlers.go)
    {
        field: 'repack',
        pattern: /\bREPACK|RERIP\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Retail handler (lines 666-670 in handlers.go)
    {
        field: 'retail',
        pattern: /\bRetail\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    // Documentary handler (lines 672-677 in handlers.go)
    {
        field: 'documentary',
        pattern: /\bDOCU(?:menta?ry)?\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        skipFromTitle: true
    },
    // Unrated handler (lines 679-684 in handlers.go)
    {
        field: 'unrated',
        pattern: /\bunrated\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Uncensored handler (lines 686-691 in handlers.go)
    {
        field: 'uncensored',
        pattern: /\buncensored\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Commentary handler (lines 693-698 in handlers.go)
    {
        field: 'commentary',
        pattern: /\bcommentary\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Region handlers (lines 700-710 in handlers.go)
    {
        field: 'region',
        pattern: /R\dJ?\b/,
        remove: true,
        skipIfFirst: true
    },
    {
        field: 'region',
        pattern: /\b(PAL|NTSC|SECAM)\b/,
        transform: (0, transforms_js_1.toUppercase)(),
        remove: true
    },
    // Quality/Source handlers (lines 712-1054 in handlers.go)
    {
        field: 'quality',
        pattern: /\b(?:H[DQ][ .-]*)?CAM(?:H[DQ])?(?:[ .-]*Rip)?\b/i,
        transform: (0, transforms_js_1.toValue)('CAM'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:H[DQ][ .-]*)?S[ .-]+print/i,
        transform: (0, transforms_js_1.toValue)('CAM'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:HD[ .-]*)?T(?:ELE)?S(?:YNC)?(?:Rip)?\b/i,
        transform: (0, transforms_js_1.toValue)('TeleSync'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:HD[ .-]*)?T(?:ELE)?C(?:INE)?(?:Rip)?\b/,
        transform: (0, transforms_js_1.toValue)('TeleCine'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:DVD?|BD|BR|HD)?[ .-]*Scr(?:eener)?\b/i,
        transform: (0, transforms_js_1.toValue)('SCR'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bP(?:RE)?-?(HD|DVD)(?:Rip)?\b/i,
        transform: (0, transforms_js_1.toValue)('SCR'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(Blu[ .-]*Ray)\b(?:.*remux)/i,
        transform: (0, transforms_js_1.toValue)('BluRay REMUX'),
        remove: true,
        matchGroup: 1
    },
    {
        field: 'quality',
        pattern: /(?:BD|BR|UHD)[- ]?remux/i,
        transform: (0, transforms_js_1.toValue)('BluRay REMUX'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /(?:remux.*)\bBlu[ .-]*Ray\b/i,
        transform: (0, transforms_js_1.toValue)('BluRay REMUX'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bremux\b/i,
        transform: (0, transforms_js_1.toValue)('REMUX'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bBlu[ .-]*Ray\b(?:[ .-]*Rip)?/i,
        validateMatch: (input, match) => {
            return !input.substring(match[0], match[1]).toLowerCase().endsWith('rip');
        },
        transform: (0, transforms_js_1.toValue)('BluRay'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bUHD[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('UHDRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bHD[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('HDRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bMicro[ .-]*HD\b/i,
        transform: (0, transforms_js_1.toValue)('HDRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:BR|Blu[ .-]*Ray)[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('BRRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bBD[ .-]*Rip\b|\bBDR\b|\bBD-RM\b|[\[(]BD[\]) .,-]/i,
        transform: (0, transforms_js_1.toValue)('BDRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bVOD[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('VODR'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:HD[ .-]*)?DVD[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('DVDRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bVHS[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('VHSRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bDVD(?:R\d?)?\b/i,
        transform: (0, transforms_js_1.toValue)('DVD'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bVHS\b/i,
        transform: (0, transforms_js_1.toValue)('DVD'),
        remove: true,
        skipIfFirst: true
    },
    {
        field: 'quality',
        pattern: /\bPPV[ .-]*HD\b/i,
        transform: (0, transforms_js_1.toValue)('PPV'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bPPVRip\b/i,
        transform: (0, transforms_js_1.toValue)('PPVRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bHD.?TV.?Rip\b/i,
        transform: (0, transforms_js_1.toValue)('HDTVRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bDVB[ .-]*(?:Rip)?\b/i,
        transform: (0, transforms_js_1.toValue)('HDTV'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bSAT[ .-]*Rips?\b/i,
        transform: (0, transforms_js_1.toValue)('SATRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bTVRips?\b/i,
        transform: (0, transforms_js_1.toValue)('TVRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bR5\b/i,
        transform: (0, transforms_js_1.toValue)('R5'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bWEB[ .-]*Rip\b/i,
        transform: (0, transforms_js_1.toValue)('WEBRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bWEB[ .-]?Cap\b/i,
        transform: (0, transforms_js_1.toValue)('WEBCap'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bWEB[ .-]?DL[ .-]?Rip\b/i,
        transform: (0, transforms_js_1.toValue)('WEB-DLRip'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bWEB[ .-]*(DL|.BDrip|.DLRIP)\b/i,
        transform: (0, transforms_js_1.toValue)('WEB-DL'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:DL|WEB|BD|BR)MUX\b/i,
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(W(?:ORK)P(?:RINT))\b/,
        transform: (0, transforms_js_1.toValue)('WORKPRINT'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\b(?:\w.)?WEB\b|\bWEB(?:(?:[ \.\-\(\],]+\d))?\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:\w.)WEB\b|\bWEB(?:(?:[ \.\-\(\],]+\d))\b/i),
        transform: (0, transforms_js_1.toValue)('WEB'),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'quality',
        pattern: /\bPDTV\b/i,
        transform: (0, transforms_js_1.toValue)('PDTV'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bHD(?:.?TV)?\b(?!-ELITE\.NET)/i,
        transform: (0, transforms_js_1.toValue)('HDTV'),
        remove: true
    },
    {
        field: 'quality',
        pattern: /\bSD(?:.?TV)?\b/i,
        transform: (0, transforms_js_1.toValue)('SDTV'),
        remove: true
    },
    // Bit Depth handlers (lines 1056-1077 in handlers.go)
    {
        field: 'bitDepth',
        pattern: /(?:8|10|12)[-.]?bit\b/i,
        transform: (0, transforms_js_1.toLowercase)(),
        remove: true
    },
    {
        field: 'bitDepth',
        pattern: /\bhevc\s?10\b/i,
        transform: (0, transforms_js_1.toValue)('10bit')
    },
    {
        field: 'bitDepth',
        pattern: /\bhdr10(?:\+|plus)?\b/i,
        transform: (0, transforms_js_1.toValue)('10bit')
    },
    {
        field: 'bitDepth',
        pattern: /\bhi10\b/i,
        transform: (0, transforms_js_1.toValue)('10bit')
    },
    {
        field: 'bitDepth',
        process: (0, processors_js_1.removeFromValue)(/[ -]/)
    },
    // HDR handlers (lines 1079-1101 in handlers.go)
    {
        field: 'hdr',
        pattern: /\bDV\b|dolby.?vision|\bDoVi\b/i,
        transform: (0, transforms_js_1.toValueSet)('DV'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'hdr',
        pattern: /HDR10(?:\+|plus)/i,
        transform: (0, transforms_js_1.toValueSet)('HDR10+'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'hdr',
        pattern: /\bHDR(?:10)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('HDR'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'hdr',
        pattern: /\bSDR\b/i,
        transform: (0, transforms_js_1.toValueSet)('SDR'),
        remove: true,
        keepMatching: true
    },
    // 3D handlers (lines 1103-1138 in handlers.go)
    {
        field: 'threeD',
        pattern: /\b(3D)\b.*\b(Half-?SBS|H[-\\/]?SBS)\b/i,
        transform: (0, transforms_js_1.toValue)('3D HSBS')
    },
    {
        field: 'threeD',
        pattern: /\bHalf.Side.?By.?Side\b/i,
        transform: (0, transforms_js_1.toValue)('3D HSBS')
    },
    {
        field: 'threeD',
        pattern: /\b(3D)\b.*\b(Full-?SBS|SBS)\b/i,
        transform: (0, transforms_js_1.toValue)('3D SBS')
    },
    {
        field: 'threeD',
        pattern: /\bSide.?By.?Side\b/i,
        transform: (0, transforms_js_1.toValue)('3D SBS')
    },
    {
        field: 'threeD',
        pattern: /\b(3D)\b.*\b(Half-?OU|H[-\\/]?OU)\b/i,
        transform: (0, transforms_js_1.toValue)('3D HOU')
    },
    {
        field: 'threeD',
        pattern: /\bHalf.?Over.?Under\b/i,
        transform: (0, transforms_js_1.toValue)('3D HOU')
    },
    {
        field: 'threeD',
        pattern: /\b(3D)\b.*\b(OU)\b/i,
        transform: (0, transforms_js_1.toValue)('3D OU')
    },
    {
        field: 'threeD',
        pattern: /\bOver.?Under\b/i,
        transform: (0, transforms_js_1.toValue)('3D OU')
    },
    {
        field: 'threeD',
        pattern: /\b((?:BD)?3D)\b/i,
        transform: (0, transforms_js_1.toValue)('3D'),
        skipIfFirst: true
    },
    // Codec handlers (lines 1140-1167 in handlers.go)
    {
        field: 'codec',
        pattern: /\b[xh][-. ]?26[45]/i,
        transform: (0, transforms_js_1.toLowercase)(),
        remove: true
    },
    {
        field: 'codec',
        pattern: /\bhevc(?:\s?10)?\b/i,
        transform: (0, transforms_js_1.toValue)('hevc'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'codec',
        pattern: /\b(?:dvix|mpeg2|divx|xvid|avc)\b/i,
        transform: (0, transforms_js_1.toLowercase)(),
        remove: true,
        keepMatching: true
    },
    {
        field: 'codec',
        pattern: /\bvp[89]\b/i,
        transform: (0, transforms_js_1.toLowercase)(),
        remove: true,
        keepMatching: true
    },
    {
        field: 'codec',
        pattern: /\bAV1\b/i,
        transform: (0, transforms_js_1.toValue)('av1'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'codec',
        process: (0, processors_js_1.removeFromValue)(/[ .-]/)
    },
    // Channels handlers (lines 1169-1199 in handlers.go)
    {
        field: 'channels',
        pattern: /5[.\s]1(?:ch|-S\d+)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('5.1'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'channels',
        pattern: /\b(?:x[2-4]|5[\W]1(?:x[2-4])?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('5.1'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'channels',
        pattern: /\b7[.\- ]1(?:.?ch(?:annel)?)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('7.1'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'channels',
        pattern: /(?:\b|AAC|DDP)\+?(2[.\s]0)(?:x[2-4])?\b/i,
        transform: (0, transforms_js_1.toValueSet)('2.0'),
        keepMatching: true,
        remove: true,
        matchGroup: 1
    },
    {
        field: 'channels',
        pattern: /\b2\.0\b/i,
        transform: (0, transforms_js_1.toValueSet)('2.0'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'channels',
        pattern: /\bstereo\b/i,
        transform: (0, transforms_js_1.toValueSet)('stereo'),
        keepMatching: true
    },
    {
        field: 'channels',
        pattern: /\bmono\b/i,
        transform: (0, transforms_js_1.toValueSet)('mono'),
        keepMatching: true
    },
    // Audio handlers (lines 1201-1251 in handlers.go)
    {
        field: 'audio',
        pattern: /\b(?:.+HR)?(?:DTS.?HD.?Ma(?:ster)?|DTS.?X)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:.+HR)/i),
        transform: (0, transforms_js_1.toValueSet)('DTS Lossless'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'audio',
        pattern: /\bDTS(?:(?:.?HD.?Ma(?:ster)?|.X))?.?(?:HD.?HR|HD)?\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/DTS(?:.?HD.?Ma(?:ster)?|.X)/i),
        transform: (0, transforms_js_1.toValueSet)('DTS Lossy'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'audio',
        pattern: /\b(?:Dolby.?)?Atmos\b/i,
        transform: (0, transforms_js_1.toValueSet)('Atmos'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'audio',
        pattern: /\b(?:True[ .-]?HD|\.True\.)\b/i,
        transform: (0, transforms_js_1.toValueSet)('TrueHD'),
        keepMatching: true,
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'audio',
        pattern: /\bTRUE\b/,
        transform: (0, transforms_js_1.toValueSet)('TrueHD'),
        keepMatching: true,
        remove: true,
        skipFromTitle: true
    },
    // More Audio handlers (lines 1253-1521 in handlers.go)
    {
        field: 'audio',
        pattern: /\bFLAC(?:\d\.\d)?(?:x\d+)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('FLAC'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\bDD2?[+p]|DD Plus|Dolby Digital Plus|DDP5[ ._]1/i,
        transform: (0, transforms_js_1.toValueSet)('DDP'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /E-?AC-?3(?:-S\d+)?/i,
        transform: (0, transforms_js_1.toValueSet)('EAC3'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\b(DD|Dolby.?Digital|DolbyD)\b/i,
        transform: (0, transforms_js_1.toValueSet)('DD'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\b(AC-?3(?:x2)?(?:-S\d+)?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('AC3'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\bQ?AAC(?:[. ]?2[. ]0|x2)?\b/,
        transform: (0, transforms_js_1.toValueSet)('AAC'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\bL?PCM\b/i,
        transform: (0, transforms_js_1.toValueSet)('PCM'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\bOPUS(?:\b|\d)(?:.*[ ._-](?:\d{3,4}p))?/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/OPUS(?:\b|\d)(?:.*[ ._-](?:\d{3,4}p))/i),
        transform: (0, transforms_js_1.toValueSet)('OPUS'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'audio',
        pattern: /\b(?:H[DQ])?.?(?:Clean.?Aud(?:io)?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('HQ'),
        remove: true,
        keepMatching: true
    },
    {
        field: 'channels',
        pattern: /\[([257][.-][01])]/,
        transform: (0, transforms_js_1.toValueSetWithTransform)((v) => v.toLowerCase()),
        remove: true,
        keepMatching: true
    },
    // Group handler (lines 1523-1528 in handlers.go)
    {
        field: 'group',
        process: (0, processors_js_1.regexMatchUntilValid)(/- ?([^\-. \[]+[^\-. \[)\]E\d][^\-. \[)\]]*)(?:\[[\w.-]+])?/i, (0, validators_js_1.validateAnd)((0, validators_js_1.validateNotMatch)(/- ?(?:\d+$|S\d+|\d+x|ep?\d+|[^[]+]$)/i), (0, validators_js_1.validateLookahead)('(?:[ .]\\w{2,4}$|$)', 'i', true)))
    },
    // Container handler (lines 1530-1534 in handlers.go)
    {
        field: 'container',
        pattern: /\.?[\[(]?\b(MKV|AVI|MP4|WMV|MPG|MPEG)\b[\])]?/i,
        transform: (0, transforms_js_1.toLowercase)()
    },
    // Batch 6: Volumes, Languages, Complete handlers (lines 1536-1749 in handlers.go)
    // Volumes handlers (lines 1548-1591 in handlers.go)
    {
        field: 'volumes',
        pattern: /\bvol(?:s|umes?)?[. -]*(?:\d{1,3}[., +/\\&-]+)+\d{1,3}\b/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'volumes',
        process: (title, m, result) => {
            const re = /\bvol(?:ume)?[. -]*(\d{1,3})/i;
            let startIndex = 0;
            if (result.has('year')) {
                const yr = result.get('year');
                startIndex = Math.min(yr.mIndex, title.length);
            }
            const match = title.substring(startIndex).match(re);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (!isNaN(num)) {
                    m.mIndex = startIndex + match.index;
                    m.mValue = match[0];
                    m.value = [num];
                    m.remove = true;
                }
            }
            return m;
        }
    },
    // Country handler (lines 1593-1597 in handlers.go)
    {
        field: 'country',
        pattern: /\b(US|UK|AU|NZ)\b/
    },
    // Languages handlers (lines 1599-1612 in handlers.go)
    {
        field: 'languages',
        pattern: /\b(temporadas?|completa)\b/i,
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:INT[EÉ]GRALE?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:Saison)\b/i,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true
    },
    // Complete handlers (lines 1614-1725 in handlers.go)
    {
        field: 'complete',
        pattern: /\b(?:INTEGRALE?|INTÉGRALE?)\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        keepMatching: true,
        remove: true
    },
    {
        field: 'complete',
        pattern: /(?:\bthe\W)?(?:\bcomplete|collection|dvd)?\b[ .]?\bbox[ .-]?set\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'complete',
        pattern: /(?:\bthe\W)?(?:\bcomplete|collection|dvd)?\b[ .]?\bmini[ .-]?series\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'complete',
        pattern: /(?:\bthe\W)?(?:\bcomplete|full|\ball)\b.*\b(?:series|seasons|collection|episodes|set|pack|movies)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'complete',
        pattern: /\b(?:series|seasons|movies?)\b.*\b(?:complete|collection)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'complete',
        pattern: /(?:\bthe\W)?\bultimate\b[ .]\bcollection\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        keepMatching: true
    },
    {
        field: 'complete',
        pattern: /\bcollection\b.*\b(?:set|pack|movies)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'complete',
        pattern: /\bcollection(?:(\s\[|\s\())/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'complete',
        pattern: /\bkolekcja\b(?:\Wfilm(?:y|ów|ow)?)?/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'complete',
        pattern: /duology|trilogy|quadr[oi]logy|tetralogy|pentalogy|hexalogy|heptalogy|anthology/i,
        transform: (0, transforms_js_1.toBoolean)(),
        keepMatching: true
    },
    {
        field: 'complete',
        pattern: /\bcompleta\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'complete',
        pattern: /\bsaga\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'complete',
        pattern: /\b\[Complete\]\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'complete',
        pattern: /(?:A.?|The.?)?\bComplete\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:A.?|The.?)\bComplete/i),
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'complete',
        pattern: /\bCOMPLETE\b/,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    // Batch 7: Seasons handlers (lines 1727-1868 in handlers.go)
    {
        field: 'seasons',
        pattern: /(?:complete\W|seasons?\W|\W|^)((?:s\d{1,2}[., +/\\&-]+)+s\d{1,2}\b)/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:complete\W|seasons?\W|\W|^)[(\[]?(s\d{2,}-\d{2,}\b)[)\]]?/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:complete\W|seasons?\W|\W|^)[(\[]?(s[1-9]-[2-9]\b)[)\]]?/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /\d+ª(?:.+)?(?:a.?)?\d+ª(?:(?:.+)?(?:temporadas?))/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?(?:seasons?|[Сс]езони?|sezon|temporadas?|stagioni)[. ]?[-:]?[. ]?[(\[]?((?:\d{1,2} ?(?:[,/\\&]+ ?)+)+\d{1,2}\b)[)\]]?/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?(?:seasons|[Сс]езони?|sezon|temporadas?|stagioni)[. ]?[-:]?[. ]?[(\[]?((?:\d{1,2}[. -]+)+0?[1-9]\d?\b)[)\]]?/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?season[. ]?[(\[]?((?:\d{1,2}[. -]+)+0?\d{1,2}\b)[)\]]?(?:.*\.\w{2,4}$)?/i,
        validateMatch: (input, idxs) => {
            // First check: reject if match contains file extension
            if (/(?:.*\.\w{2,4}$)/i.test(input)) {
                return false;
            }
            // Second check: reject if there are 2 or more consecutive spaces in the captured season range part
            // This prevents matching "Season 2  009" (after "Complete" is removed) as a range
            const capturedRange = input.substring(idxs[2], idxs[3]);
            if (/\s{2,}/.test(capturedRange)) {
                return false;
            }
            return true;
        },
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?\bseasons?\b[. -]?(\d{1,2}[. -]?(?:to|thru|and|\+|:)[. -]?\d{1,2})\b/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /\bseason\b[ .-]?(\d{1,2}[ .-]?(?:to|thru|and|\+)[ .-]?\bseason\b[ .-]?\d{1,2})/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'seasons',
        pattern: /(\d{1,2})(?:-?й)?[. _]?(?:[Сс]езон|sez(?:on)?)(?:\P{L}?\D|$)/iu,
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?(?:saison|seizoen|sezon(?:SO?)?|stagione|season|series|temp(?:orada)?):?[. ]?(\d{1,2})/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /[Сс]езон:?[. _]?№?(\d{1,2})(?:\d)?/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\d{3}/i),
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:\D|^)(\d{1,2})Â?[°ºªa]?[. ]*temporada/i,
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /t(\d{1,3})(?:[ex]+|$)/i,
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete)?(?:\W|^)so?([01]?[0-5]?[1-9])(?:[\Wex]|\d{2}\b)/i,
        transform: (0, transforms_js_1.toIntArray)(),
        keepMatching: true
    },
    {
        field: 'seasons',
        pattern: /(?:so?|t)(\d{1,4})[. ]?[xх-]?[. ]?(?:e|x|х|ep|-|\.)[. ]?\d{1,4}(?:[abc]|v0?[1-4]|\D|$)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete\W)?(?:\W|^)(\d{1,2})[. ]?(?:st|nd|rd|th)[. ]*season/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /(?:\D|^)(\d{1,2})[Xxх]\d{1,3}(?:\D|$)/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /\bSn([1-9])(?:\D|$)/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /[\[(](\d{1,2})\.\d{1,3}[)\]]/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /-\s?(\d{1,2})\.\d{2,3}\s?-/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /^(\d{1,2})\.\d{2,3} - /,
        transform: (0, transforms_js_1.toIntArray)(),
        skipIfBefore: ['year', 'source', 'resolution']
    },
    {
        field: 'seasons',
        pattern: /(?:^|\/)(?:20-20)?(\d{1,2})-\d{2}\b(?:-\d)?/,
        validateMatch: (0, validators_js_1.validateNotMatch)(/^(?:20-20)|(\d{1,2})-\d{2}\b(?:-\d)/),
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /[^\w-](\d{1,2})-\d{2}(?:\.\w{2,4}$)/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /(?:\bEp?(?:isode)? ?\d+\b.*)?\b(\d{2})[ ._]\d{2}(?:.F)?\.\w{2,4}$/,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:\bEp?(?:isode)? ?\d+\b.*)/),
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /\bEp(?:isode)?\W+(\d{1,2})\.\d{1,3}\b/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'seasons',
        pattern: /(?:(?:\bthe\W)?\bcomplete)?(?:[a-z])?\bs(\d{1,3})(?:[\Wex]|\d{2}\b|$)/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:[a-z])\bs\d{1,3}/i),
        transform: (0, transforms_js_1.toIntArray)(),
        keepMatching: true
    },
    {
        field: 'seasons',
        pattern: /\bSeasons?\b.*\b(\d{1,2}-\d{1,2})\b/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'seasons',
        pattern: /(?:\W|^)(\d{1,2})(?:e|ep)\d{1,3}(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    /**
     * 	// ~ parser.add_handler("seasons", regex.compile(r"\bТВ-(\d{1,2})\b", regex.IGNORECASE), array(integer))
      {
          Field:     "seasons",
          Pattern:   regexp.MustCompile(`(?i)[\[\(]ТВ-(\d{1,2})[\)\]]`),
          Transform: to_int_array(),
      },
     */
    {
        field: 'seasons',
        pattern: /[\[\(]ТВ-(\d{1,2})[\)\]]/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    // Batch 8: Episodes handlers (lines 1870-2125 in handlers.go)
    {
        field: 'episodes',
        pattern: /(?:[\W\d]|^)e[ .]?[(\[]?(\d{1,3}(?:[à .-]*(?:[&+]|e){1,2}[ .]?\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:[\W\d]|^)ep[ .]?[(\[]?(\d{1,3}(?:[ .-]*(?:[&+]|ep){1,2}[ .]?\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:[\W\d]|^)\d+[xх][ .]?[(\[]?(\d{1,3}(?:[ .]?[xх][ .]?\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:[\W\d]|^)(?:episodes?|[Сс]ерии:?)[ .]?[(\[]?(\d{1,3}(?:[ .+]*[&+][ .]?\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /[(\[]?(?:\D|^)(\d{1,3}[ .]?ao[ .]?\d{1,3})[)\]]?(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:[\W\d]|^)(?:e|eps?|episodes?|[Сс]ерии:?|\d+[xх])[ .]*[(\[]?(\d{1,3}(?:-\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /\bs\d{1,2}[ .]*-[ .]*\b(\d{1,3}(?:[ .]*~[ .]*\d{1,3})+)\b/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:so?|t)\d{1,4}[. ]?[xх-]?[. ]?(?:e|x|х|ep)[. ]?(\d{1,4})(?:[abc]|v0?[1-4]|\D|$)/i,
        remove: true,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:so?|t)\d{1,2}\s?[-.]\s?(\d{1,4})(?:[abc]|v0?[1-4]|\D|$)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\b(?:so?|t)\d{2}(\d{2})\b/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:\W|^)(\d{1,3}(?:[ .]*~[ .]*\d{1,3})+)(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /-\s(\d{1,3}[ .]*-[ .]*\d{1,3})(?:-\d*)?(?:\W|$)/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/-\s(\d{1,3}[ .]*-[ .]*\d{1,3})(?:-\d*)/i),
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /s\d{1,2}\s?\((\d{1,3}[ .]*-[ .]*\d{1,3})\)/i,
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:^|\/)(?:20-20)?\d{1,2}-(\d{2})\b(?:-\d)?/,
        validateMatch: (0, validators_js_1.validateNotMatch)(/^(?:20-20)|\d{1,2}-(\d{2})\b(?:-\d)/),
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:\d-)?\b\d{1,2}-(\d{2})(?:\.\w{2,4}$)/,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:\d-)\b\d{1,2}-(\d{2})/),
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:^\[.+].+)([. ]+-[. ]*(\d{1,4})[. ]+)(?:\W)/i,
        transform: (0, transforms_js_1.toIntArray)(),
        valueGroup: 2,
        matchGroup: 1
    },
    {
        field: 'episodes',
        pattern: /(?:(?:seasons?|[Сс]езони?)\P{L}*)?(?:[ .(\[-]|^)(\d{1,3}(?:[ .]?[,&+~][ .]?\d{1,3})+)(?:[ .)\]-]|$)/iu,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:(?:seasons?|[Сс]езони?)\P{L}*)/iu),
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /(?:(?:seasons?|[Сс]езони?)\P{L}*)?(?:20-20)?(?:[ .(\[-]|^)(\d{1,4}(?:-\d{1,4})+)(?:[ .)(\]]|[+-]\D|$)/iu,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:seasons?|[Сс]езони?)\P{L}*|^(?:20-20)/iu),
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        pattern: /\bEp(?:isode)?\W+\d{1,2}\.(\d{1,3})\b/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /Ep.\d+.-.\d+/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'episodes',
        pattern: /(\d{1,3})[. ]?(?:of|из|iz)[. ]?\d{1,3}/i,
        validateMatch: (0, validators_js_1.validateAnd)((0, validators_js_1.validateLookbehind)('(?:\\D|^)', 'i', true), (0, validators_js_1.validateLookahead)('(?:\\D|$)', 'i', true)),
        transform: (0, transforms_js_1.toIntRangeTill)()
    },
    {
        field: 'episodes',
        pattern: /(?:\b[ée]p?(?:isode)?|[Ээ]пизод|[Сс]ер(?:ии|ия|\.)?|caa?p(?:itulo)?|epis[oó]dio)[. ]?[-:#№]?[. ]?(\d{1,4})(?:[abc]|v0?[1-4]|\W|$)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\b(\d{1,3})(?:-?я)?[ ._-]*(?:ser(?:i?[iyj]a|\b)|[Сс]ер(?:ии|ия|\.)?)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:\D|^)\d{1,2}[. ]?[Xxх][. ]?(\d{1,3})(?:[abc]|v0?[1-4]|\D|$)/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /[\[(]\d{1,2}\.(\d{1,3})[)\]]/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\b[Ss](?:eason\W?)?\d{1,2}[ .](\d{1,2})\b/,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /-\s?\d{1,2}\.(\d{2,3})\s?-/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /^\d{1,2}\.(\d{2,3}) - /,
        skipIfBefore: ['year', 'source', 'resolution'],
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\b\d{2}[ ._-](\d{2})(?:.F)?\.\w{2,4}$/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /(?:^)?\[(\d{2,3})](?:(?:\.\w{2,4})?$)?/i,
        validateMatch: (0, validators_js_1.validateAnd)((0, validators_js_1.validateNotAtStart)(), (0, validators_js_1.validateNotAtEnd)(), (0, validators_js_1.validateNotMatch)(/(?:720|1080)|\[(\d{2,3})](?:(?:\.\w{2,4})$)/i)),
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\bodc[. ]+(\d{1,3})\b/i,
        transform: (0, transforms_js_1.toIntArray)()
    },
    {
        field: 'episodes',
        pattern: /\b264\b|\b265\b/i,
        validateMatch: (input, match) => {
            const re = /\b[xh]\b/i;
            return !re.test(input.substring(0, match[0]));
        },
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'episodes',
        pattern: /(?:\W|^)(?:\d+)?(?:e|ep)(\d{1,3})(?:\W|$)/i,
        transform: (0, transforms_js_1.toIntArray)(),
        remove: true
    },
    {
        field: 'episodes',
        pattern: /\d+.-.\d+TV/i,
        transform: (0, transforms_js_1.toIntRange)(),
        remove: true
    },
    {
        field: 'episodes',
        pattern: /season\s*\d{1,2}\s*(\d{1,4}\s*-\s*\d{1,4})/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/season\s*\d{1,2}\s*-/i),
        transform: (0, transforms_js_1.toIntRange)()
    },
    {
        field: 'episodes',
        process: (title, m, result) => {
            if (m.value !== null && m.value !== undefined) {
                return m;
            }
            const btRe = /(?:movie\W*|film\W*|^)?(?:[ .]+-[ .]+|[(\[][ .]*)(\d{1,4})(?:a|b|v\d|\.\d)?(?:\W|$)(?:movie|film|\d+)?/i;
            const btReNegBefore = /(?:movie\W*|film\W*)(?:[ .]+-[ .]+|[(\[][ .]*)(\d{1,4})/i;
            const btReNegAfter = /(?:movie|film)|(\d{1,4})(?:a|b|v\d|\.\d)(?:\W)(?:\d+)/i;
            const mtRe = /^(?:[(\[-][ .]?)?(\d{1,4})(?:a|b|v\d)?(?:\Wmovie|\Wfilm|-\d)?(?:\W|$)/i;
            const mtReNegAfter = /(\d{1,4})(?:a|b|v\d)?(?:\Wmovie|\Wfilm|-\d)/i;
            const commonResolutionNeg = /\[(?:480|720|1080)\]/;
            const commonFPSNeg = /\d+(?:fps|帧率?)/i;
            let startIndex = 0;
            for (const component of ['year', 'seasons']) {
                if (result.has(component)) {
                    const cm = result.get(component);
                    if (cm.mIndex > 0 && (startIndex === 0 || cm.mIndex < startIndex)) {
                        startIndex = cm.mIndex;
                    }
                }
            }
            let endIndex = title.length;
            for (const component of ['resolution', 'quality', 'codec', 'audio']) {
                if (result.has(component)) {
                    const cm = result.get(component);
                    if (cm.mIndex > 0 && cm.mIndex < endIndex) {
                        endIndex = cm.mIndex;
                    }
                }
            }
            const beginningTitle = title.substring(0, endIndex);
            startIndex = Math.min(startIndex, title.length);
            const middleTitle = title.substring(startIndex, Math.max(endIndex, startIndex));
            let match = beginningTitle.match(btRe);
            let mStr = '';
            if (match && match.index !== undefined) {
                mStr = match[0];
                if (match.index === 0 ||
                    btReNegBefore.test(mStr) ||
                    btReNegAfter.test(mStr) ||
                    commonResolutionNeg.test(mStr) ||
                    commonFPSNeg.test(mStr)) {
                    match = null;
                    mStr = '';
                }
                else if (match[1]) {
                    mStr = match[1];
                }
            }
            // Check for 3-digit episode at the end of title (right before resolution/quality/codec)
            if (!mStr && endIndex > 0 && endIndex < title.length) {
                const dotEpisodeRe = /[ .](\d{3})(?:[ .]v\d)?[ .]*$/i;
                const endSection = title.substring(0, endIndex);
                const dotMatch = endSection.match(dotEpisodeRe);
                if (dotMatch && dotMatch[1]) {
                    mStr = dotMatch[1];
                }
            }
            if (!mStr) {
                match = middleTitle.match(mtRe);
                if (match && match.index !== undefined && match[1]) {
                    // Check from the start of capture group 1 (the number) to the end
                    const captureGroupIndex = match[0].indexOf(match[1]);
                    const fromCaptureGroup = middleTitle.substring(match.index + captureGroupIndex);
                    if (mtReNegAfter.test(fromCaptureGroup) ||
                        commonResolutionNeg.test(mStr)) {
                        match = null;
                        mStr = '';
                    }
                    else {
                        mStr = match[1];
                    }
                }
            }
            if (mStr) {
                mStr = mStr.replace(/\D/g, '');
                const ep = parseInt(mStr, 10);
                if (!isNaN(ep)) {
                    m.mIndex = title.indexOf(mStr);
                    m.mValue = mStr;
                    m.value = [ep];
                }
            }
            return m;
        }
    },
    // Batch 9: Subbed, Dubbed, Multi-language detection (lines 2259-2290 in handlers.go)
    {
        field: 'subbed',
        pattern: /\bSUB(?:FRENCH)\b|\b(?:DAN|E|FIN|PL|SLO|SWE)SUBS?\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'languages',
        pattern: /\bmulti(?:ple)?[ .-]*(?:su?$|sub\w*|dub\w*)\b|msub/i,
        transform: (0, transforms_js_1.toValueSet)('multi subs'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\bmulti(?:ple)?[ .-]*(?:lang(?:uages?)?|audio|VF2)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('multi audio'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\btri(?:ple)?[ .-]*(?:audio|dub\w*)\b/i,
        transform: (0, transforms_js_1.toValueSet)('multi audio'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bdual[ .-]*(?:au?$|[aá]udio|line)\b/i,
        transform: (0, transforms_js_1.toValueSet)('dual audio'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bdual\b(?:[ .-]*sub)?/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:[ .-]*sub)/i),
        transform: (0, transforms_js_1.toValueSet)('dual audio'),
        keepMatching: true
    },
    // Batch 10: Detailed language handlers, subbed/dubbed, network, size, group, extension (lines 2291-3592)
    // English language handlers
    {
        field: 'languages',
        pattern: /\bengl?(?:sub[A-Z]*)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\beng?sub[A-Z]*\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bing(?:l[eéê]s)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\besub\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\benglish\W+(?:subs?|sdh|hi)\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bEN\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\benglish?\b/i,
        transform: (0, transforms_js_1.toValueSet)('en'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Japanese language handlers
    {
        field: 'languages',
        pattern: /\b(?:JP|JAP|JPN)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ja'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /(japanese|japon[eê]s)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ja'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Korean language handlers
    {
        field: 'languages',
        pattern: /\b(?:KOR|kor[ .-]?sub)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ko'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /(korean|coreano)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ko'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Chinese language handlers
    {
        field: 'languages',
        pattern: /\b(?:traditional\W*chinese|chinese\W*traditional)(?:\Wchi)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('zh-tw'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\bzh-hant\b/i,
        transform: (0, transforms_js_1.toValueSet)('zh-tw'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:mand[ae]rin|ch[sn])\b/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /(?:shang-?)?\bCH(?:I|T)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/shang-?/i),
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /(chinese|chin[eê]s)\b/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\bzh-hans\b/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true
    },
    // French language handlers
    {
        field: 'languages',
        pattern: /\bFR(?:a|e|anc[eê]s|VF[FQIB2]?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\b(?:TRUE|SUB).?FRENCH\b|\bFRENCH\b|\bFre?\b/,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\b\[?(?:VF[FQRIB2]?\]?\b|(?:VOST)?FR2?)\b/,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\bVOST(?:FR?|A)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('fr'),
        keepMatching: true
    },
    // Spanish/Latino language handlers
    {
        field: 'languages',
        pattern: /\bspanish\W?latin|american\W*(?:spa|esp?)/i,
        transform: (0, transforms_js_1.toValueSet)('es-419'),
        keepMatching: true,
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\b(?:audio.)?lat(?:in?|ino)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('es-419'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:audio.)?(?:ESP?|spa|(?:en[ .]+)?espa[nñ]ola?|castellano)\b/i,
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bes(?:\.(?:ass|ssa|srt|sub|idx)$)/i,
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bspanish\W+subs?\b/i,
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(spanish|espanhol)\b/i,
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\bSP\b/i,
        validateMatch: (0, validators_js_1.validateAnd)((0, validators_js_1.validateLookbehind)('(?:w{3}\\.\\w+\\.)', 'i', false), (0, validators_js_1.validateOr)((0, validators_js_1.validateLookahead)('(?:[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})', 'i', true), (0, validators_js_1.validateLookbehind)('(?:(?:[ .,/\\[-]+[A-Z]{2}){2,}[ .,/-]+)', 'i', true), (0, validators_js_1.validateAnd)((0, validators_js_1.validateLookahead)('(?:[ .,/-]+[A-Z]{2}(?:[ .,/-]|$))', 'i', true), (0, validators_js_1.validateLookbehind)('(?:[ .,/\\[-]+[A-Z]{2}[ .,/-]+)', 'i', true)))),
        transform: (0, transforms_js_1.toValueSet)('es'),
        keepMatching: true,
        remove: true
    },
    // Portuguese language handlers
    {
        field: 'languages',
        pattern: /\b(?:p[rt]|en|port)[. (\\/-]*BR\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\bbr(?:a|azil|azilian)\W+(?:pt|por)\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\b(?:leg(?:endado|endas?)?|dub(?:lado)?|portugu[eèê]se?)[. -]*BR\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bleg(?:endado|endas?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bportugu[eèê]s[ea]?\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bPT[. -]*(?:PT|ENG?|sub(?:s|titles?))\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bpt(?:\.(?:ass|ssa|srt|sub|idx)$)/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bpt\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\bpor\b/i,
        transform: (0, transforms_js_1.toValueSet)('pt'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Italian language handlers
    {
        field: 'languages',
        pattern: /\bITA\b/i,
        transform: (0, transforms_js_1.toValueSet)('it'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bIT\b/i,
        validateMatch: (0, validators_js_1.validateAnd)((0, validators_js_1.validateLookbehind)('(?:w{3}\\.\\w+\\.)', 'i', false), (0, validators_js_1.validateOr)((0, validators_js_1.validateLookahead)('(?:[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})', 'i', true), (0, validators_js_1.validateLookbehind)('(?:(?:[ .,/\\[-]+[A-Z]{2}){2,}[ .,/-]+)', 'i', true))),
        transform: (0, transforms_js_1.toValueSet)('it'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bit/i,
        validateMatch: (0, validators_js_1.validateLookahead)('(?:\\.(?:ass|ssa|srt|sub|idx)$)', 'i', true),
        transform: (0, transforms_js_1.toValueSet)('it'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bitaliano?\b/i,
        transform: (0, transforms_js_1.toValueSet)('it'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Greek language handlers
    {
        field: 'languages',
        pattern: /\bgreek[ .-]*(?:audio|lang(?:uage)?|subs?(?:titles?)?)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('el'),
        keepMatching: true,
        skipIfFirst: true
    },
    // German language handlers
    {
        field: 'languages',
        pattern: /\b(?:GER|DEU)\b/i,
        transform: (0, transforms_js_1.toValueSet)('de'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bde\b/i,
        validateMatch: (0, validators_js_1.validateLookahead)('(?:[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})', 'i', true),
        transform: (0, transforms_js_1.toValueSet)('de'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bde\b/i,
        transform: (0, transforms_js_1.toValueSet)('de'),
        validateMatch: (0, validators_js_1.validateLookbehind)('(?:[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})', 'i', true),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bde\b/i,
        transform: (0, transforms_js_1.toValueSet)('de'),
        validateMatch: (0, validators_js_1.validateAnd)((0, validators_js_1.validateLookbehind)('(?:[ .,/-]+[A-Z]{2}[ .,/-]+)', 'i', true), (0, validators_js_1.validateLookahead)('(?:[ .,/-]+[A-Z]{2}[ .,/-]+)', 'i', true)),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bde(?:\.(?:ass|ssa|srt|sub|idx)$)/i,
        transform: (0, transforms_js_1.toValueSet)('de'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\b(german|alem[aã]o)\b/i,
        transform: (0, transforms_js_1.toValueSet)('de'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Russian language handlers
    {
        field: 'languages',
        pattern: /\bRUS?\b/i,
        transform: (0, transforms_js_1.toValueSet)('ru'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /(russian|russo)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ru'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Ukrainian language handlers
    {
        field: 'languages',
        pattern: /\bUKR\b/i,
        transform: (0, transforms_js_1.toValueSet)('uk'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bukrainian\b/i,
        transform: (0, transforms_js_1.toValueSet)('uk'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Indian language handlers
    {
        field: 'languages',
        pattern: /\bhin(?:di)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('hi'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?tel(?:\W*aviv)?|telugu)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:(?:w{3}\.\w+\.)tel)|(?:tel(?:\W*aviv))/i),
        transform: (0, transforms_js_1.toValueSet)('te'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bt[aâ]m(?:il)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('ta'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?MAL(?:ay)?|malayalam)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)MAL)\b/i),
        transform: (0, transforms_js_1.toValueSet)('ml'),
        keepMatching: true,
        remove: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?KAN(?:nada)?|kannada)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)KAN)\b/i),
        transform: (0, transforms_js_1.toValueSet)('kn'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?MAR(?:a(?:thi)?)?|marathi)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)MAR)\b/i),
        transform: (0, transforms_js_1.toValueSet)('mr'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?GUJ(?:arati)?|gujarati)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)GUJ)\b/i),
        transform: (0, transforms_js_1.toValueSet)('gu'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?PUN(?:jabi)?|punjabi)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)PUN)\b/i),
        transform: (0, transforms_js_1.toValueSet)('pa'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?BEN(?:.\bThe|and|of\b)?(?:gali)?|bengali)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:(?:w{3}\.\w+\.)BEN)|(?:BEN)(?:.\bThe|and|of\b)\b/i),
        transform: (0, transforms_js_1.toValueSet)('bn'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Baltic language handlers
    {
        field: 'languages',
        pattern: /\b(?:YTS\.)?LT\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:YTS\.)/i),
        transform: (0, transforms_js_1.toValueSet)('lt'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\blithuanian\b/i,
        transform: (0, transforms_js_1.toValueSet)('lt'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\blatvian\b/i,
        transform: (0, transforms_js_1.toValueSet)('lv'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\bestonian\b/i,
        transform: (0, transforms_js_1.toValueSet)('et'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Polish language handlers
    {
        field: 'languages',
        pattern: /\b(?:PLDUB|Dub(?:bing.?)?PL|Lek(?:tor.?)?PL|Film.Polski)\b/i,
        transform: (0, transforms_js_1.toValueSet)('pl'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\b(?:Napisy.PL|PLSUB(?:BED)?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('pl'),
        keepMatching: true,
        remove: true
    },
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?PL|pol)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:w{3}\.\w+\.)/i),
        transform: (0, transforms_js_1.toValueSet)('pl'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(polish|polon[eê]s|polaco)\b/i,
        transform: (0, transforms_js_1.toValueSet)('pl'),
        keepMatching: true,
        skipIfFirst: true
    },
    // Czech/Slovak language handlers
    {
        field: 'languages',
        pattern: /\bCZ[EH]?\b/i,
        transform: (0, transforms_js_1.toValueSet)('cs'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\bczech\b/i,
        transform: (0, transforms_js_1.toValueSet)('cs'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\bslo(?:vak|vakian|subs|[\]_)]?\.\w{2,4}$)\b/i,
        transform: (0, transforms_js_1.toValueSet)('sk'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Hungarian language handlers
    {
        field: 'languages',
        pattern: /\bHU\b/i,
        transform: (0, transforms_js_1.toValueSet)('hu'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bHUN(?:garian)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('hu'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Romanian language handlers
    {
        field: 'languages',
        pattern: /\bROM(?:anian)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('ro'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bRO(?:[ .,/-]*(?:[A-Z]{2}[ .,/-]+)*sub)/i,
        transform: (0, transforms_js_1.toValueSet)('ro'),
        keepMatching: true
    },
    // Bulgarian language handlers
    {
        field: 'languages',
        pattern: /\bbul(?:garian)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('bg'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Serbian/Croatian/Slovenian language handlers
    {
        field: 'languages',
        pattern: /\b(?:srp|serbian)\b/i,
        transform: (0, transforms_js_1.toValueSet)('sr'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(?:HRV|croatian)\b/i,
        transform: (0, transforms_js_1.toValueSet)('hr'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bHR(?:[ .,/-]*(?:[A-Z]{2}[ .,/-]+)*sub\w*)\b/i,
        transform: (0, transforms_js_1.toValueSet)('hr'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bslovenian\b/i,
        transform: (0, transforms_js_1.toValueSet)('sl'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Dutch language handlers
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?NL|dut|holand[eê]s)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:w{3}\.\w+\.)NL/i),
        transform: (0, transforms_js_1.toValueSet)('nl'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bdutch\b/i,
        transform: (0, transforms_js_1.toValueSet)('nl'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bflemish\b/i,
        transform: (0, transforms_js_1.toValueSet)('nl'),
        keepMatching: true
    },
    // Danish language handlers
    {
        field: 'languages',
        pattern: /\b(?:DK|danska|dansub|nordic)\b/i,
        transform: (0, transforms_js_1.toValueSet)('da'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(danish|dinamarqu[eê]s)\b/i,
        transform: (0, transforms_js_1.toValueSet)('da'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bdan\b(?:.*\.(?:srt|vtt|ssa|ass|sub|idx)$)/i,
        transform: (0, transforms_js_1.toValueSet)('da'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Finnish language handlers
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.|Sci-)?FI|finsk|finsub|nordic)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:w{3}\.\w+\.|Sci-)FI/i),
        transform: (0, transforms_js_1.toValueSet)('fi'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\bfinnish\b/i,
        transform: (0, transforms_js_1.toValueSet)('fi'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Swedish language handlers
    {
        field: 'languages',
        pattern: /\b(?:(?:w{3}\.\w+\.)?SE|swe|swesubs?|sv(?:ensk)?|nordic)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/(?:w{3}\.\w+\.)SE/i),
        transform: (0, transforms_js_1.toValueSet)('sv'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(swedish|sueco)\b/i,
        transform: (0, transforms_js_1.toValueSet)('sv'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Norwegian language handlers
    {
        field: 'languages',
        pattern: /\b(?:NOR|norsk|norsub|nordic)\b/i,
        transform: (0, transforms_js_1.toValueSet)('no'),
        keepMatching: true
    },
    {
        field: 'languages',
        pattern: /\b(norwegian|noruegu[eê]s|bokm[aå]l|nob|nor(?:[\]_)]?\.\w{2,4}$))\b/i,
        transform: (0, transforms_js_1.toValueSet)('no'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Arabic language handlers
    {
        field: 'languages',
        pattern: /\b(?:arabic|[aá]rabe|ara)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ar'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\barab.*(?:audio|lang(?:uage)?|sub(?:s|titles?)?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ar'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\bar(?:\.(?:ass|ssa|srt|sub|idx)$)/i,
        transform: (0, transforms_js_1.toValueSet)('ar'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Turkish language handlers
    {
        field: 'languages',
        pattern: /\b(?:turkish|tur(?:co)?)\b/i,
        transform: (0, transforms_js_1.toValueSet)('tr'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /\b(TİVİBU|tivibu|bitturk(?:\.net)?|turktorrent)\b/i,
        transform: (0, transforms_js_1.toValueSet)('tr'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Vietnamese language handlers
    {
        field: 'languages',
        pattern: /\bvietnamese\b|\bvie(?:[\]_)]?\.\w{2,4}$)/i,
        transform: (0, transforms_js_1.toValueSet)('vi'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Indonesian language handlers
    {
        field: 'languages',
        pattern: /\bind(?:onesian)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('id'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Thai language handlers
    {
        field: 'languages',
        pattern: /\b(thai|tailand[eê]s)\b/i,
        transform: (0, transforms_js_1.toValueSet)('th'),
        keepMatching: true,
        skipIfFirst: true
    },
    {
        field: 'languages',
        pattern: /\b(THA|tha)\b/,
        transform: (0, transforms_js_1.toValueSet)('th'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Malay language handlers
    {
        field: 'languages',
        pattern: /\b(?:malay|may(?:[\]_)]?\.\w{2,4}$)|(?:subs?\([a-z,]+)may)\b/i,
        transform: (0, transforms_js_1.toValueSet)('ms'),
        keepMatching: true
    },
    // Hebrew language handlers
    {
        field: 'languages',
        pattern: /\bheb(?:rew|raico)?\b/i,
        transform: (0, transforms_js_1.toValueSet)('he'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Persian language handlers
    {
        field: 'languages',
        pattern: /\b(persian|persa)\b/i,
        transform: (0, transforms_js_1.toValueSet)('fa'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Unicode script detection for languages
    {
        field: 'languages',
        pattern: /[\u3040-\u30ff]+/i,
        transform: (0, transforms_js_1.toValueSet)('ja'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u3400-\u4dbf]+/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u4e00-\u9fff]+/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\uf900-\ufaff]+/i,
        transform: (0, transforms_js_1.toValueSet)('zh'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\uff66-\uff9f]+/i,
        transform: (0, transforms_js_1.toValueSet)('ja'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0400-\u04ff]+/i,
        transform: (0, transforms_js_1.toValueSet)('ru'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0600-\u06ff]+/i,
        transform: (0, transforms_js_1.toValueSet)('ar'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0750-\u077f]+/i,
        transform: (0, transforms_js_1.toValueSet)('ar'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0c80-\u0cff]+/i,
        transform: (0, transforms_js_1.toValueSet)('kn'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0d00-\u0d7f]+/i,
        transform: (0, transforms_js_1.toValueSet)('ml'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0e00-\u0e7f]+/i,
        transform: (0, transforms_js_1.toValueSet)('th'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0900-\u097f]+/i,
        transform: (0, transforms_js_1.toValueSet)('hi'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0980-\u09ff]+/i,
        transform: (0, transforms_js_1.toValueSet)('bn'),
        keepMatching: true,
        skipFromTitle: true
    },
    {
        field: 'languages',
        pattern: /[\u0a00-\u0a7f]+/i,
        transform: (0, transforms_js_1.toValueSet)('gu'),
        keepMatching: true,
        skipFromTitle: true
    },
    // Portuguese/Spanish episode detection
    {
        field: 'languages',
        process: (title, m, result) => {
            const ere = /capitulo|ao/i;
            const tre = /dublado/i;
            m.mIndex = 0;
            m.mValue = '';
            const vs = m.value;
            if (vs && vs.exists && (vs.exists('pt') || vs.exists('es'))) {
                return m;
            }
            const em = result.get('episodes');
            if ((em && em.mValue && ere.test(em.mValue)) || tre.test(title)) {
                if (!vs || !vs.append) {
                    const newVs = new types_js_1.ValueSet();
                    m.value = newVs.append('pt');
                }
                else {
                    m.value = vs.append('pt');
                }
            }
            return m;
        }
    },
    // Subbed handlers
    {
        field: 'subbed',
        pattern: /\b(?:Official.*?|Dual-?)?sub(?:s|bed)?\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true,
        skipIfFirst: true
    },
    {
        field: 'subbed',
        process: (title, m, result) => {
            const lm = result.get('languages');
            if (!lm) {
                return m;
            }
            const s = lm.value;
            if (s && s.exists && s.exists('multi subs')) {
                m.value = true;
            }
            return m;
        }
    },
    // Dubbed handlers
    {
        field: 'dubbed',
        pattern: /\b(?:fan\s?dub)\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'dubbed',
        pattern: /\bMULTi\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'dubbed',
        pattern: /\b(?:Fan.*)?(?:DUBBED|dublado|dubbing|DUBS?)\b/i,
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'dubbed',
        pattern: /\b(?:.*\bsub(?:s|bed)?\b)?(?:[ _\-\[(\.])?(dual|multi)(?:[ _\-\[(\.])?(?:audio)\b/i,
        validateMatch: (0, validators_js_1.validateNotMatch)(/\b(?:.*\bsub(s|bed)?\b)/i),
        transform: (0, transforms_js_1.toBoolean)(),
        remove: true
    },
    {
        field: 'dubbed',
        pattern: /\b(?:DUBBED|dublado|dubbing|DUBS?)\b/i,
        transform: (0, transforms_js_1.toBoolean)()
    },
    {
        field: 'dubbed',
        process: (title, m, result) => {
            const lm = result.get('languages');
            if (!lm) {
                return m;
            }
            const s = lm.value;
            if (s &&
                s.exists &&
                (s.exists('multi audio') || s.exists('dual audio'))) {
                m.value = true;
            }
            return m;
        }
    },
    // Size handler
    {
        field: 'size',
        pattern: /\b(\d+(\.\d+)?\s?(MB|GB|TB))\b/i,
        remove: true
    },
    // Site handlers
    {
        field: 'site',
        pattern: /\[eztv\]/i,
        transform: (0, transforms_js_1.toValue)('eztv.re'),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'site',
        pattern: /\beztv\b/i,
        transform: (0, transforms_js_1.toValue)('eztv.re'),
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'site',
        pattern: /(\[([^\[\].]+\.[^\].]+)\])(?:\.\w{2,4}$|\s)/i,
        transform: (0, transforms_js_1.toTrimmed)(),
        remove: true,
        matchGroup: 1,
        valueGroup: 2
    },
    {
        field: 'site',
        pattern: /[\[{(](www.\w*.\w+)[)}\]]/i,
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'site',
        pattern: /[[(【].*?((?:www?.?)?(?:\w+-)?\w+(?:[.\s](?:com|org|net|ms|tv|mx|co|party|vip|nu|pics))\b).*?[\])】]/i,
        matchGroup: 0,
        remove: true,
        skipFromTitle: true
    },
    {
        field: 'site',
        pattern: /-(www\.[\w-]+\.[\w-]+(?:\.[\w-]+)*)\.(\w{2,4})$/i,
        transform: (0, transforms_js_1.toTrimmed)(),
        remove: true,
        skipFromTitle: true,
        matchGroup: 1
    },
    {
        field: 'site',
        pattern: /\[([^\[\].]+\.[^\].]+)\](?:\.\w{2,4})?(?:$|\s)/i,
        transform: (0, transforms_js_1.toTrimmed)(),
        remove: true,
        skipFromTitle: true,
        matchGroup: 1
    },
    {
        field: 'site',
        pattern: /[\[{(](www\.[\w-]+\.[\w-]+(?:\.[\w-]+)*)[)}\]]/i,
        transform: (0, transforms_js_1.toTrimmed)(),
        remove: true,
        skipFromTitle: true,
        matchGroup: 1
    },
    // Network handlers
    {
        field: 'network',
        pattern: /\bATVP?\b/i,
        transform: (0, transforms_js_1.toValue)('Apple TV'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bAMZN\b/i,
        transform: (0, transforms_js_1.toValue)('Amazon'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bNF|Netflix\b/i,
        transform: (0, transforms_js_1.toValue)('Netflix'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bNICK(?:elodeon)?\b/i,
        transform: (0, transforms_js_1.toValue)('Nickelodeon'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bDSNY?P?\b/i,
        transform: (0, transforms_js_1.toValue)('Disney'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bH(MAX|BO)\b/i,
        transform: (0, transforms_js_1.toValue)('HBO'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bSHOWTIME\b/i,
        transform: (0, transforms_js_1.toValue)('Showtime'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bitunes\b/i,
        transform: (0, transforms_js_1.toValue)('iTunes'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\biT\b/,
        transform: (0, transforms_js_1.toValue)('iTunes'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bHULU\b/i,
        transform: (0, transforms_js_1.toValue)('Hulu'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bCBS\b/i,
        transform: (0, transforms_js_1.toValue)('CBS'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bNBC\b/i,
        transform: (0, transforms_js_1.toValue)('NBC'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bAMC\b/i,
        transform: (0, transforms_js_1.toValue)('AMC'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bPBS\b/i,
        transform: (0, transforms_js_1.toValue)('PBS'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\b(Crunchyroll|CR)\b/i,
        transform: (0, transforms_js_1.toValue)('Crunchyroll'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bVICE\b/,
        transform: (0, transforms_js_1.toValue)('VICE'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bSony\b/i,
        transform: (0, transforms_js_1.toValue)('Sony'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bHallmark\b/i,
        transform: (0, transforms_js_1.toValue)('Hallmark'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bAdult.?Swim\b/i,
        transform: (0, transforms_js_1.toValue)('Adult Swim'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bAnimal.?Planet|ANPL\b/i,
        transform: (0, transforms_js_1.toValue)('Animal Planet'),
        remove: true
    },
    {
        field: 'network',
        pattern: /\bCartoon.?Network(?:.TOONAMI.BROADCAST)?\b/i,
        transform: (0, transforms_js_1.toValue)('Cartoon Network'),
        remove: true
    },
    // Group handlers (final)
    {
        field: 'group',
        pattern: /\b(INFLATE|DEFLATE)\b/,
        remove: true
    },
    {
        field: 'group',
        pattern: /\b(?:Erai-raws|Erai-raws\.com)\b/i,
        transform: (0, transforms_js_1.toValue)('Erai-raws'),
        remove: true
    },
    {
        field: 'group',
        pattern: /^\[([^\[\]]+)]/
    },
    {
        field: 'group',
        pattern: /\(([\w-]+)\)(?:$|\.\w{2,4}$)/
    },
    {
        field: 'group',
        process: (title, m, result) => {
            const re = /^\[.+]$/;
            if (m.mValue && re.test(m.mValue)) {
                const endIndex = m.mIndex + m.mValue.length;
                // remove anime group match if some other parameter is contained in it, since it's a false positive.
                for (const [key, km] of result.entries()) {
                    if (km.mIndex > 0 && km.mIndex < endIndex) {
                        m.value = null;
                        return m;
                    }
                }
            }
            m.mIndex = 0;
            m.mValue = '';
            return m;
        }
    },
    // Extension handler
    {
        field: 'extension',
        pattern: /\.(3g2|3gp|avi|flv|mkv|mk3d|mov|mp2|mp4|m4v|mpe|mpeg|mpg|mpv|webm|wmv|ogm|divx|ts|m2ts|iso|vob|sub|idx|ttxt|txt|smi|srt|ssa|ass|vtt|nfo|html)$/i,
        transform: (0, transforms_js_1.toLowercase)()
    },
    // Final MP3 audio handler
    {
        field: 'audio',
        pattern: /\bMP3\b/i,
        transform: (0, transforms_js_1.toValueSet)('MP3'),
        remove: true,
        keepMatching: true
    }
];
