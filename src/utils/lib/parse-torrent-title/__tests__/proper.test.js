"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Proper Detection Tests', () => {
    test('release is proper', () => {
        const result = (0, index_1.parseTorrentTitle)('Into the Badlands S02E07 PROPER 720p HDTV x264-W4F');
        expect(result.proper).toBe(true);
    });
    test('release is real proper', () => {
        const result = (0, index_1.parseTorrentTitle)('Bossi-Reality-REAL PROPER-CDM-FLAC-1999-MAHOU');
        expect(result.proper).toBe(true);
    });
    test('not proper', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.proper).toBeUndefined();
    });
});
