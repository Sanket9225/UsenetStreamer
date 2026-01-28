"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Audio Detection Tests', () => {
    describe('Basic Audio Formats', () => {
        test('the dts audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Nocturnal Animals 2016 VFF 1080p BluRay DTS HEVC-HD2');
            expect(result.audio).toEqual(['DTS Lossy']);
        });
        test('the DTS-HD audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Gold 2016 1080p BluRay DTS-HD MA 5 1 x264-HDH');
            expect(result.audio).toEqual(['DTS Lossless']);
        });
        test('the AAC audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Rain Man 1988 REMASTERED 1080p BRRip x264 AAC-m2g');
            expect(result.audio).toEqual(['AAC']);
        });
        test('convert the AAC2.0 audio to AAC', () => {
            const result = (0, index_1.parseTorrentTitle)('The Vet Life S02E01 Dunk-A-Doctor 1080p ANPL WEB-DL AAC2 0 H 264-RTN');
            expect(result.audio).toEqual(['AAC']);
        });
        test('the dd5 audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Jimmy Kimmel 2017 05 03 720p HDTV DD5 1 MPEG2-CTL');
            expect(result.audio).toEqual(['DD']);
        });
        test('the AC3 audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)("A Dog's Purpose 2016 BDRip 720p X265 Ac3-GANJAMAN");
            expect(result.audio).toEqual(['AC3']);
        });
        test('convert the AC-3 audio to AC3', () => {
            const result = (0, index_1.parseTorrentTitle)('Retroactive 1997 BluRay 1080p AC-3 HEVC-d3g');
            expect(result.audio).toEqual(['AC3']);
        });
        test('the mp3 audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Tempete 2016-TrueFRENCH-TVrip-H264-mp3');
            expect(result.audio).toEqual(['MP3']);
        });
        test('the eac3 5.1 audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('The Blacklist S07E04 (1080p AMZN WEB-DL x265 HEVC 10bit EAC-3 5.1)[Bandi]');
            expect(result.audio).toEqual(['EAC3']);
        });
        test('the eac3 6.0 audio correctly', () => {
            const result = (0, index_1.parseTorrentTitle)('Condor.S01E03.1080p.WEB-DL.x265.10bit.EAC3.6.0-Qman[UTR].mkv');
            expect(result.audio).toEqual(['EAC3']);
        });
        test('the eac3 2.0 audio correctly 2', () => {
            const result = (0, index_1.parseTorrentTitle)('The 13 Ghosts of Scooby-Doo (1985) S01 (1080p AMZN Webrip x265 10bit EAC-3 2.0 - Frys) [TAoE]');
            expect(result.audio).toEqual(['EAC3']);
        });
        test('not mp3 audio inside a word', () => {
            const result = (0, index_1.parseTorrentTitle)('[Thund3r3mp3ror] Attack on Titan - 23.mp4');
            expect(result.audio).toBeUndefined();
        });
    });
    describe('Multiple Audio Tracks', () => {
        test('2.0x2 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Buttobi!! CPU - 02 (DVDRip 720x480p x265 HEVC AC3x2 2.0x2)(Dual Audio)[sxales].mkv');
            expect(result.audio).toEqual(['AC3']);
        });
        test('qaac2 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('[naiyas] Fate Stay Night - Unlimited Blade Works Movie [BD 1080P HEVC10 QAACx2 Dual Audio]');
            expect(result.audio).toEqual(['AAC']);
        });
        test('2.0x5.1 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Sakura Wars the Movie (2001) (BDRip 1920x1036p x265 HEVC FLACx2, AC3 2.0+5.1x2)(Dual Audio)[sxales].mkv');
            expect(result.audio).toEqual(['FLAC', 'AC3']);
        });
        test('5.1x2.0 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Macross ~ Do You Remember Love (1984) (BDRip 1920x1036p x265 HEVC DTS-HD MA, FLAC, AC3x2 5.1+2.0x3)(Dual Audio)[sxales].mkv');
            expect(result.audio).toEqual(['DTS Lossless', 'FLAC', 'AC3']);
        });
        test('5.1x2+2.0x3 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Escaflowne (2000) (BDRip 1896x1048p x265 HEVC TrueHD, FLACx3, AC3 5.1x2+2.0x3)(Triple Audio)[sxales].mkv');
            expect(result.audio).toEqual(['TrueHD', 'FLAC', 'AC3']);
        });
        test('FLAC2.0x2 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('[SAD] Inuyasha - The Movie 4 - Fire on the Mystic Island [BD 1920x1036 HEVC10 FLAC2.0x2] [84E9A4A1].mkv');
            expect(result.audio).toEqual(['FLAC']);
        });
        test('FLACx2 2.0x3 audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Outlaw Star - 23 (BDRip 1440x1080p x265 HEVC AC3, FLACx2 2.0x3)(Dual Audio)[sxales].mkv');
            expect(result.audio).toEqual(['FLAC', 'AC3']);
            expect(result.episodes).toEqual([23]);
        });
    });
    describe('Audio with Channels', () => {
        test('7.1 Atmos audio', () => {
            const result = (0, index_1.parseTorrentTitle)('Spider-Man.No.Way.Home.2021.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-FraMeSToR');
            expect(result.audio).toEqual(['Atmos', 'TrueHD']);
            expect(result.channels).toEqual(['7.1']);
        });
    });
    describe('DTS Lossless Audio Tests', () => {
        test('The Shawshank Redemption with DTS-HDMA', () => {
            const result = (0, index_1.parseTorrentTitle)('The Shawshank Redemption 1994.MULTi.1080p.Blu-ray.DTS-HDMA.5.1.HEVC-DDR[EtHD]');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('The Shawshank Redemption');
        });
        test('Oppenheimer with DTS-HD.MA', () => {
            const result = (0, index_1.parseTorrentTitle)('Oppenheimer.2023.BluRay.1080p.DTS-HD.MA.5.1.AVC.REMUX-FraMeSToR.mkv');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Oppenheimer');
        });
        test('Guardians of the Galaxy Vol 3', () => {
            const result = (0, index_1.parseTorrentTitle)('Guardians.of.the.Galaxy.Vol.3.2023.BluRay.1080p.DTS-HD.MA.7.1.x264-MTeam[TGx]');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Guardians of the Galaxy Vol 3');
        });
        test('Oppenheimer with dual DTS and DDP', () => {
            const result = (0, index_1.parseTorrentTitle)('Oppenheimer.2023.2160p.MA.WEB-DL.DUAL.DTS.HD.MA.5.1+DD+5.1.DV-HDR.H.265-TheBiscuitMan.mkv');
            expect(result.audio).toEqual(['DTS Lossless', 'DDP']);
            expect(result.title).toBe('Oppenheimer');
        });
        test('The Equalizer 3', () => {
            const result = (0, index_1.parseTorrentTitle)('The.Equalizer.3.2023.BluRay.1080p.DTS-HD.MA.5.1.x264-MTeam');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('The Equalizer 3');
        });
        test('Point Break', () => {
            const result = (0, index_1.parseTorrentTitle)('Point.Break.1991.2160p.Blu-ray.Remux.DV.HDR.HEVC.DTS-HD.MA.5.1-CiNEPHiLES.mkv');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Point Break');
        });
        test('The Mechanic', () => {
            const result = (0, index_1.parseTorrentTitle)('The.Mechanic.2011.2160p.UHD.Blu-ray.Remux.DV.HDR.HEVC.DTS-HD.MA.5.1-CiNEPHiLES.mkv');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('The Mechanic');
        });
        test('Face Off', () => {
            const result = (0, index_1.parseTorrentTitle)('Face.Off.1997.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.REMUX-FraMeSToR.mkv');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Face Off');
        });
        test('Killers of the Flower Moon', () => {
            const result = (0, index_1.parseTorrentTitle)('Killers of the Flower Moon 2023 2160p UHD Blu-ray Remux HEVC DV DTS-HD MA 5.1-HDT.mkv');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Killers of the Flower Moon');
        });
        test('Ghostbusters Frozen Empire', () => {
            const result = (0, index_1.parseTorrentTitle)('Ghostbusters.Frozen.Empire.2024.1080p.BluRay.ENG.LATINO.HINDI.ITA.DTS-HD.Master.5.1.H264-BEN.THE.MEN');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Ghostbusters Frozen Empire');
        });
        test('How To Train Your Dragon 2', () => {
            const result = (0, index_1.parseTorrentTitle)('How.To.Train.Your.Dragon.2.2014.1080p.BluRay.ENG.LATINO.DTS-HD.Master.H264-BEN.THE.MEN');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('How To Train Your Dragon 2');
        });
        test('Oppenheimer with Chinese markers', () => {
            const result = (0, index_1.parseTorrentTitle)('【高清影视之家发布 www.HDBTHD.com】奥本海默[IMAX满屏版][简繁英字幕].Oppenheimer.2023.IMAX.2160p.BluRay.x265.10bit.DTS-HD.MA.5.1-CTRLHD');
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe('Oppenheimer');
        });
        test("Ocean's Thirteen", () => {
            const result = (0, index_1.parseTorrentTitle)("Ocean's.Thirteen.2007.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR.mkv");
            expect(result.audio).toEqual(['DTS Lossless']);
            expect(result.title).toBe("Ocean's Thirteen");
        });
    });
    describe('DTS Lossy Audio Tests', () => {
        test('Sleepy Hollow with DTS-HD.HR', () => {
            const result = (0, index_1.parseTorrentTitle)('Sleepy.Hollow.1999.BluRay.1080p.2Audio.DTS-HD.HR.5.1.x265.10bit-ALT');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Sleepy Hollow');
        });
        test('The Flash with DTS, DD+ and Atmos', () => {
            const result = (0, index_1.parseTorrentTitle)('The Flash 2023 WEBRip 1080p DTS DD+ 5.1 Atmos x264-MgB');
            expect(result.audio).toEqual(['DTS Lossy', 'Atmos', 'DDP']);
            expect(result.title).toBe('The Flash');
        });
        test('Indiana Jones with DTS and AC3', () => {
            const result = (0, index_1.parseTorrentTitle)('Indiana Jones and the Last Crusade 1989 BluRay 1080p DTS AC3 x264-MgB');
            expect(result.audio).toEqual(['DTS Lossy', 'AC3']);
            expect(result.title).toBe('Indiana Jones and the Last Crusade');
        });
        test('London Olympics with DTS-HD', () => {
            const result = (0, index_1.parseTorrentTitle)('2012.London.Olympics.BBC.Bluray.Set.1080p.DTS-HD');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('London Olympics BBC');
        });
        test('Oppenheimer from TamilMV', () => {
            const result = (0, index_1.parseTorrentTitle)('www.1TamilMV.phd - Oppenheimer (2023) English BluRay - 1080p - x264 - (DTS 5.1) - 7.3GB - ESub.mkv');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Oppenheimer');
        });
        test('Johnny Keep Walking with Chinese title', () => {
            const result = (0, index_1.parseTorrentTitle)('【高清影视之家发布 www.HDBTHD.com】年会不能停！[60帧率版本][国语音轨+中文字幕].Johnny.Keep.Walking.2023.60FPS.2160p.WEB-DL.H265.10bit.DTS.5.1-GPTHD');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Johnny Keep Walking');
        });
        test('Big Stan with DTS-HD.HR', () => {
            const result = (0, index_1.parseTorrentTitle)('Big.Stan.2007.1080p.BluRay.Remux.DTS-HD.HR.5.1');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Big Stan');
        });
        test('Ditched with DTS-HD.HR', () => {
            const result = (0, index_1.parseTorrentTitle)('Ditched.2022.1080p.Bluray.DTS-HD.HR.5.1.X264-EVO[TGx]');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Ditched');
        });
        test('Basic Instinct with DTS-HD-HR', () => {
            const result = (0, index_1.parseTorrentTitle)('Basic.Instinct.1992.Unrated.Directors.Cut.Bluray.1080p.DTS-HD-HR-6.1.x264-Grym@BTNET');
            expect(result.audio).toEqual(['DTS Lossy']);
            expect(result.title).toBe('Basic Instinct');
        });
    });
});
