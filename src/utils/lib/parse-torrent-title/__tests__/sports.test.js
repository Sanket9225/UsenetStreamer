"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - sports', () => {
    test('UFC 247 Jones vs Reyes', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.247.PPV.Jones.vs.Reyes.HDTV.x264-PUNCH[TGx]');
        expect(result.title).toBe('UFC 247 Jones vs Reyes');
        expect(result.quality).toBe('HDTV');
        expect(result.codec).toBe('x264');
        expect(result.group).toBe('PUNCH');
    });
    test('UFC 219 Cyborg vs Holm', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.219.PPV.Cyborg.vs.Holm.720p.HDTV.x264-KYR[rartv]');
        expect(result.title).toBe('UFC 219 Cyborg vs Holm');
        expect(result.quality).toBe('HDTV');
        expect(result.resolution).toBe('720p');
        expect(result.codec).toBe('x264');
        expect(result.group).toBe('KYR');
    });
    test('UFC 218 Holloway vs Aldo 2', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.218.PPV.Holloway.vs.Aldo.2.HDTV.x264-Ebi[TGx]');
        expect(result.title).toBe('UFC 218 Holloway vs Aldo 2');
        expect(result.quality).toBe('HDTV');
        expect(result.codec).toBe('x264');
        expect(result.group).toBe('Ebi');
    });
});
