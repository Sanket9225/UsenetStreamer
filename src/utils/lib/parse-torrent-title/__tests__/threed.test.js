"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - 3d', () => {
    test('3D HSBS together', () => {
        const result = (0, index_1.parseTorrentTitle)('Incredibles 2 (2018) 3D HSBS 1080p BluRay H264 DolbyD 5.1 + nickarad');
        expect(result.threeD).toBe('3D HSBS');
    });
    test('3D H-SBS apart', () => {
        const result = (0, index_1.parseTorrentTitle)('Despicable.Me.2010.1080p.PROPER.3D.BluRay.H-SBS.x264-CULTHD [Pub');
        expect(result.threeD).toBe('3D HSBS');
    });
    test('3D Half-SBS apart', () => {
        const result = (0, index_1.parseTorrentTitle)('Avengers.Infinity.War.2018.3D.BluRay.1080p.Half-SBS.DTS.x264-CHC');
        expect(result.threeD).toBe('3D HSBS');
    });
    test('3D Half-SBS when 3D is in the name', () => {
        const result = (0, index_1.parseTorrentTitle)('Gravity.3D.2013.1080p.BluRay.Half-SBS.DTS.x264-PublicHD');
        expect(result.threeD).toBe('3D HSBS');
    });
    test('3D SBS apart', () => {
        const result = (0, index_1.parseTorrentTitle)('Guardians of the Galaxy Vol 3 2023 1080p 3D BluRay SBS x264');
        expect(result.threeD).toBe('3D SBS');
    });
    test('3D SBS together', () => {
        const result = (0, index_1.parseTorrentTitle)('3-D Zen Extreme Ecstasy 3D SBS (2011) [BDRip 1080p].avi');
        expect(result.threeD).toBe('3D SBS');
    });
    test('3D SBS when 3D is small letter', () => {
        const result = (0, index_1.parseTorrentTitle)('Saw 3D (2010) 1080p 3d BrRip x264 SBS - 1.3GB - YIFY');
        expect(result.threeD).toBe('3D SBS');
    });
    test('3D Full-SBS', () => {
        const result = (0, index_1.parseTorrentTitle)('Puss.In.Boots.The.Last.Wish.3D.(2022).Full-SBS.1080p.x264.ENG.AC3-JFC');
        expect(result.threeD).toBe('3D SBS');
    });
    test('3D HOU together', () => {
        const result = (0, index_1.parseTorrentTitle)('The Lego Ninjago Movie (2017) 3D HOU German DTS 1080p BluRay x264');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D HOU apart', () => {
        const result = (0, index_1.parseTorrentTitle)('47 Ronin 2013 3D BluRay HOU 1080p DTS x264-CHD3D');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D H-OU', () => {
        const result = (0, index_1.parseTorrentTitle)('The Three Musketeers 3D 2011 1080p H-OU BDRip x264 ac3 vice');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D H/OU', () => {
        const result = (0, index_1.parseTorrentTitle)('Kiss Me, Kate 3D (1953) [BRRip.1080p.x264.3D H/OU-DTS/AC3] [Lektor PL] [Eng]');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D Half-OU', () => {
        const result = (0, index_1.parseTorrentTitle)('Pixels.2015.1080p.3D.BluRay.Half-OU.x264.DTS-HD.MA.7.1-RARBG');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D HalfOU', () => {
        const result = (0, index_1.parseTorrentTitle)('Солнце 3D / 3D Sun (2007) BDRip 1080p от Ash61 | 3D-Video | halfOU | L1');
        expect(result.threeD).toBe('3D HOU');
    });
    test('3D OU together', () => {
        const result = (0, index_1.parseTorrentTitle)('Amazing Africa (2013) 3D OU 2160p Eng Rus');
        expect(result.threeD).toBe('3D OU');
    });
    test('3D Full OU together', () => {
        const result = (0, index_1.parseTorrentTitle)('For the Birds (2000) 3D Full OU 1080p');
        expect(result.threeD).toBe('3D OU');
    });
    test('3D', () => {
        const result = (0, index_1.parseTorrentTitle)('Incredibles 2 2018 3D BluRay');
        expect(result.threeD).toBe('3D');
    });
    test('3D with dots', () => {
        const result = (0, index_1.parseTorrentTitle)('Despicable.Me.3.2017.1080p.3D.BluRay.AVC.DTS-X.7.1-FGT');
        expect(result.threeD).toBe('3D');
    });
    test('3D with hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Гемини / Gemini Man (2019) BDRemux 1080p от селезень | 3D-Video | Лицензия');
        expect(result.threeD).toBe('3D');
    });
    test('3D in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('Pokémon Detective Pikachu (2019) [BluRay] [3D]');
        expect(result.threeD).toBe('3D');
    });
    test('3D in brackets with something else', () => {
        const result = (0, index_1.parseTorrentTitle)('Doctor Strange in the Multiverse of Madness (2022) [1080p 3D] [B');
        expect(result.threeD).toBe('3D');
    });
    test('HD3D', () => {
        const result = (0, index_1.parseTorrentTitle)('Бамблби / Bumblebee [2018, BDRemux, 1080p] BD3D');
        expect(result.threeD).toBe('3D');
    });
    test('SideBySide', () => {
        const result = (0, index_1.parseTorrentTitle)('Дэдпул и Росомаха / Deadpool & Wolverine [2024, BDRip, 1080p] SideBySide');
        expect(result.threeD).toBe('3D SBS');
    });
    test('Half SideBySide', () => {
        const result = (0, index_1.parseTorrentTitle)('Вий / Forbidden Kingdom [2014, WEB-DL] Half SideBySide');
        expect(result.threeD).toBe('3D HSBS');
    });
    test('OverUnder', () => {
        const result = (0, index_1.parseTorrentTitle)('Дэдпул и Росомаха / Deadpool & Wolverine [2024, BDRip, 1080p] OverUnder');
        expect(result.threeD).toBe('3D OU');
    });
    test('Half OverUnder', () => {
        const result = (0, index_1.parseTorrentTitle)('Миссия «Луна» / Лунный / Mooned [2023, BDRip] Half OverUnder');
        expect(result.threeD).toBe('3D HOU');
    });
    test('not 3D in name', () => {
        const result = (0, index_1.parseTorrentTitle)('Texas.Chainsaw.3D.2013.PROPER.1080p.BluRay.x264-LiViDiTY');
        expect(result.threeD).toBeUndefined();
    });
    test('not 3D in name v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Step Up 3D (2010) 720p BrRip x264 - 650MB - YIFY');
        expect(result.threeD).toBeUndefined();
    });
    test('not 3D in name v3', () => {
        const result = (0, index_1.parseTorrentTitle)('[YakuboEncodes] 3D Kanojo Real Girl - 01 ~ 24 [BD 1080p 10bit x265 HEVC][Dual-Audio Opus][Multi-Subs]');
        expect(result.threeD).toBeUndefined();
    });
});
