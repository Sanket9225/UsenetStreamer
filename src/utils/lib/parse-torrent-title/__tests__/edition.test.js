"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Edition Detection Tests', () => {
    test('Extended Edition', () => {
        const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
        expect(result.edition).toBe('Extended Edition');
    });
    test('Anniversary Edition', () => {
        const result = (0, index_1.parseTorrentTitle)('Mary.Poppins.1964.50th.ANNIVERSARY.EDITION.REMUX.1080p.Bluray.AVC.DTS-HD.MA.5.1-LEGi0N');
        expect(result.edition).toBe('Anniversary Edition');
    });
    test('Extended Edition LOTR', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.EXTENDED.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-BOREDOR');
        expect(result.edition).toBe('Extended Edition');
    });
    test('Extended Editions Trilogy', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Lord.of.the.Rings.The.Motion.Picture.Trilogy.Extended.Editions.2001-2003.1080p.BluRay.x264.DTS-WiKi');
        expect(result.edition).toBe('Extended Edition');
    });
    test('No edition for CONVERT', () => {
        const result = (0, index_1.parseTorrentTitle)('Better.Call.Saul.S03E04.CONVERT.720p.WEB.h264-TBS');
        expect(result.edition).toBeUndefined();
    });
    test('Remastered Fifth Element', () => {
        const result = (0, index_1.parseTorrentTitle)('The Fifth Element 1997 REMASTERED MULTi 1080p BluRay HDLight AC3 x264 Zone80');
        expect(result.edition).toBe('Remastered');
    });
    test('Remaster Predator', () => {
        const result = (0, index_1.parseTorrentTitle)('Predator 1987 REMASTER MULTi 1080p BluRay x264 FiDELiO');
        expect(result.edition).toBe('Remastered');
    });
    test('No edition for Uncut Gems', () => {
        const result = (0, index_1.parseTorrentTitle)('Uncut.Gems.2019.1080p.NF.WEB-DL.DDP5.1.x264-NTG');
        expect(result.edition).toBeUndefined();
    });
    test("Director's Cut", () => {
        const result = (0, index_1.parseTorrentTitle)('Basic.Instinct.1992.Unrated.Directors.Cut.Bluray.1080p.DTS-HD-HR-6.1.x264-Grym@BTNET');
        expect(result.edition).toBe("Director's Cut");
    });
});
