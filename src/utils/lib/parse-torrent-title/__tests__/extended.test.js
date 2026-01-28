"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Extended Detection Tests', () => {
    test('is extended', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.extended).toBe(true);
    });
    test('extended in the title when separated', () => {
        const result = (0, index_1.parseTorrentTitle)('Ghostbusters - Extended (2016) 1080p H265 BluRay Rip ita eng AC3 5.1');
        expect(result.extended).toBe(true);
    });
    test('not extended', () => {
        const result = (0, index_1.parseTorrentTitle)('Better.Call.Saul.S03E04.CONVERT.720p.WEB.h264-TBS');
        expect(result.extended).toBeUndefined();
    });
});
