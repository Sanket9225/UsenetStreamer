"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Date Detection Tests', () => {
    describe('Valid Dates', () => {
        test('Stephen Colbert 2019 10 25', () => {
            const result = (0, index_1.parseTorrentTitle)('Stephen Colbert 2019 10 25 Eddie Murphy 480p x264-mSD [eztv]');
            expect(result.date).toBe('2019-10-25');
        });
        test('Stephen Colbert 25/10/2019', () => {
            const result = (0, index_1.parseTorrentTitle)('Stephen Colbert 25/10/2019 Eddie Murphy 480p x264-mSD [eztv]');
            expect(result.date).toBe('2019-10-25');
        });
        test('Jimmy Fallon 2020.02.14', () => {
            const result = (0, index_1.parseTorrentTitle)('Jimmy.Fallon.2020.02.14.Steve.Buscemi.WEB.x264-XLF[TGx]');
            expect(result.date).toBe('2020-02-14');
        });
        test('The Young And The Restless 2016-08-12', () => {
            const result = (0, index_1.parseTorrentTitle)('The Young And The Restless - S43 E10986 - 2016-08-12');
            expect(result.date).toBe('2016-08-12');
        });
        test('Indias Best Dramebaaz (13 Feb 2016)', () => {
            const result = (0, index_1.parseTorrentTitle)('Indias Best Dramebaaz 2 Ep 19 (13 Feb 2016) HDTV x264-AquoTube');
            expect(result.date).toBe('2016-02-13');
        });
        test('07 2015 YR/YR 07-06-15', () => {
            const result = (0, index_1.parseTorrentTitle)('07 2015 YR/YR 07-06-15.mp4');
            expect(result.date).toBe('2015-07-06');
        });
        test('SIX 16-Feb-2017', () => {
            const result = (0, index_1.parseTorrentTitle)('SIX.S01E05.400p.229mb.hdtv.x264-][ Collateral ][ 16-Feb-2017 mp4');
            expect(result.date).toBe('2017-02-16');
        });
        test('SIX 16-Feb-17', () => {
            const result = (0, index_1.parseTorrentTitle)('SIX.S01E05.400p.229mb.hdtv.x264-][ Collateral ][ 16-Feb-17 mp4');
            expect(result.date).toBe('2017-02-16');
        });
        test('WWE Smackdown 11/21/17', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Smackdown - 11/21/17 - 21st November 2017 - Full Show');
            expect(result.date).toBe('2017-11-21');
        });
        test('WWE RAW 9th Dec 2019', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE RAW 9th Dec 2019 WEBRip h264-TJ [TJET]');
            expect(result.date).toBe('2019-12-09');
        });
        test('WWE RAW 1st Dec 2019', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE RAW 1st Dec 2019 WEBRip h264-TJ [TJET]');
            expect(result.date).toBe('2019-12-01');
        });
        test('WWE RAW 2nd Dec 2019', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE RAW 2nd Dec 2019 WEBRip h264-TJ [TJET]');
            expect(result.date).toBe('2019-12-02');
        });
        test('WWE RAW 3rd Dec 2019', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE RAW 3rd Dec 2019 WEBRip h264-TJ [TJET]');
            expect(result.date).toBe('2019-12-03');
        });
        test('EastEnders_20200116_19302000', () => {
            const result = (0, index_1.parseTorrentTitle)('EastEnders_20200116_19302000.mp4');
            expect(result.date).toBe('2020-01-16');
        });
        test('AEW DARK 4th December 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('AEW DARK 4th December 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-12-04');
        });
        test('AEW DARK 4th November 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('AEW DARK 4th November 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-11-04');
        });
        test('AEW DARK 4th October 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('AEW DARK 4th October 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-10-04');
        });
        test('WWE NXT 30th Sept 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE NXT 30th Sept 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-09-30');
        });
        test('AEW DARK 4th September 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('AEW DARK 4th September 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-09-04');
        });
        test('WWE Main Event 6th August 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 6th August 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-08-06');
        });
        test('WWE Main Event 4th July 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 4th July 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-07-04');
        });
        test('WWE Main Event 4th June 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 4th June 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-06-04');
        });
        test('WWE Main Event 4th May 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 4th May 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-05-04');
        });
        test('WWE Main Event 4th April 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 4th April 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-04-04');
        });
        test('WWE Main Event 3rd March 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 3rd March 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-03-03');
        });
        test('WWE Main Event 2nd February 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 2nd February 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-02-02');
        });
        test('WWE Main Event 1st January 2020', () => {
            const result = (0, index_1.parseTorrentTitle)('WWE Main Event 1st January 2020 WEBRip h264-TJ');
            expect(result.date).toBe('2020-01-01');
        });
        test('wwf.raw.is.war.18.09.00', () => {
            const result = (0, index_1.parseTorrentTitle)('wwf.raw.is.war.18.09.00.avi');
            expect(result.date).toBe('2000-09-18');
        });
        test('The Colbert Report 10-30-2010', () => {
            const result = (0, index_1.parseTorrentTitle)('The Colbert Report - 10-30-2010 - Rally to Restore Sanity and or Fear.avi');
            expect(result.date).toBe('2010-10-30');
        });
    });
    describe('Should Not Detect Date', () => {
        test('not detect date from series title', () => {
            const result = (0, index_1.parseTorrentTitle)('11 22 63 - Temporada 1 [HDTV][Cap.103][Español Castellano]');
            expect(result.date).toBeUndefined();
        });
        test('not detect date from movie title', () => {
            const result = (0, index_1.parseTorrentTitle)('September 30 1955 1977 1080p BluRay');
            expect(result.date).toBeUndefined();
        });
        test('not detect date from movie title v2', () => {
            const result = (0, index_1.parseTorrentTitle)('11-11-11.2011.1080p.BluRay.x264.DTS-FGT');
            expect(result.date).toBeUndefined();
        });
    });
});
