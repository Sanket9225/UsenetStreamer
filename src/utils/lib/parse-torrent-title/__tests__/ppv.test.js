"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('PPV Detection Tests', () => {
    test('PPV 1', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.178.Jones.vs.Cormier.PPVHD.x264-KYR');
        expect(result.ppv).toBe(true);
    });
    test('PPV 2', () => {
        const result = (0, index_1.parseTorrentTitle)('WWE.RAW.2015.03.16.PPV.HDTV.x264-RUDOS');
        expect(result.ppv).toBe(true);
    });
});
