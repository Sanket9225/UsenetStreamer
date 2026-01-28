"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Convert Detection Tests', () => {
    test('is convert', () => {
        const result = (0, index_1.parseTorrentTitle)('Better.Call.Saul.S03E04.CONVERT.720p.WEB.h264-TBS');
        expect(result.convert).toBe(true);
    });
    test('not convert', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.convert).toBeUndefined();
    });
});
