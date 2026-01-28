"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Container Detection Tests', () => {
    test('mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Kevin Hart What Now (2016) 1080p BluRay x265 6ch -Dtech mkv');
        expect(result.container).toBe('mkv');
    });
    test('mp4', () => {
        const result = (0, index_1.parseTorrentTitle)('The Gorburger Show S01E05 AAC MP4-Mobile');
        expect(result.container).toBe('mp4');
    });
    test('avi', () => {
        const result = (0, index_1.parseTorrentTitle)('[req]Night of the Lepus (1972) DVDRip XviD avi');
        expect(result.container).toBe('avi');
    });
});
