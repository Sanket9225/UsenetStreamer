"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('parseTorrentTitle - title', () => {
    test('return the title', () => {
        const result = (0, index_1.parseTorrentTitle)('La famille bélier');
        expect(result.title).toBe('La famille bélier');
    });
    test('remove dots', () => {
        const result = (0, index_1.parseTorrentTitle)('La.famille.bélier');
        expect(result.title).toBe('La famille bélier');
    });
    test('not remove dots when they are part of the title', () => {
        const result = (0, index_1.parseTorrentTitle)('Mr. Nobody');
        expect(result.title).toBe('Mr. Nobody');
    });
    test('remove underscores', () => {
        const result = (0, index_1.parseTorrentTitle)('doctor_who_2005.8x12.death_in_heaven.720p_hdtv_x264-fov');
        expect(result.title).toBe('doctor who');
    });
    test('remove unnecessary translations', () => {
        const result = (0, index_1.parseTorrentTitle)('[GM-Team][国漫][太乙仙魔录 灵飞纪 第3季][Magical Legend of Rise to immortality Ⅲ][01-26][AVC][GB][1080P]');
        expect(result.title).toBe('Magical Legend of Rise to immortality Ⅲ');
    });
    test('remove unnecessary translations not included in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('【喵萌奶茶屋】★01月新番★[Rebirth][01][720p][简体][招募翻译]');
        expect(result.title).toBe('Rebirth');
    });
    test('remove japanese alt titles', () => {
        const result = (0, index_1.parseTorrentTitle)('【喵萌奶茶屋】★01月新番★[別對映像研出手！/映像研には手を出すな！/Eizouken ni wa Te wo Dasu na!][01][1080p][繁體]');
        expect(result.title).toBe('Eizouken ni wa Te wo Dasu na!');
    });
    test('remove japanese alt titles when the main one is in the middle', () => {
        const result = (0, index_1.parseTorrentTitle)('【喵萌奶茶屋】★01月新番★[別對映像研出手！/Eizouken ni wa Te wo Dasu na!/映像研には手を出すな！][01][1080p][繁體]');
        expect(result.title).toBe('Eizouken ni wa Te wo Dasu na!');
    });
    test('remove japanese alt titles without separators', () => {
        const result = (0, index_1.parseTorrentTitle)('[Seed-Raws] 劇場版 ペンギン・ハイウェイ Penguin Highway The Movie (BD 1280x720 AVC AACx4 [5.1+2.0+2.0+2.0]).mp4');
        expect(result.title).toBe('Penguin Highway The Movie');
    });
    test('not split slash separated title', () => {
        const result = (0, index_1.parseTorrentTitle)('[SweetSub][Mutafukaz / MFKZ][Movie][BDRip][1080P][AVC 8bit][简体内嵌]');
        expect(result.title).toBe('Mutafukaz / MFKZ');
    });
    test('clean release group tag title', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Kingdom 3rd Season - 02 [1080p].mkv');
        expect(result.title).toBe('Kingdom');
    });
    test('detect remove russian alt title', () => {
        const result = (0, index_1.parseTorrentTitle)('Голубая волна / Blue Crush (2002) DVDRip');
        expect(result.title).toBe('Blue Crush');
    });
    test('not remove non english title if its the only thing left', () => {
        const result = (0, index_1.parseTorrentTitle)('Жихарка (2007) DVDRip');
        expect(result.title).toBe('Жихарка');
    });
    test('not remove non english title with digits in it', () => {
        const result = (0, index_1.parseTorrentTitle)('3 Миссия невыполнима 3 2006г. BDRip 1080p.mkv');
        expect(result.title).toBe('3 Миссия невыполнима 3');
    });
    test('not remove russian movie numbering with dot and space', () => {
        const result = (0, index_1.parseTorrentTitle)('1. Детские игры. 1988. 1080p. HEVC. 10bit..mkv');
        expect(result.title).toBe('1. Детские игры');
    });
    test('not remove russian movie numbering with number in title', () => {
        const result = (0, index_1.parseTorrentTitle)('01. 100 девчонок и одна в лифте 2000 WEBRip 1080p.mkv');
        expect(result.title).toBe('01. 100 девчонок и одна в лифте');
    });
    test('not remove russian movie numbering with dot', () => {
        const result = (0, index_1.parseTorrentTitle)('08.Планета.обезьян.Революция.2014.BDRip-HEVC.1080p.mkv');
        expect(result.title).toBe('08 Планета обезьян Революция');
    });
    test('clear russian cast info from title', () => {
        const result = (0, index_1.parseTorrentTitle)('Американские животные / American Animals (Барт Лэйтон / Bart Layton) [2018, Великобритания, США, драма, криминал, BDRip] MVO (СВ Студия)');
        expect(result.title).toBe('American Animals');
    });
    test('clear cast info from russian title', () => {
        const result = (0, index_1.parseTorrentTitle)('Греческая смоковница / Griechische Feigen / The Fruit Is Ripe (Зиги Ротемунд / Sigi Rothemund (as Siggi Götz)) [1976, Германия (ФРГ), эротика, комедия, приключения, DVDRip] 2 VO');
        expect(result.title).toBe('Griechische Feigen / The Fruit Is Ripe');
    });
    test('clear cast info from russian title v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Греческая смоковница / The fruit is ripe / Griechische Feigen (Siggi Götz) [1976, Германия, Эротическая комедия, DVDRip]');
        expect(result.title).toBe('The fruit is ripe / Griechische Feigen');
    });
    test('clear cast info from russian title v3', () => {
        const result = (0, index_1.parseTorrentTitle)('Бастер / Buster (Дэвид Грин / David Green) [1988, Великобритания, Комедия, мелодрама, драма, приключения, криминал, биография, DVDRip]');
        expect(result.title).toBe('Buster');
    });
    test('detect title even when year is in beginning with paranthesis', () => {
        const result = (0, index_1.parseTorrentTitle)("(2000) Le follie dell'imperatore - The Emperor's New Groove (DvdRip Ita Eng AC3 5.1).avi");
        expect(result.title).toBe("Le follie dell'imperatore - The Emperor's New Groove");
    });
    test('remove chinese alt title', () => {
        const result = (0, index_1.parseTorrentTitle)('[NC-Raws] 间谍过家家 / SPY×FAMILY - 04 (B-Global 1920x1080 HEVC AAC MKV)');
        expect(result.title).toBe('SPY×FAMILY');
    });
    test('remove ep range in parenthesis', () => {
        const result = (0, index_1.parseTorrentTitle)('GTO (Great Teacher Onizuka) (Ep. 1-43) Sub 480p lakshay');
        expect(result.title).toBe('GTO (Great Teacher Onizuka)');
    });
    test('not fully remove partially russian title', () => {
        const result = (0, index_1.parseTorrentTitle)('Книгоноши / Кнiганошы (1987) TVRip от AND03AND | BLR');
        expect(result.title).toBe('Кнiганошы');
    });
    test('remove extension fully', () => {
        const result = (0, index_1.parseTorrentTitle)('Yurusarezaru_mono2.srt');
        expect(result.title).toBe('Yurusarezaru mono2');
    });
    test('not detect season prefix in title', () => {
        const result = (0, index_1.parseTorrentTitle)('COMPASS2.0.ANIMATION.PROJECT.S01E02.Will.You.Be.My.Partner.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv');
        expect(result.title).toBe('COMPASS2 0 ANIMATION PROJECT');
    });
    test('www.1TamilMV.world - Ayalaan (2024) Tamil PreDVD - 1080p - x264 - HQ Clean Aud - 2.5GB.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('www.1TamilMV.world - Ayalaan (2024) Tamil PreDVD - 1080p - x264 - HQ Clean Aud - 2.5GB.mkv');
        expect(result.title).toBe('Ayalaan');
    });
    test('www.Torrenting.com   -    Anatomy Of A Fall (2023)', () => {
        const result = (0, index_1.parseTorrentTitle)('www.Torrenting.com   -    Anatomy Of A Fall (2023)');
        expect(result.title).toBe('Anatomy Of A Fall');
    });
    test('[www.arabp2p.net]_-_تركي مترجم ومدبلج Last.Call.for.Istanbul.2023.1080p.NF.WEB-DL.DDP5.1.H.264.MKV.torrent', () => {
        const result = (0, index_1.parseTorrentTitle)('[www.arabp2p.net]_-_تركي مترجم ومدبلج Last.Call.for.Istanbul.2023.1080p.NF.WEB-DL.DDP5.1.H.264.MKV.torrent');
        expect(result.title).toBe('Last Call for Istanbul');
    });
    test('www,1TamilMV.phd - The Great Indian Suicide (2023) Tamil TRUE WEB-DL - 4K SDR - HEVC - (DD+5.1 - 384Kbps & AAC) - 3.2GB - ESub.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('www,1TamilMV.phd - The Great Indian Suicide (2023) Tamil TRUE WEB-DL - 4K SDR - HEVC - (DD+5.1 - 384Kbps & AAC) - 3.2GB - ESub.mkv');
        expect(result.title).toBe('The Great Indian Suicide');
    });
    test('ww.Tamilblasters.sbs - 8 Bit Christmas (2021) HQ HDRip - x264 - Telugu (Fan Dub) - 400MB].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('ww.Tamilblasters.sbs - 8 Bit Christmas (2021) HQ HDRip - x264 - Telugu (Fan Dub) - 400MB].mkv');
        expect(result.title).toBe('8 Bit Christmas');
    });
    test('www.1TamilMV.pics - 777 Charlie (2022) Tamil HDRip - 720p - x264 - HQ Clean Aud - 1.4GB.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('www.1TamilMV.pics - 777 Charlie (2022) Tamil HDRip - 720p - x264 - HQ Clean Aud - 1.4GB.mkv');
        expect(result.title).toBe('777 Charlie');
    });
    test('Despicable.Me.4.2024.D.TELESYNC_14OOMB.avi', () => {
        const result = (0, index_1.parseTorrentTitle)('Despicable.Me.4.2024.D.TELESYNC_14OOMB.avi');
        expect(result.title).toBe('Despicable Me 4');
    });
    test('UFC.247.PPV.Jones.vs.Reyes.HDTV.x264-PUNCH[TGx]', () => {
        const result = (0, index_1.parseTorrentTitle)('UFC.247.PPV.Jones.vs.Reyes.HDTV.x264-PUNCH[TGx]');
        expect(result.title).toBe('UFC 247 Jones vs Reyes');
    });
    test('[www.1TamilMV.pics]_The.Great.Indian.Suicide.2023.Tamil.TRUE.WEB-DL.4K.SDR.HEVC.(DD+5.1.384Kbps.&.AAC).3.2GB.ESub.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('[www.1TamilMV.pics]_The.Great.Indian.Suicide.2023.Tamil.TRUE.WEB-DL.4K.SDR.HEVC.(DD+5.1.384Kbps.&.AAC).3.2GB.ESub.mkv');
        expect(result.title).toBe('The Great Indian Suicide');
    });
    test('Game of Thrones - S02E07 - A Man Without Honor [2160p] [HDR] [5.1, 7.1, 5.1] [ger, eng, eng] [Vio].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Game of Thrones - S02E07 - A Man Without Honor [2160p] [HDR] [5.1, 7.1, 5.1] [ger, eng, eng] [Vio].mkv');
        expect(result.title).toBe('Game of Thrones');
    });
    test('Pawn.Stars.S09E13.1080p.HEVC.x265-MeGusta', () => {
        const result = (0, index_1.parseTorrentTitle)('Pawn.Stars.S09E13.1080p.HEVC.x265-MeGusta');
        expect(result.title).toBe('Pawn Stars');
    });
    test('Pawn Stars -- 4x13 -- Broadsiding Lincoln.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Pawn Stars -- 4x13 -- Broadsiding Lincoln.mkv');
        expect(result.title).toBe('Pawn Stars');
    });
    test('Pawn Stars S04E19 720p WEB H264-BeechyBoy mp4', () => {
        const result = (0, index_1.parseTorrentTitle)('Pawn Stars S04E19 720p WEB H264-BeechyBoy mp4');
        expect(result.title).toBe('Pawn Stars');
    });
    test('Jurassic.World.Dominion.CUSTOM.EXTENDED.2022.2160p.MULTi.VF2.UHD.Blu-ray.REMUX.HDR.DoVi.HEVC.DTS-X.DTS-HDHRA.7.1-MOONLY.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Jurassic.World.Dominion.CUSTOM.EXTENDED.2022.2160p.MULTi.VF2.UHD.Blu-ray.REMUX.HDR.DoVi.HEVC.DTS-X.DTS-HDHRA.7.1-MOONLY.mkv');
        expect(result.title).toBe('Jurassic World Dominion');
    });
    test('www.Torrenting.com   -    14.Peaks.Nothing.Is.Impossible.2021.1080p.WEB.h264-RUMOUR', () => {
        const result = (0, index_1.parseTorrentTitle)('www.Torrenting.com   -    14.Peaks.Nothing.Is.Impossible.2021.1080p.WEB.h264-RUMOUR');
        expect(result.title).toBe('14 Peaks Nothing Is Impossible');
    });
    test('Too Many Cooks _ Adult Swim.mp4', () => {
        const result = (0, index_1.parseTorrentTitle)('Too Many Cooks _ Adult Swim.mp4');
        expect(result.title).toBe('Too Many Cooks');
    });
    test('О мышах и людях (Of Mice and Men) 1992 BDRip 1080p.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('О мышах и людях (Of Mice and Men) 1992 BDRip 1080p.mkv');
        expect(result.title).toBe('Of Mice and Men');
    });
    test('Wonder Woman 1984 (2020) [UHDRemux 2160p DoVi P8 Es-DTSHD AC3 En-AC3].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Wonder Woman 1984 (2020) [UHDRemux 2160p DoVi P8 Es-DTSHD AC3 En-AC3].mkv');
        expect(result.title).toBe('Wonder Woman 1984');
    });
    test('www.TamilBlasters.cam - Titanic (1997)[1080p BDRip - Org Auds - [Tamil + Telugu + Hindi + Eng] - x264 - DD5.1 (448 Kbps) - 4.7GB - ESubs].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('www.TamilBlasters.cam - Titanic (1997)[1080p BDRip - Org Auds - [Tamil + Telugu + Hindi + Eng] - x264 - DD5.1 (448 Kbps) - 4.7GB - ESubs].mkv');
        expect(result.title).toBe('Titanic');
    });
    test('S.W.A.T.2017.S08E01.720p.HDTV.x264-SYNCOPY[TGx]', () => {
        const result = (0, index_1.parseTorrentTitle)('S.W.A.T.2017.S08E01.720p.HDTV.x264-SYNCOPY[TGx]');
        expect(result.title).toBe('S W A T');
    });
    test('Grimm.INTEGRAL.MULTI.COMPLETE.BLURAY-BMTH', () => {
        const result = (0, index_1.parseTorrentTitle)('Grimm.INTEGRAL.MULTI.COMPLETE.BLURAY-BMTH');
        expect(result.title).toBe('Grimm');
    });
    test('Friends.1994.INTEGRALE.MULTI.1080p.WEB-DL.H265-FTMVHD', () => {
        const result = (0, index_1.parseTorrentTitle)('Friends.1994.INTEGRALE.MULTI.1080p.WEB-DL.H265-FTMVHD');
        expect(result.title).toBe('Friends');
    });
    test('STEVE.martin.a.documentary.in.2.pieces.S01.COMPLETE.1080p.WEB.H264-SuccessfulCrab[TGx]', () => {
        const result = (0, index_1.parseTorrentTitle)('STEVE.martin.a.documentary.in.2.pieces.S01.COMPLETE.1080p.WEB.H264-SuccessfulCrab[TGx]');
        expect(result.title).toBe('STEVE martin a documentary in 2 pieces');
    });
    test('The Lockerbie Bombing (2013) Documentary HDTVRIP', () => {
        const result = (0, index_1.parseTorrentTitle)('The Lockerbie Bombing (2013) Documentary HDTVRIP');
        expect(result.title).toBe('The Lockerbie Bombing');
    });
    test('The French Connection 1971 Remastered BluRay 1080p REMUX AVC DTS-HD MA 5 1-LEGi0N', () => {
        const result = (0, index_1.parseTorrentTitle)('The French Connection 1971 Remastered BluRay 1080p REMUX AVC DTS-HD MA 5 1-LEGi0N');
        expect(result.title).toBe('The French Connection');
    });
});
