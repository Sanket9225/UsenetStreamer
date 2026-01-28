"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('HDR Detection Tests', () => {
    test('HDR', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Mandalorian.S01E06.4K.HDR.2160p 4.42GB');
        expect(result.hdr).toEqual(['HDR']);
    });
    test('HDR10', () => {
        const result = (0, index_1.parseTorrentTitle)('Spider-Man - Complete Movie Collection (2002-2022) 1080p.HEVC.HDR10.1920x800.x265. DTS-HD');
        expect(result.hdr).toEqual(['HDR']);
    });
    test('HDR10Plus', () => {
        const result = (0, index_1.parseTorrentTitle)('Bullet.Train.2022.2160p.AMZN.WEB-DL.x265.10bit.HDR10Plus.DDP5.1-SMURF');
        expect(result.hdr).toEqual(['HDR10+']);
    });
    test('DV v1', () => {
        const result = (0, index_1.parseTorrentTitle)('Belle (2021) 2160p 10bit 4KLight DOLBY VISION BluRay DDP 7.1 x265-QTZ');
        expect(result.hdr).toEqual(['DV']);
    });
    test('DV v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Андор / Andor [01x01-03 из 12] (2022) WEB-DL-HEVC 2160p | 4K | Dolby Vision TV | NewComers, HDRezka Studio');
        expect(result.hdr).toEqual(['DV']);
    });
    test('DV v3', () => {
        const result = (0, index_1.parseTorrentTitle)('АBullet.Train.2022.2160p.WEB-DL.DDP5.1.DV.MKV.x265-NOGRP');
        expect(result.hdr).toEqual(['DV']);
    });
    test('DV v4', () => {
        const result = (0, index_1.parseTorrentTitle)('Bullet.Train.2022.2160p.WEB-DL.DoVi.DD5.1.HEVC-EVO[TGx]');
        expect(result.hdr).toEqual(['DV']);
    });
    test('HDR/DV v1', () => {
        const result = (0, index_1.parseTorrentTitle)('Спайдерхед / Spiderhead (2022) WEB-DL-HEVC 2160p | 4K | HDR | Dolby Vision Profile 8 | P | NewComers, Jaskier');
        expect(result.hdr).toEqual(['DV', 'HDR']);
    });
    test('HDR/DV v2', () => {
        const result = (0, index_1.parseTorrentTitle)('House.of.the.Dragon.S01E07.2160p.10bit.HDR.DV.WEBRip.6CH.x265.HEVC-PSA');
        expect(result.hdr).toEqual(['DV', 'HDR']);
    });
    test('HDR/HDR10+/DV', () => {
        const result = (0, index_1.parseTorrentTitle)('Флешбэк / Memory (2022) WEB-DL-HEVC 2160p | 4K | HDR | HDR10+ | Dolby Vision Profile 8 | Pazl Voice');
        expect(result.hdr).toEqual(['DV', 'HDR10+', 'HDR']);
    });
    test('HDR with 10bit depth', () => {
        const result = (0, index_1.parseTorrentTitle)('Belle (2021) 2160p 10bit 4KLight DOLBY VISION BluRay DDP 7.1 x265-QTZ');
        expect(result.bitDepth).toBe('10bit');
    });
});
