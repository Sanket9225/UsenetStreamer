"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Remastered Detection Tests', () => {
    test('remastered', () => {
        const result = (0, index_1.parseTorrentTitle)('The Fifth Element 1997 REMASTERED MULTi 1080p BluRay HDLight AC3 x264 Zone80');
        expect(result.remastered).toBe(true);
    });
    test("remaster (without 'ed')", () => {
        const result = (0, index_1.parseTorrentTitle)('Predator 1987 REMASTER MULTi 1080p BluRay x264 FiDELiO');
        expect(result.remastered).toBe(true);
    });
    test('polish rekonstrukcija', () => {
        const result = (0, index_1.parseTorrentTitle)('Gra 1968 [REKONSTRUKCJA] [1080p.WEB-DL.H264.AC3-FT] [Napisy PL] [Film Polski]');
        expect(result.remastered).toBe(true);
    });
    test('not remastered', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.remastered).toBeUndefined();
    });
});
