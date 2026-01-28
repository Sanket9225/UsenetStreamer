"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Repack Detection Tests', () => {
    test('release is repack', () => {
        const result = (0, index_1.parseTorrentTitle)('Silicon Valley S04E03 REPACK HDTV x264-SVA');
        expect(result.repack).toBe(true);
    });
    test('release is rerip', () => {
        const result = (0, index_1.parseTorrentTitle)('Expedition Unknown S03E14 Corsicas Nazi Treasure RERIP 720p HDTV x264-W4F');
        expect(result.repack).toBe(true);
    });
    test('not repack', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.repack).toBeUndefined();
    });
});
