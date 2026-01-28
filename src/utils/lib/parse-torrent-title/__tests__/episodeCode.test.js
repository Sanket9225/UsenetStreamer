"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Episode Code Detection Tests', () => {
    describe('Valid Episode Codes', () => {
        test('Fairy Tail episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('[Golumpa] Fairy Tail - 214 [FuniDub 720p x264 AAC] [5E46AC39].mkv');
            expect(result.episodeCode).toBe('5E46AC39');
        });
        test('Tokyo Underground episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('[Exiled-Destiny]_Tokyo_Underground_Ep02v2_(41858470).mkv');
            expect(result.episodeCode).toBe('41858470');
        });
        test('El Cazador de la Bruja episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('[ACX]El_Cazador_de_la_Bruja_-_19_-_A_Man_Who_Protects_[SSJ_Saiyan_Elite]_[9E199846].mkv');
            expect(result.episodeCode).toBe('9E199846');
        });
        test('Medaka Box episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('[CBM]_Medaka_Box_-_11_-_This_Is_the_End!!_[720p]_[436E0E90]');
            expect(result.episodeCode).toBe('436E0E90');
        });
        test('Gankutsuou episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('Gankutsuou.-.The.Count.Of.Monte.Cristo[2005].-.04.-.[720p.BD.HEVC.x265].[FLAC].[Jd].[DHD].[b6e6e648].mkv');
            expect(result.episodeCode).toBe('B6E6E648');
        });
        test('Nanatsu no Taizai episode code', () => {
            const result = (0, index_1.parseTorrentTitle)('[D0ugyB0y] Nanatsu no Taizai Fundo no Shinpan - 01 (1080p WEB NF x264 AAC[9CC04E06]).mkv');
            expect(result.episodeCode).toBe('9CC04E06');
        });
    });
    describe('Should Not Detect Episode Code', () => {
        test('not episode code not at the end', () => {
            const result = (0, index_1.parseTorrentTitle)('Lost.[Perdidos].6x05.HDTV.XviD.[www.DivxTotaL.com].avi');
            expect(result.episodeCode).toBeUndefined();
        });
        test("not episode code when it's a word", () => {
            const result = (0, index_1.parseTorrentTitle)('Lost - Stagioni 01-06 (2004-2010) [COMPLETA] SD x264 AAC ITA SUB ITA');
            expect(result.episodeCode).toBeUndefined();
        });
        test("not episode code when it's only numbers", () => {
            const result = (0, index_1.parseTorrentTitle)('The voice of Holland S05E08 [20141017]  NL Battles 1.mp4');
            expect(result.episodeCode).toBeUndefined();
        });
    });
});
