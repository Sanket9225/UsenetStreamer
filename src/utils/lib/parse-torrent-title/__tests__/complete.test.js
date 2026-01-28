"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Complete Collection Detection Tests', () => {
    describe('Complete Collections', () => {
        test('complete series with full seasons', () => {
            const result = (0, index_1.parseTorrentTitle)('[Furi] Avatar - The Last Airbender [720p] (Full 3 Seasons + Extr');
            expect(result.complete).toBe(true);
        });
        test('complete collection', () => {
            const result = (0, index_1.parseTorrentTitle)('Harry.Potter.Complete.Collection.2001-2011.1080p.BluRay.DTS-ETRG');
            expect(result.complete).toBe(true);
        });
        test('complete collection with all seasons', () => {
            const result = (0, index_1.parseTorrentTitle)('Game of Thrones All 7 Seasons 1080p ~∞~ .HakunaMaKoko');
            expect(result.complete).toBe(true);
        });
        test('complete collection with full series', () => {
            const result = (0, index_1.parseTorrentTitle)('Avatar: The Last Airbender Full Series 720p');
            expect(result.complete).toBe(true);
        });
        test('complete collection with ultimate collection', () => {
            const result = (0, index_1.parseTorrentTitle)('Dora the Explorer - Ultimate Collection');
            expect(result.complete).toBe(true);
        });
        test('complete collection with complete pack', () => {
            const result = (0, index_1.parseTorrentTitle)('Mr Bean Complete Pack (Animated, Tv series, 2 Movies) DVDRIP (WA');
            expect(result.complete).toBe(true);
        });
        test('complete collection with complete set', () => {
            const result = (0, index_1.parseTorrentTitle)('American Pie - Complete set (8 movies) 720p mkv - YIFY');
            expect(result.complete).toBe(true);
        });
        test('complete collection with complete filmography', () => {
            const result = (0, index_1.parseTorrentTitle)('Charlie Chaplin - Complete Filmography (87 movies)');
            expect(result.complete).toBe(true);
        });
        test('complete collection with movies complete', () => {
            const result = (0, index_1.parseTorrentTitle)('Monster High Movies Complete 2014');
            expect(result.complete).toBe(true);
        });
        test('complete collection all movies', () => {
            const result = (0, index_1.parseTorrentTitle)('Harry Potter All Movies Collection 2001-2011 720p Dual KartiKing');
            expect(result.complete).toBe(true);
        });
        test('complete movie collection', () => {
            const result = (0, index_1.parseTorrentTitle)('The Clint Eastwood Movie Collection');
            expect(result.complete).toBe(true);
        });
        test('complete collection movies', () => {
            const result = (0, index_1.parseTorrentTitle)('Clint Eastwood Collection - 15 HD Movies');
            expect(result.complete).toBe(true);
        });
        test('complete movies collection', () => {
            const result = (0, index_1.parseTorrentTitle)('Official  IMDb  Top  250  Movies  Collection  6/17/2011');
            expect(result.complete).toBe(true);
        });
        test('collection', () => {
            const result = (0, index_1.parseTorrentTitle)('The Texas Chainsaw Massacre Collection (1974-2017) BDRip 1080p');
            expect(result.complete).toBe(true);
        });
        test('duology', () => {
            const result = (0, index_1.parseTorrentTitle)('Snabba.Cash.I-II.Duology.2010-2012.1080p.BluRay.x264.anoXmous');
            expect(result.complete).toBe(true);
        });
        test('trilogy', () => {
            const result = (0, index_1.parseTorrentTitle)('Star Wars Original Trilogy 1977-1983 Despecialized 720p');
            expect(result.complete).toBe(true);
        });
        test('quadrology', () => {
            const result = (0, index_1.parseTorrentTitle)('The.Wong.Kar-Wai.Quadrology.1990-2004.1080p.BluRay.x264.AAC.5.1-');
            expect(result.complete).toBe(true);
        });
        test('quadrilogy', () => {
            const result = (0, index_1.parseTorrentTitle)('Lethal.Weapon.Quadrilogy.1987-1992.1080p.BluRay.x264.anoXmous');
            expect(result.complete).toBe(true);
        });
        test('tetralogy', () => {
            const result = (0, index_1.parseTorrentTitle)('X-Men.Tetralogy.BRRip.XviD.AC3.RoSubbed-playXD');
            expect(result.complete).toBe(true);
        });
        test('pentalogy', () => {
            const result = (0, index_1.parseTorrentTitle)('Mission.Impossible.Pentalogy.1996-2015.1080p.BluRay.x264.AAC.5.1');
            expect(result.complete).toBe(true);
        });
        test('hexalogy', () => {
            const result = (0, index_1.parseTorrentTitle)('Mission.Impossible.Hexalogy.1996-2018.SweSub.1080p.x264-Justiso');
            expect(result.complete).toBe(true);
        });
        test('heptalogy', () => {
            const result = (0, index_1.parseTorrentTitle)('American.Pie.Heptalogy.SWESUB.DVDRip.XviD-BaZZe');
            expect(result.complete).toBe(true);
        });
        test('anthology', () => {
            const result = (0, index_1.parseTorrentTitle)('The Exorcist 1, 2, 3, 4, 5 - Complete Horror Anthology 1973-2005');
            expect(result.complete).toBe(true);
        });
        test('saga', () => {
            const result = (0, index_1.parseTorrentTitle)('Harry.Potter.Complete.Saga. I - VIII .1080p.Bluray.x264.anoXmous');
            expect(result.complete).toBe(true);
        });
        test('italian complete', () => {
            const result = (0, index_1.parseTorrentTitle)('Inganno - Miniserie (2024) [COMPLETA] SD H264 ITA AAC-UBi');
            expect(result.complete).toBe(true);
        });
    });
    describe('Not Complete', () => {
        test('not complete', () => {
            const result = (0, index_1.parseTorrentTitle)('Have I Got News For You S53E02 EXTENDED 720p HDTV x264-QPEL');
            expect(result.complete).toBeUndefined();
        });
        test('not complete when no collection keywords', () => {
            const result = (0, index_1.parseTorrentTitle)('Breaking Bad S01E01 1080p BluRay x264');
            expect(result.complete).toBeUndefined();
        });
    });
});
