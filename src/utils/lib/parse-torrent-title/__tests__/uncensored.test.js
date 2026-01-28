"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - uncensored', () => {
    test('Identity.Thief.2013.Vostfr.UNRATED.BluRay.720p.DTS.x264-Nenuko', () => {
        const result = (0, index_1.parseTorrentTitle)('Identity.Thief.2013.Vostfr.UNRATED.BluRay.720p.DTS.x264-Nenuko');
        expect(result.uncensored).toBeUndefined();
    });
    test('Charlie.les.filles.lui.disent.merci.2007.UNCENSORED.TRUEFRENCH.DVDRiP.AC3.Libe', () => {
        const result = (0, index_1.parseTorrentTitle)('Charlie.les.filles.lui.disent.merci.2007.UNCENSORED.TRUEFRENCH.DVDRiP.AC3.Libe');
        expect(result.uncensored).toBe(true);
    });
    test('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.uncensored).toBeUndefined();
    });
});
