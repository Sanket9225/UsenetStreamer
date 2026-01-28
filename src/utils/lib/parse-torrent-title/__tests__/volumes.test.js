"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
// Helper function to generate integer ranges
function intRange(start, end) {
    const result = [];
    for (let i = start; i <= end; i++) {
        result.push(i);
    }
    return result;
}
describe('parseTorrentTitle - volumes', () => {
    test('[MTBB] Sword Art Onlineː Alicization - Volume 2 (BD 1080p)', () => {
        const result = (0, index_1.parseTorrentTitle)('[MTBB] Sword Art Onlineː Alicization - Volume 2 (BD 1080p)');
        expect(result.volumes).toEqual([2]);
    });
    test('[Neutrinome] Sword Art Online Alicization Vol.2 - VOSTFR [1080p BDRemux] + DDL', () => {
        const result = (0, index_1.parseTorrentTitle)('[Neutrinome] Sword Art Online Alicization Vol.2 - VOSTFR [1080p BDRemux] + DDL');
        expect(result.volumes).toEqual([2]);
    });
    test('[Mr. Kimiko] Oh My Goddess! - Vol. 7 [Kobo][2048px][CBZ]', () => {
        const result = (0, index_1.parseTorrentTitle)('[Mr. Kimiko] Oh My Goddess! - Vol. 7 [Kobo][2048px][CBZ]');
        expect(result.volumes).toEqual([7]);
    });
    test('[MTBB] Cross Game - Volume 1-3 (WEB 720p)', () => {
        const result = (0, index_1.parseTorrentTitle)('[MTBB] Cross Game - Volume 1-3 (WEB 720p)');
        expect(result.volumes).toEqual([1, 2, 3]);
    });
    test('PIXAR SHORT FILMS COLLECTION - VOLS. 1 & 2 + - BDrip 1080p', () => {
        const result = (0, index_1.parseTorrentTitle)('PIXAR SHORT FILMS COLLECTION - VOLS. 1 & 2 + - BDrip 1080p');
        expect(result.volumes).toEqual([1, 2]);
    });
    test('Altair - A Record of Battles Vol. 01-08 (Digital) (danke-Empire)', () => {
        const result = (0, index_1.parseTorrentTitle)('Altair - A Record of Battles Vol. 01-08 (Digital) (danke-Empire)');
        expect(result.volumes).toEqual(intRange(1, 8));
    });
    test('Guardians of the Galaxy Vol. 2 (2017) 720p HDTC x264 MKVTV', () => {
        const result = (0, index_1.parseTorrentTitle)('Guardians of the Galaxy Vol. 2 (2017) 720p HDTC x264 MKVTV');
        expect(result.title).toBe('Guardians of the Galaxy Vol. 2');
        expect(result.volumes).toBeUndefined();
    });
    test('Kill Bill: Vol. 1 (2003) BluRay 1080p 5.1CH x264 Ganool', () => {
        const result = (0, index_1.parseTorrentTitle)('Kill Bill: Vol. 1 (2003) BluRay 1080p 5.1CH x264 Ganool');
        expect(result.title).toBe('Kill Bill: Vol. 1');
        expect(result.volumes).toBeUndefined();
    });
    test('[Valenciano] Aquarion EVOL - 22 [1080p][AV1 10bit][FLAC][Eng sub].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('[Valenciano] Aquarion EVOL - 22 [1080p][AV1 10bit][FLAC][Eng sub].mkv');
        expect(result.title).toBe('Aquarion EVOL');
        expect(result.volumes).toBeUndefined();
    });
    test('[uP] One Piece - Vol.088 (WEBRip 1080p x264 AC3 Multi)', () => {
        const result = (0, index_1.parseTorrentTitle)('[uP] One Piece - Vol.088 (WEBRip 1080p x264 AC3 Multi)');
        expect(result.volumes).toEqual([88]);
    });
});
