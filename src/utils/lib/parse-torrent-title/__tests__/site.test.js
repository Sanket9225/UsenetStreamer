"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - site', () => {
    test('eztv.re site', () => {
        const result = (0, index_1.parseTorrentTitle)('The Flash 2014 S01E01 (1080p AMZN Webrip x265 10bit EAC3 5 1 - Goki)[TAoE] [eztv]');
        expect(result.site).toBe('eztv.re');
    });
    test('eztv as release group', () => {
        const result = (0, index_1.parseTorrentTitle)('The Flash 2014 S01E01 (1080p AMZN Webrip x265 10bit EAC3 5 1 - Goki)[TAoE] eztv');
        expect(result.site).toBe('eztv.re');
    });
    test('TamilMV site', () => {
        const result = (0, index_1.parseTorrentTitle)('www.1TamilMV.world - Ayalaan (2024) Tamil PreDVD - 1080p - x264 - HQ Clean Aud - 2.5GB.mkv');
        expect(result.site).toBe('www.1TamilMV.world');
    });
    test('TamilMV site with pictures subdomain', () => {
        const result = (0, index_1.parseTorrentTitle)('www.1TamilMV.pics - 777 Charlie (2022) Tamil HDRip - 720p - x264 - HQ Clean Aud - 1.4GB.mkv');
        expect(result.site).toBe('www.1TamilMV.pics');
    });
    test('AtomoHD site', () => {
        const result = (0, index_1.parseTorrentTitle)('Anatomia De Grey - Temporada 19 [HDTV][Cap.1905][Castellano][www.AtomoHD.nu].avi');
        expect(result.site).toBe('www.AtomoHD.nu');
    });
    test('HD-ELITE.NET site', () => {
        const result = (0, index_1.parseTorrentTitle)('3 Musketeers 2011 R5 READNFO XviD-NYDIC [www.HD-ELITE.NET]');
        expect(result.site).toBe('www.HD-ELITE.NET');
    });
    test('Torrent9 site', () => {
        const result = (0, index_1.parseTorrentTitle)('Firefly.2002.04.Shindig.Vo+Stfr+Steng.1080p.WEB-DL.DD 2.0.H.264-P2P-www.Torrent9.cz.mkv');
        expect(result.site).toBe('www.Torrent9.cz');
    });
    test('Naruto-Kun site', () => {
        const result = (0, index_1.parseTorrentTitle)('[www.Naruto-Kun.Hu] Dragon Ball Z - 001.mkv');
        expect(result.site).toBe('www.Naruto-Kun.Hu');
    });
    test('TamilBlasters site', () => {
        const result = (0, index_1.parseTorrentTitle)('www.TamilBlasters.cam - Titanic (1997)[1080p BDRip - Org Auds - [Tamil + Telugu + Hindi + Eng] - x264 - DD5.1 (448 Kbps) - 4.7GB - ESubs].mkv');
        expect(result.site).toBe('www.TamilBlasters.cam');
    });
    test('Torrenting site', () => {
        const result = (0, index_1.parseTorrentTitle)('www.Torrenting.com   -    14.Peaks.Nothing.Is.Impossible.2021.1080p.WEB.h264-RUMOUR');
        expect(result.site).toBe('www.Torrenting.com');
    });
    test('arabp2p site', () => {
        const result = (0, index_1.parseTorrentTitle)('[www.arabp2p.net]_-_تركي مترجم ومدبلج Last.Call.for.Istanbul.2023.1080p.NF.WEB-DL.DDP5.1.H.264.MKV.torrent');
        expect(result.site).toBe('www.arabp2p.net');
    });
});
