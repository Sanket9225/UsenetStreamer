"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - year', () => {
    test('year', () => {
        const result = (0, index_1.parseTorrentTitle)('Dawn.of.the.Planet.of.the.Apes.2014.HDRip.XViD-EVO');
        expect(result.year).toBe('2014');
    });
    test('year within braces', () => {
        const result = (0, index_1.parseTorrentTitle)('Hercules (2014) 1080p BrRip H264 - YIFY');
        expect(result.year).toBe('2014');
    });
    test('year within brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('One Shot [2014] DVDRip XViD-ViCKY');
        expect(result.year).toBe('2014');
    });
    test('year but not the title if the title is a year', () => {
        const result = (0, index_1.parseTorrentTitle)('2012 2009 1080p BluRay x264 REPACK-METiS');
        expect(result.year).toBe('2009');
    });
    test('year at the beginning if there is none', () => {
        const result = (0, index_1.parseTorrentTitle)("2008 The Incredible Hulk Feature Film.mp4'");
        expect(result.year).toBe('2008');
    });
    test('year range', () => {
        const result = (0, index_1.parseTorrentTitle)("Harry Potter All Movies Collection 2001-2011 720p Dual KartiKing'");
        expect(result.year).toBe('2001-2011');
    });
    test('year range with simplified end year', () => {
        const result = (0, index_1.parseTorrentTitle)('Empty Nest Season 1 (1988 - 89) fiveofseven');
        expect(result.year).toBe('1988-1989');
    });
    test('not detect year from bitrate', () => {
        const result = (0, index_1.parseTorrentTitle)('04. Practice Two (1324mb 1916x1080 50fps 1970kbps x265 deef).mkv');
        expect(result.year).toBeUndefined();
    });
    test('not detect year spanish episode', () => {
        const result = (0, index_1.parseTorrentTitle)('Anatomia De Grey - Temporada 19 [HDTV][Cap.1905][Castellano][www.AtomoHD.nu].avi');
        expect(result.year).toBeUndefined();
    });
    test('2008 The Incredible Hulk Feature Film.mp4', () => {
        const result = (0, index_1.parseTorrentTitle)('2008 The Incredible Hulk Feature Film.mp4');
        expect(result.year).toBe('2008');
    });
    test('Harry Potter All Movies Collection 2001-2011 720p Dual KartiKing', () => {
        const result = (0, index_1.parseTorrentTitle)('Harry Potter All Movies Collection 2001-2011 720p Dual KartiKing');
        expect(result.year).toBe('2001-2011');
    });
    test('Wonder Woman 1984 (2020) [UHDRemux 2160p DoVi P8 Es-DTSHD AC3 En-AC3].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Wonder Woman 1984 (2020) [UHDRemux 2160p DoVi P8 Es-DTSHD AC3 En-AC3].mkv');
        expect(result.year).toBe('2020');
    });
    test('1923 S02E01 The Killing Season 1080p AMZN WEB-DL DDP5 1 H 264-FLUX[TGx]', () => {
        const result = (0, index_1.parseTorrentTitle)('1923 S02E01 The Killing Season 1080p AMZN WEB-DL DDP5 1 H 264-FLUX[TGx]');
        expect(result.year).toBeUndefined();
    });
    test('1883 - Season 1 (S01) (A Yellowstone Origin Story) [2160p NVEnc 10Bit HVEC][DDP 5.1Ch][WEBRip][English Subs]', () => {
        const result = (0, index_1.parseTorrentTitle)('1883 - Season 1 (S01) (A Yellowstone Origin Story) [2160p NVEnc 10Bit HVEC][DDP 5.1Ch][WEBRip][English Subs]');
        expect(result.year).toBeUndefined();
    });
    test('1883.S01E01.1883.2160p.WEB-DL.DDP5.1.H.265-NTb.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('1883.S01E01.1883.2160p.WEB-DL.DDP5.1.H.265-NTb.mkv');
        expect(result.year).toBeUndefined();
    });
});
