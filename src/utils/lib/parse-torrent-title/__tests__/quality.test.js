"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Quality Detection Tests', () => {
    test('BluRay REMUX 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Planet.Earth.II.S01.2016.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.5.1');
        expect(result.quality).toBe('BluRay REMUX');
    });
    test('BluRay REMUX 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Joker.2019.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT');
        expect(result.quality).toBe('BluRay REMUX');
    });
    test('BluRay 1', () => {
        const result = (0, index_1.parseTorrentTitle)('The Monkey King 3 2018 CHINESE 1080p BluRay H264 AAC-VXT');
        expect(result.quality).toBe('BluRay');
    });
    test('BluRay 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Harry.Potter.And.The.Goblet.Of.Fire.2005.1080p.BluRay.x264.DTS-WiKi');
        expect(result.quality).toBe('BluRay');
    });
    test('UHDRip', () => {
        const result = (0, index_1.parseTorrentTitle)('Joker.2019.UHDRip.2160p.HDR.4K.DV.ITA.ENG.Subs.TrueHD.Atmos.7.1.x265-NAHOM');
        expect(result.quality).toBe('UHDRip');
    });
    test('BRRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Booksmart.2019.BRRip.XviD.AC3-EVO');
        expect(result.quality).toBe('BRRip');
    });
    test('BRRip 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Rogue.Warfare.2.The.Hunt.2019.BRRip.XviD.AC3-XVID');
        expect(result.quality).toBe('BRRip');
    });
    test('BDRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Despicable.Me.2010.FRENCH.BDRip.XviD-SANCTUARY');
        expect(result.quality).toBe('BDRip');
    });
    // test('BDRip 2', () => {
    //   const result = parseTorrentTitle('Hitman Agent 47 (2015) BDSCR Dual Audio Hindi Eng 720p');
    //   expect(result.quality).toBe('BDRip');
    // });
    test('HDTV 1', () => {
        const result = (0, index_1.parseTorrentTitle)('doctor_who_2005.8x12.death_in_heaven.720p_hdtv_x264-fov');
        expect(result.quality).toBe('HDTV');
    });
    test('HDTV 2', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.178.Jones.vs.Cormier.Countdown.720p.HDTV.x264-KYR');
        expect(result.quality).toBe('HDTV');
    });
    test('HDTV 3', () => {
        const result = (0, index_1.parseTorrentTitle)('WWE.RAW.2015.03.16.HDTV-RUDOS');
        expect(result.quality).toBe('HDTV');
    });
    test('PDTV', () => {
        const result = (0, index_1.parseTorrentTitle)('WWE.Monday.Night.RAW.2015.02.16.PDTV.x264-RUDOS');
        expect(result.quality).toBe('PDTV');
    });
    test('WEB-DL 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Marvels.Agents.of.S.H.I.E.L.D.S02E01.Shadows.1080p.WEB-DL.DD5.1');
        expect(result.quality).toBe('WEB-DL');
    });
    test('WEB-DL 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Astro.Kid.2019.1080p.WEB-DL.H264.AC3-EVO');
        expect(result.quality).toBe('WEB-DL');
    });
    test('WEB-DLRip', () => {
        const result = (0, index_1.parseTorrentTitle)('Ford.v.Ferrari.2019.D.WEB-DLRip.avi');
        expect(result.quality).toBe('WEB-DLRip');
    });
    test('WEBRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Hercules (2014) 1080p WEBRip AAC2.0 x264 readnfo-POISON');
        expect(result.quality).toBe('WEBRip');
    });
    test('WEBRip 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Brave.2012.WEBRip.LINE.XviD.AC3-SuperNova');
        expect(result.quality).toBe('WEBRip');
    });
    test('WEBCap', () => {
        const result = (0, index_1.parseTorrentTitle)('Jack.And.Jill.2011.PROPER.WEBCAP.XViD.AC3-SuperNova');
        expect(result.quality).toBe('WEBCap');
    });
    test('HDTC 1', () => {
        const result = (0, index_1.parseTorrentTitle)('American.Sniper.2014.HDTC.x264-FANTA');
        expect(result.quality).toBe('TeleCine');
    });
    test('HDTC 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Horrible.Bosses.2.2014.HDTC.XViD-NO');
        expect(result.quality).toBe('TeleCine');
    });
    test('HDRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Survivor.2015.HDRip.XViD-EVO');
        expect(result.quality).toBe('HDRip');
    });
    test('HDRip 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Love.2015.HDRip.XviD.AC3-EVO');
        expect(result.quality).toBe('HDRip');
    });
    test('DVDRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Frozen.2013.DVDRip.x264.AAC-KiNGDOM');
        expect(result.quality).toBe('DVDRip');
    });
    test('DVDRip 2', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Lego.Movie.2014.DVDRip.XviD.AC3-SuperNova');
        expect(result.quality).toBe('DVDRip');
    });
    test('DVDscr 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Better.Call.Saul.S01E04.DVDscr.x264-KILLERS');
        expect(result.quality).toBe('SCR');
    });
    test('DVDscr 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Horrible.Bosses.2.2014.DVDSCR.XViD-NO');
        expect(result.quality).toBe('SCR');
    });
    test('DVDR 1', () => {
        const result = (0, index_1.parseTorrentTitle)('La.Lecon.de.piano.1993.DVDR.NTSC-EliTe');
        expect(result.quality).toBe('DVD');
    });
    test('DVDR 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Somewhere.in.Time.1980.DVDR.NTSC.MPEG-2');
        expect(result.quality).toBe('DVD');
    });
    test('SDTV 1', () => {
        const result = (0, index_1.parseTorrentTitle)('WWE.SmackDown.2015.02.19.SDTV.x264-RUDOS');
        expect(result.quality).toBe('SDTV');
    });
    test('SDTV 2', () => {
        const result = (0, index_1.parseTorrentTitle)('WWE Monday Night RAW 2015 02 02 SDTV x264-RUDOS');
        expect(result.quality).toBe('SDTV');
    });
    test('TVRIP 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Maman.J.Ai.Raté.L.Avion.1990.TVRIP.XViD-ABiTE');
        expect(result.quality).toBe('TVRip');
    });
    test('TVRIP 2', () => {
        const result = (0, index_1.parseTorrentTitle)('L.Auberge.Rouge.2007.TVRIP.XViD-ABiTE');
        expect(result.quality).toBe('TVRip');
    });
    test('TeleSync 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Annabelle.2014.HC.NEW.TELESYNC.x264.AAC-P2P');
        expect(result.quality).toBe('TeleSync');
    });
    test('TeleSync 2', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Boss.2016.TELESYNC.x264.AC3.SHQ-DADDY');
        expect(result.quality).toBe('TeleSync');
    });
    test('CAM 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Jurassic.World.2015.CAM.V2.x264.MP3-SUPERFAST');
        expect(result.quality).toBe('CAM');
    });
    test('CAM 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Spy.2015.NEW.CAM.x264-TURG');
        expect(result.quality).toBe('CAM');
    });
    test('SCR 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Swordfish 2001 DVDScr Xvid [RoB]');
        expect(result.quality).toBe('SCR');
    });
    test('SCR 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Hitman Agent 47 (2015) BDSCR Dual Audio Hindi Eng 720p');
        expect(result.quality).toBe('SCR');
    });
    test('VHSRip 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Paranormal Activity The Ghost Dimension (2015) VHSRIP XVID AC3-EVE');
        expect(result.quality).toBe('VHSRip');
    });
    test('VHSRip 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Tales.From.The.Crypt.1989.VHSRIP.XviD.AC3');
        expect(result.quality).toBe('VHSRip');
    });
    test('VODR', () => {
        const result = (0, index_1.parseTorrentTitle)('My.Friend.Dahmer.2017.VODRip.XViD-ETRG');
        expect(result.quality).toBe('VODR');
    });
    test('WORKPRINT', () => {
        const result = (0, index_1.parseTorrentTitle)('Deadpool 2016 WP WORKPRINT XviD MP3-SATAN');
        expect(result.quality).toBe('WORKPRINT');
    });
});
