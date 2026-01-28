"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Dubbed Detection Tests', () => {
    test('the english dubbed language correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('Yo-Kai Watch S01E71 DUBBED 720p HDTV x264-W4F');
        expect(result.dubbed).toBe(true);
    });
    test('dub correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[Golumpa] Kochoki - 11 (Kochoki - Wakaki Nobunaga) [English Dub] [FuniDub 720p x264 AAC] [MKV] [4FA0D898]');
        expect(result.dubbed).toBe(true);
    });
    test('dubs correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[Aomori-Raws] Juushinki Pandora (01-13) [Dubs & Subs]');
        expect(result.dubbed).toBe(true);
    });
    test('dual audio correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[LostYears] Tsuredure Children (WEB 720p Hi10 AAC) [Dual-Audio]');
        expect(result.dubbed).toBe(true);
    });
    test('dual-audio correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[DB] Gamers! [Dual Audio 10bit 720p][HEVC-x265]');
        expect(result.dubbed).toBe(true);
    });
    test('multi-audio correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[DragsterPS] Yu-Gi-Oh! S02 [480p] [Multi-Audio] [Multi-Subs]');
        expect(result.dubbed).toBe(true);
    });
    test('dublado correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('A Freira (2018) Dublado HD-TS 720p');
        expect(result.dubbed).toBe(true);
    });
    test('dual correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('Fame (1980) [DVDRip][Dual][Ac3][Eng-Spa]');
        expect(result.dubbed).toBe(true);
    });
    test('dubbing correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('Vaiana Skarb oceanu / Moana (2016) [720p] [WEB-DL] [x264] [Dubbing]');
        expect(result.dubbed).toBe(true);
    });
    test('not dual subs', () => {
        const result = (0, index_1.parseTorrentTitle)('[Hakata Ramen] Hoshiai No Sora (Stars Align) 01 [1080p][HEVC][x265][10bit][Dual-Subs] HR-DR');
        expect(result.dubbed).toBeUndefined();
    });
    test('multi-dub correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('[IceBlue] Naruto (Season 01) - [Multi-Dub][Multi-Sub][HEVC 10Bits] 800p BD');
        expect(result.dubbed).toBe(true);
    });
});
