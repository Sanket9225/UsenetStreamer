"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
// Helper function to create integer ranges
function intRange(start, end) {
    const nums = [];
    for (let i = start; i <= end; i++) {
        nums.push(i);
    }
    return nums;
}
describe('Episode Detection Tests', () => {
    // Basic episode tests
    test('regular episode', () => {
        const result = (0, index_1.parseTorrentTitle)('The Simpsons S28E21 720p HDTV x264-AVS');
        expect(result.episodes).toEqual([21]);
    });
    test('regular episode with lowercase', () => {
        const result = (0, index_1.parseTorrentTitle)('breaking.bad.s01e01.720p.bluray.x264-reward');
        expect(result.episodes).toEqual([1]);
    });
    test('regular season with O instead of zero', () => {
        const result = (0, index_1.parseTorrentTitle)('Arrested Development SO2E04.avi');
        expect(result.episodes).toEqual([4]);
    });
    test('regular episode with a space between', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball Super S01 E23 French 1080p HDTV H264-Kesni');
        expect(result.episodes).toEqual([23]);
    });
    test('regular episode above 1000', () => {
        const result = (0, index_1.parseTorrentTitle)('One.Piece.S01E1116.Lets.Go.Get.It!.Buggys.Big.Declaration.2160p.B-Global.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv');
        expect(result.episodes).toEqual([1116]);
    });
    test('regular episode without e symbol after season', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Witcher.S01.07.2019.Dub.AVC.ExKinoRay.mkv');
        expect(result.episodes).toEqual([7]);
    });
    test('regular episode with season symbol but wihout episode symbol', () => {
        const result = (0, index_1.parseTorrentTitle)('Vikings.s02.09.AVC.tahiy.mkv');
        expect(result.episodes).toEqual([9]);
    });
    test('regular episode with a letter a suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('The Twilight Zone 1985 S01E23a Shadow Play.mp4');
        expect(result.episodes).toEqual([23]);
    });
    test('regular episode without break at the end', () => {
        const result = (0, index_1.parseTorrentTitle)('Desperate_housewives_S03E02Le malheur aime la compagnie.mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('regular episode with a letter b suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('Mash S10E01b Thats Show Biz Part 2 1080p H.264 (moviesbyrizzo upload).mp4');
        expect(result.episodes).toEqual([1]);
    });
    test('regular episode with a letter c suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('The Twilight Zone 1985 S01E22c The Library.mp4');
        expect(result.episodes).toEqual([22]);
    });
    test('regular episode without e separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Desperate.Housewives.S0615.400p.WEB-DL.Rus.Eng.avi');
        expect(result.episodes).toEqual([15]);
    });
    test('episode with SxEE format correctly', () => {
        const result = (0, index_1.parseTorrentTitle)('Doctor.Who.2005.8x11.Dark.Water.720p.HDTV.x264-FoV');
        expect(result.episodes).toEqual([11]);
    });
    test('episode when written as such', () => {
        const result = (0, index_1.parseTorrentTitle)('Anubis saison 01 episode 38 tvrip FR');
        expect(result.episodes).toEqual([38]);
    });
    test('episode when written as such shortened', () => {
        const result = (0, index_1.parseTorrentTitle)("Le Monde Incroyable de Gumball - Saison 5 Ep 14 - L'extérieur");
        expect(result.episodes).toEqual([14]);
    });
    test('episode with parenthesis prefix and x separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Smallville (1x02 Metamorphosis).avi');
        expect(result.episodes).toEqual([2]);
    });
    test('episode with x separator and letter on left', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Man.In.The.High.Castle1x01.HDTV.XviD[www.DivxTotaL.com].avi');
        expect(result.episodes).toEqual([1]);
    });
    test('episode with x separator and letter on right', () => {
        const result = (0, index_1.parseTorrentTitle)('clny.3x11m720p.es[www.planetatorrent.com].mkv');
        expect(result.episodes).toEqual([11]);
    });
    // Season and episode tests
    test('episode when similar digits included', () => {
        const result = (0, index_1.parseTorrentTitle)("Friends.S07E20.The.One.With.Rachel's.Big.Kiss.720p.BluRay.2CH.x265.HEVC-PSA.mkv");
        expect(result.seasons).toEqual([7]);
        expect(result.episodes).toEqual([20]);
    });
    test('episode when separated with x and inside brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('Friends - [8x18] - The One In Massapequa.mkv');
        expect(result.seasons).toEqual([8]);
        expect(result.episodes).toEqual([18]);
    });
    test('episode when separated with X', () => {
        const result = (0, index_1.parseTorrentTitle)('Archivo 81 1X7 HDTV XviD Castellano.avi');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([7]);
    });
    test('multiple episodes with x prefix and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)("Friends - [7x23-24] - The One with Monica and Chandler's Wedding + Audio Commentary.mkv");
        expect(result.seasons).toEqual([7]);
        expect(result.episodes).toEqual([23, 24]);
    });
    test('episode when separated with x and has three digit episode', () => {
        const result = (0, index_1.parseTorrentTitle)('Yu-Gi-Oh 3x089 - Awakening of Evil (Part 4).avi');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([89]);
    });
    // Multiple episodes tests
    test('multiple episodes with hyphen no spaces separator', () => {
        const result = (0, index_1.parseTorrentTitle)('611-612 - Desperate Measures, Means & Ends.mp4');
        expect(result.episodes).toEqual([611, 612]);
    });
    test('multiple single episode with 10-bit notation in it', () => {
        const result = (0, index_1.parseTorrentTitle)('[Final8]Suisei no Gargantia - 05 (BD 10-bit 1920x1080 x264 FLAC)[E0B15ACF].mkv');
        expect(result.episodes).toEqual([5]);
    });
    test('multiple episodes with episodes prefix and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Orange Is The New Black Season 5 Episodes 1-10 INCOMPLETE (LEAKED)');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
    test('multiple episodes with ep prefix and hyphen separator inside parentheses', () => {
        const result = (0, index_1.parseTorrentTitle)('Vikings.Season.05.Ep(01-10).720p.WebRip.2Ch.x265.PSA');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
    test('multiple episodes with hyphen separator and follower by open parenthesis', () => {
        const result = (0, index_1.parseTorrentTitle)('[TBox] Dragon Ball Z Full 1-291(Subbed Jap Vers)');
        expect(result.episodes).toEqual(intRange(1, 291));
    });
    test('multiple episodes with e prefix and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)("Marvel's.Agents.of.S.H.I.E.L.D.S02E01-03.Shadows.1080p.WEB-DL.DD5.1");
        expect(result.episodes).toEqual([1, 2, 3]);
    });
    // Absolute episode tests
    test('absolute episode with ep prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('Naruto Shippuden Ep 107 - Strange Bedfellows.mkv');
        expect(result.episodes).toEqual([107]);
    });
    test('absolute episode in middle with hyphen dividers', () => {
        const result = (0, index_1.parseTorrentTitle)('Naruto Shippuden - 107 - Strange Bedfellows.mkv');
        expect(result.episodes).toEqual([107]);
    });
    test('absolute episode in middle with similar resolution value', () => {
        const result = (0, index_1.parseTorrentTitle)('[AnimeRG] Naruto Shippuden - 107 [720p] [x265] [pseudo].mkv');
        expect(result.episodes).toEqual([107]);
    });
    test('multiple absolute episodes separated by hyphen', () => {
        const result = (0, index_1.parseTorrentTitle)('Naruto Shippuuden - 006-007.mkv');
        expect(result.episodes).toEqual([6, 7]);
    });
    test('absolute episode correctly not hindered by title digits with hashtag', () => {
        const result = (0, index_1.parseTorrentTitle)('321 - Family Guy Viewer Mail #1.avi');
        expect(result.episodes).toEqual([321]);
    });
    test('absolute episode correctly not hindered by title digits with apostrophe', () => {
        const result = (0, index_1.parseTorrentTitle)("512 - Airport '07.avi");
        expect(result.episodes).toEqual([512]);
    });
    test('absolute episode at the begining even though its mixed with season', () => {
        const result = (0, index_1.parseTorrentTitle)('102 - The Invitation.avi');
        expect(result.episodes).toEqual([102]);
    });
    test('absolute episode double digit at the beginning', () => {
        const result = (0, index_1.parseTorrentTitle)('02 The Invitation.mp4');
        expect(result.episodes).toEqual([2]);
    });
    test('absolute episode triple digit at the beginning with zero padded', () => {
        const result = (0, index_1.parseTorrentTitle)('004 - Male Unbonding - [DVD].avi');
        expect(result.episodes).toEqual([4]);
    });
    test('multiple absolute episodes separated by comma', () => {
        const result = (0, index_1.parseTorrentTitle)('The Amazing World of Gumball - 103, 104 - The Third - The Debt.mkv');
        expect(result.episodes).toEqual([103, 104]);
    });
    test('absolute episode with a possible match at the end', () => {
        const result = (0, index_1.parseTorrentTitle)('The Amazing World of Gumball - 103 - The End - The Dress (720p.x264.ac3-5.1) [449].mkv');
        expect(result.episodes).toEqual([103]);
    });
    test('absolute episode with a divided episode into a part', () => {
        const result = (0, index_1.parseTorrentTitle)('The Amazing World of Gumball - 107a - The Mystery (720p.x264.ac3-5.1) [449].mkv');
        expect(result.episodes).toEqual([107]);
    });
    test('absolute episode with a divided episode into b part', () => {
        const result = (0, index_1.parseTorrentTitle)('The Amazing World of Gumball - 107b - The Mystery (720p.x264.ac3-5.1) [449].mkv');
        expect(result.episodes).toEqual([107]);
    });
    test('episode withing brackets with dot separator', () => {
        const result = (0, index_1.parseTorrentTitle)('[5.01] Weight Loss.avi');
        expect(result.episodes).toEqual([1]);
    });
    test('episode in hundreds withing brackets with dot separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball [5.134] Preliminary Peril.mp4');
        expect(result.episodes).toEqual([134]);
    });
    test('episode with spaces and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('S01 - E03 - Fifty-Fifty.mkv');
        expect(result.episodes).toEqual([3]);
    });
    test('multiple episodes separated with plus', () => {
        const result = (0, index_1.parseTorrentTitle)('The Office S07E25+E26 Search Committee.mp4');
        expect(result.episodes).toEqual([25, 26]);
    });
    test('anime episode with underscore suffix 1', () => {
        const result = (0, index_1.parseTorrentTitle)('[animeawake] Naruto Shippuden - 124 - Art_2.mkv');
        expect(result.episodes).toEqual([124]);
    });
    test('anime episode with underscore suffix 2', () => {
        const result = (0, index_1.parseTorrentTitle)('[animeawake] Naruto Shippuden - 072 - The Quietly Approaching Threat_2.mkv');
        expect(result.episodes).toEqual([72]);
    });
    test('anime episode with long title', () => {
        const result = (0, index_1.parseTorrentTitle)("[animeawake] Naruto Shippuden - 120 - Kakashi Chronicles. Boys' Life on the Battlefield. Part 2.mkv");
        expect(result.episodes).toEqual([120]);
    });
    // Negative tests
    test('single episode even when a possible range identifier hyphen is present', () => {
        const result = (0, index_1.parseTorrentTitle)('Supernatural - S03E01 - 720p BluRay x264-Belex - Dual Audio + Legenda.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('not episodes when the range is for season', () => {
        const result = (0, index_1.parseTorrentTitle)('[F-D] Fairy Tail Season 1 -6 + Extras [480P][Dual-Audio]');
        expect(result.episodes).toBeUndefined();
    });
    test('not episodes when the range is for seasons', () => {
        const result = (0, index_1.parseTorrentTitle)('House MD All Seasons (1-8) 720p Ultra-Compressed');
        expect(result.episodes).toBeUndefined();
    });
    test('not episode when it indicates sequence of the movie in between hyhen separators', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball Z Movie - 09 - Bojack Unbound - 1080p');
        expect(result.episodes).toBeUndefined();
    });
    test('not episode when it indicates sequence of the movie at the start', () => {
        const result = (0, index_1.parseTorrentTitle)('09 Movie - Dragon Ball Z - Bojack Unbound');
        expect(result.episodes).toBeUndefined();
    });
    test('detect episode with x separator and e prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('24 - S01xE03.mp4');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([3]);
    });
    test('detect episode correctly and not episode range ', () => {
        const result = (0, index_1.parseTorrentTitle)('24 - S01E04 - x264 - dilpill.mkv');
        expect(result.episodes).toEqual([4]);
    });
    test('detect episode correctly and not episode range with two codecs', () => {
        const result = (0, index_1.parseTorrentTitle)('24.Legacy.S01E05.720p.HEVC.x265-MeGusta');
        expect(result.episodes).toEqual([5]);
    });
    test('detect absolute episode with a version', () => {
        const result = (0, index_1.parseTorrentTitle)('[F-D] Fairy.Tail.-.004v2.-. [480P][Dual-Audio].mkv');
        expect(result.episodes).toEqual([4]);
    });
    test('detect absolute episode with dot separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon.Ball.Z.013.480p.DBox.DVD.REGRADE.Dual-Audio.FLAC2.0.x264-SoM.mkv');
        expect(result.episodes).toEqual([13]);
    });
    test('detect absolute episode with dot separator 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon.Ball.001.DBOX.CC.480p.x264-SoM.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('detect correct episode with 3 digit number in title', () => {
        const result = (0, index_1.parseTorrentTitle)('The.100.S01E01.Pilot.1080p.AVC.DTS-HD.MA.5.1.REMUX-FraMeSToR.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('dont detect episode from 3 digit number in title', () => {
        const result = (0, index_1.parseTorrentTitle)('The.100.2025.1080p.AMZN.WEB-DL.MULTI.AAC2.0.H.265-Telly.mkv');
        expect(result.episodes).toBeUndefined();
    });
    test('detect absolute episode with dot separator with a version', () => {
        const result = (0, index_1.parseTorrentTitle)('Naruto.001.v4.480p.DVD.Dual-Audio.FLAC2.0.Hi10P.x264-JySzE.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('detect anime episode when title contains number range', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] 2-5 Jigen no Ririsa - 08 [480p][Multiple Subtitle][972D0669].mkv');
        expect(result.episodes).toEqual([8]);
    });
    test('detect absolute episode with a version and ep suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('[Exiled-Destiny]_Tokyo_Underground_Ep02v2_(41858470).mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('detect absolute episode and not detect any season modifier', () => {
        const result = (0, index_1.parseTorrentTitle)('[a-s]_fairy_tail_-_003_-_infiltrate_the_everlue_mansion__rs2_[1080p_bd-rip][4CB16872].mkv');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([3]);
    });
    test('episode after season with separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Food Wars! Shokugeki No Souma S4 - 11 (1080p)(HEVC x265 10bit)');
        expect(result.episodes).toEqual([11]);
    });
    test('not episode range for mismatch episode marker e vs ep', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball Super S05E53 - Ep.129.mkv');
        expect(result.episodes).toEqual([53]);
    });
    test('not episode range with other parameter ending', () => {
        const result = (0, index_1.parseTorrentTitle)('DShaun.Micallefs.MAD.AS.HELL.S10E03.576p.x642-YADNUM.mkv');
        expect(result.episodes).toEqual([3]);
    });
    test('not episode range with spaced hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('The Avengers (EMH) - S01 E15 - 459 (1080p - BluRay).mp4');
        expect(result.episodes).toEqual([15]);
    });
    test('episode with a dot and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('My Little Pony FiM - 6.01 - No Second Prances.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('season with a dot and episode prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('Desperate Housewives - Episode 1.22 - Goodbye for now.avi');
        expect(result.episodes).toEqual([22]);
    });
    test('season with a dot and episode prefix v2', () => {
        const result = (0, index_1.parseTorrentTitle)('All of Us Are Dead . 2022 . S01 EP #1.2.mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('episode with number in a title', () => {
        const result = (0, index_1.parseTorrentTitle)('Mob Psycho 100 - 09 [1080p].mkv');
        expect(result.episodes).toEqual([9]);
    });
    test('episode with number and a hyphen after it in a title', () => {
        const result = (0, index_1.parseTorrentTitle)('3-Nen D-Gumi Glass no Kamen - 13 [480p]');
        expect(result.episodes).toEqual([13]);
    });
    test('episode with of separator', () => {
        const result = (0, index_1.parseTorrentTitle)('BBC Indian Ocean with Simon Reeve 5of6 Sri Lanka to Bangladesh.avi');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5]);
    });
    test('episode with of separator v1', () => {
        const result = (0, index_1.parseTorrentTitle)('Witches Of Salem - 2Of4 - Road To Hell - Gr.mkv');
        expect(result.episodes).toEqual([1, 2]);
    });
    test('episode with of separator v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Das Boot Miniseries Original Uncut-Reevel Cd2 Of 3.avi');
        expect(result.episodes).toEqual([1, 2]);
    });
    test('multiple episodes with multiple E sign and no separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Stargate Universe S01E01E02E03.mp4');
        expect(result.episodes).toEqual([1, 2, 3]);
    });
    test('multiple episodes with multiple E sign and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Stargate Universe S01E01-E02-E03.mp4');
        expect(result.episodes).toEqual([1, 2, 3]);
    });
    test('multiple episodes with eps prefix and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('MARATHON EPISODES/Orphan Black S3 Eps.05-08.mp4');
        expect(result.episodes).toEqual([5, 6, 7, 8]);
    });
    test('multiple episodes with E sign and hyphen spaced separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Pokemon Black & White E10 - E17 [CW] AVI');
        expect(result.episodes).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    });
    test('multiple episodes with E sign and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Pokémon.S01E01-E04.SWEDISH.VHSRip.XviD-aka');
        expect(result.episodes).toEqual([1, 2, 3, 4]);
    });
    test('episode with single episode and not range', () => {
        const result = (0, index_1.parseTorrentTitle)('[HorribleSubs] White Album 2 - 06 [1080p].mkv');
        expect(result.episodes).toEqual([6]);
    });
    test('episode with E symbols without season', () => {
        const result = (0, index_1.parseTorrentTitle)('Mob.Psycho.100.II.E10.720p.WEB.x264-URANiME.mkv');
        expect(result.episodes).toEqual([10]);
    });
    test('episode with E symbols without season v2', () => {
        const result = (0, index_1.parseTorrentTitle)('E5.mkv');
        expect(result.episodes).toEqual([5]);
    });
    test('episode without season', () => {
        const result = (0, index_1.parseTorrentTitle)('[OMDA] Bleach - 002 (480p x264 AAC) [rich_jc].mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('episode with a episode code including multiple numbers', () => {
        const result = (0, index_1.parseTorrentTitle)('[ACX]El_Cazador_de_la_Bruja_-_19_-_A_Man_Who_Protects_[SSJ_Saiyan_Elite]_[9E199846].mkv');
        expect(result.episodes).toEqual([19]);
    });
    test('multiple episodes with x episode marker and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('BoJack Horseman [06x01-08 of 16] (2019-2020) WEB-DLRip 720p');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    // Russian language tests
    test('multiple episodes with russian episode marker and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Мистер Робот / Mr. Robot / Сезон: 2 / Серии: 1-5 (12) [2016, США, WEBRip 1080p] MVO');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5]);
    });
    test('episode with russian episode marker and single episode', () => {
        const result = (0, index_1.parseTorrentTitle)('Викинги / Vikings / Сезон: 5 / Серии: 1 [2017, WEB-DL 1080p] MVO');
        expect(result.episodes).toEqual([1]);
    });
    test('episode with russian episode marker and single episode and with total episodes value', () => {
        const result = (0, index_1.parseTorrentTitle)('Викинги / Vikings / Сезон: 5 / Серии: 1 из 20 [2017, WEB-DL 1080p] MVO');
        expect(result.episodes).toEqual([1]);
    });
    test('episode with russian arabic total episodes value separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Prehistoric park.3iz6.Supercroc.DVDRip.Xvid.avi');
        expect(result.episodes).toEqual([1, 2, 3]);
    });
    test('episode with shortened russian episode name', () => {
        const result = (0, index_1.parseTorrentTitle)('Меч (05 сер.) - webrip1080p.mkv');
        expect(result.episodes).toEqual([5]);
    });
    test('episode with full russian episode name', () => {
        const result = (0, index_1.parseTorrentTitle)('Серия 11.mkv');
        expect(result.episodes).toEqual([11]);
    });
    test('episode with full different russian episode name', () => {
        const result = (0, index_1.parseTorrentTitle)('Разрушители легенд. MythBusters. Сезон 15. Эпизод 09. Скрытая угроза (2015).avi');
        expect(result.episodes).toEqual([9]);
    });
    test('episode with full different russian episode name v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Леди Баг и Супер-Кот – Сезон 3, Эпизод 21 – Кукловод 2 [1080p].mkv');
        expect(result.episodes).toEqual([21]);
    });
    test('episode with full russian episode name with case suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('Проклятие острова ОУК_ 5-й сезон 09-я серия_ Прорыв Дэна.avi');
        expect(result.episodes).toEqual([9]);
    });
    test('episode with full russian episode name and no prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('Интерны. Сезон №9. Серия №180.avi');
        expect(result.episodes).toEqual([180]);
    });
    test('episode with russian episode name in non kirilica', () => {
        const result = (0, index_1.parseTorrentTitle)('Tajny.sledstviya-20.01.serya.WEB-DL.(1080p).by.lunkin.mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('episode with russian episode name in non kirilica alternative 2', () => {
        const result = (0, index_1.parseTorrentTitle)('Zvezdnie.Voiny.Voina.Klonov.3.sezon.22.seria.iz.22.XviD.HDRip.avi');
        expect(result.episodes).toEqual([22]);
    });
    test('season with russian episode shortened word', () => {
        const result = (0, index_1.parseTorrentTitle)('Otchayannie.domochozyaiki.(8.sez.21.ser.iz.23).2012.XviD.HDTVRip.avi');
        expect(result.episodes).toEqual([21]);
    });
    test('episode with russian episode name in non kirilica alternative 3', () => {
        const result = (0, index_1.parseTorrentTitle)('MosGaz.(08.seriya).2012.WEB-DLRip(AVC).ExKinoRay.mkv');
        expect(result.episodes).toEqual([8]);
    });
    test('episode with russian episode name in non kirilica alternative 5', () => {
        const result = (0, index_1.parseTorrentTitle)('Tajny.sledstvija.(2.sezon.12.serija.iz.12).2002.XviD.DVDRip.avi');
        expect(result.episodes).toEqual([12]);
    });
    test('episodes with russian x separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Discovery. Парни с Юкона / Yokon Men [06х01-08] (2017) HDTVRip от GeneralFilm | P1');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    test('episodes with hyphen separator between episode', () => {
        const result = (0, index_1.parseTorrentTitle)('2-06. Девичья сила.mkv');
        expect(result.episodes).toEqual([6]);
    });
    test('episodes with hyphen separator between episode v2', () => {
        const result = (0, index_1.parseTorrentTitle)('4-13 Cursed (HD).m4v');
        expect(result.episodes).toEqual([13]);
    });
    test("not episodes with hyphen separator between episode when it's date", () => {
        const result = (0, index_1.parseTorrentTitle)('The Ed Show 10-19-12.mp4');
        expect(result.episodes).toBeUndefined();
        expect(result.date).toBe('2012-10-19');
    });
    test("not episodes with hyphen separator between episode when it's not supported date", () => {
        const result = (0, index_1.parseTorrentTitle)("Hogan's Heroes - 516 - Get Fit or Go Flight - 1-09-70.divx");
        expect(result.episodes).toEqual([516]);
    });
    test('episodes with hyphen separator between episode v3', () => {
        const result = (0, index_1.parseTorrentTitle)('Доктор Хаус 03-20.mkv');
        expect(result.episodes).toEqual([20]);
    });
    test('episodes with hyphen separator between episode v4', () => {
        const result = (0, index_1.parseTorrentTitle)('Комиссар Рекс 11-13.avi');
        expect(result.episodes).toEqual([13]);
    });
    test('episode after ordinal season and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Kyoukai no Rinne (TV) 3rd Season - 23 [1080p]');
        expect(result.episodes).toEqual([23]);
    });
    test('episode after ordinal season and hyphen separator and multiple spaces', () => {
        const result = (0, index_1.parseTorrentTitle)('[224] Shingeki no Kyojin - S03 - Part 1 -  13 [BDRip.1080p.x265.FLAC].mkv');
        expect(result.episodes).toEqual([13]);
    });
    // Spanish language tests
    test('spanish full episode identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('El Chema Temporada 1 Capitulo 25');
        expect(result.episodes).toEqual([25]);
    });
    test('spanish partial episode identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('Juego de Tronos - Temp.2 [ALTA DEFINICION 720p][Cap.209][Spanish].mkv');
        expect(result.episodes).toEqual([209]);
    });
    test('spanish partial long episode identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('Blue Bloods - Temporada 11 [HDTV 720p][Cap.1103][AC3 5.1 Castellano][www.PCTmix.com].mkv');
        expect(result.episodes).toEqual([1103]);
    });
    test('spanish partial episode identifier with common typo', () => {
        const result = (0, index_1.parseTorrentTitle)('Para toda la humanidad [4k 2160p][Caap.406](wolfmax4k.com).mkv');
        expect(result.episodes).toEqual([406]);
    });
    test('spanish partial episode identifier v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Mazinger-Z-Cap-52.avi');
        expect(result.episodes).toEqual([52]);
    });
    test('latino full episode identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('Yu-Gi-Oh! ZEXAL Temporada 1 Episodio 009 Dual Latino e Inglés [B3B4970E].mkv');
        expect(result.episodes).toEqual([9]);
    });
    test('spanish multiple episode identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('Bleach 10º Temporada - 215 ao 220 - [DB-BR]');
        expect(result.episodes).toEqual([215, 216, 217, 218, 219, 220]);
    });
    test('spanish short season identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('My Little Pony - A Amizade é Mágica - T02E22.mp4');
        expect(result.episodes).toEqual([22]);
    });
    test('spanish short season identifier with xe separator', () => {
        const result = (0, index_1.parseTorrentTitle)('30 M0N3D4S ESP T01XE08.mkv');
        expect(result.episodes).toEqual([8]);
    });
    test('not episode in episode checksum code', () => {
        const result = (0, index_1.parseTorrentTitle)('[CBM]_Medaka_Box_-_11_-_This_Is_the_End!!_[720p]_[436E0E90].mkv');
        expect(result.episodes).toEqual([11]);
    });
    test('not episode in episode checksum code without container', () => {
        const result = (0, index_1.parseTorrentTitle)('[CBM]_Medaka_Box_-_11_-_This_Is_the_End!!_[720p]_[436E0E90]');
        expect(result.episodes).toEqual([11]);
    });
    test('not episode in episode checksum code with paranthesis', () => {
        const result = (0, index_1.parseTorrentTitle)('(Hi10)_Re_Zero_Shin_Henshuu-ban_-_02v2_(720p)_(DDY)_(72006E34).mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('not episode before season', () => {
        const result = (0, index_1.parseTorrentTitle)('22-7 (Season 1) (1080p)(HEVC x265 10bit)(Eng-Subs)-Judas[TGx] ⭐');
        expect(result.episodes).toBeUndefined();
    });
    test('multiple episode with tilde separator', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Carole and Tuesday - 01 ~ 12 [1080p][Multiple Subtitle]');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
    test('multiple episode with tilde separator and season prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] 3D Kanojo - Real Girl 2nd Season - 01 ~ 12 [720p]');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
    test('multiple episode with hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('[FFA] Koi to Producer: EVOL×LOVE - 01 - 12 [1080p][HEVC][AAC]');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
    test('multiple episode with hyphen separator between parenthesis', () => {
        const result = (0, index_1.parseTorrentTitle)("[BenjiD] Quan Zhi Gao Shou (The King's Avatar) / Full-Time Master S01 (01 - 12) [1080p x265] [Soft sub] V2");
        expect(result.episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
    test('episode with russian singular episode marker', () => {
        const result = (0, index_1.parseTorrentTitle)('Викинги / Vikings / Сезон: 5 / Серия: 1 [2017, WEB-DL 1080p] MVO');
        expect(result.episodes).toEqual([1]);
    });
    test('multiple episodes with russian episode marker and total episodes value', () => {
        const result = (0, index_1.parseTorrentTitle)('Викинги / Vikings / Сезон: 5 / Серии: 5 из 20 [2017, WEB-DL 1080p] MVO');
        expect(result.episodes).toEqual([1, 2, 3, 4, 5]);
    });
    // More complex anime tests
    test('anime with season episode format in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('[HR] Boku no Hero Academia 87 (S4-24) [1080p HEVC Multi-Subs] HR-GZ');
        expect(result.episodes).toEqual([24]);
    });
    test('anime with season episode format in brackets v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Tokyo Ghoul Root A - 07 [S2-07] [Eng Sub] 480p [email protected]');
        expect(result.episodes).toEqual([7]);
    });
    test('episode with unusual codec format', () => {
        const result = (0, index_1.parseTorrentTitle)('black-ish.S05E02.1080p..x265.10bit.EAC3.6.0-Qman[UTR].mkv');
        expect(result.episodes).toEqual([2]);
    });
    test('episode with hash prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('[Eng Sub] Rebirth Ep #36 [8CF3ADFA].mkv');
        expect(result.episodes).toEqual([36]);
    });
    test('anime with group number prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('[92 Impatient Eilas & Miyafuji] Strike Witches - Road to Berlin - 01 [1080p][BCDFF6A2].mkv');
        expect(result.episodes).toEqual([1]);
    });
    test('anime with number prefix in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('[224] Darling in the FranXX - 14 [BDRip.1080p.x265.FLAC].mkv');
        expect(result.episodes).toEqual([14]);
    });
    test('anime with season 2 notation', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Granblue Fantasy The Animation Season 2 - 10 [1080p][Multiple Subtitle].mkv');
        expect(result.episodes).toEqual([10]);
    });
    test('anime with season 3 notation', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Shingeki no Kyojin Season 3 - 11 [1080p][Multiple Subtitle].mkv');
        expect(result.episodes).toEqual([11]);
    });
    test('single zero episode', () => {
        const result = (0, index_1.parseTorrentTitle)('DARKER THAN BLACK - S00E00.mkv');
        expect(result.episodes).toEqual([0]);
    });
    test('anime episode when title contain similar pattern', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] 22-7 - 11 .mkv');
        expect(result.episodes).toEqual([11]);
    });
    test('anime episode after year in title', () => {
        const result = (0, index_1.parseTorrentTitle)('[Golumpa] Star Blazers 2202 - 22 (Uchuu Senkan Yamato 2022) [FuniDub 1080p x264 AAC] [A24B89C8].mkv');
        expect(result.episodes).toEqual([22]);
    });
    test('anime episode after year property', () => {
        const result = (0, index_1.parseTorrentTitle)('[SubsPlease] Digimon Adventure (2020) - 35 (720p) [4E7BA28A].mkv');
        expect(result.episodes).toEqual([35]);
    });
    test('anime episode with hyphen number in title', () => {
        const result = (0, index_1.parseTorrentTitle)('[SubsPlease] Fairy Tail - 100 Years Quest - 05 (1080p) [1107F3A9].mkv');
        expect(result.episodes).toEqual([5]);
    });
    test('anime episode recap episode', () => {
        const result = (0, index_1.parseTorrentTitle)('[KH] Sword Art Online II - 14.5 - Debriefing.mkv');
        expect(result.episodes).toEqual([14]);
    });
    test('four digit anime episode', () => {
        const result = (0, index_1.parseTorrentTitle)('[SSA] Detective Conan - 1001 [720p].mkv');
        expect(result.episodes).toEqual([1001]);
    });
    // Season_episode pattern tests
    test('season_episode pattern', () => {
        const result = (0, index_1.parseTorrentTitle)('Pwer-04_05.avi');
        expect(result.seasons).toEqual([4]);
        expect(result.episodes).toEqual([5]);
    });
    test('season_episode pattern v2', () => {
        const result = (0, index_1.parseTorrentTitle)('SupNat-11_06.avi');
        expect(result.seasons).toEqual([11]);
        expect(result.episodes).toEqual([6]);
    });
    test('season_episode pattern v3', () => {
        const result = (0, index_1.parseTorrentTitle)('office_03_19.avi');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([19]);
    });
    test('season_episode pattern with years in title', () => {
        const result = (0, index_1.parseTorrentTitle)('Spergrl-2016-02_04.avi');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([4]);
    });
    test('final with dash season_episode pattern with years in title', () => {
        const result = (0, index_1.parseTorrentTitle)('Iron-Fist-2017-01_13-F.avi');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([13]);
    });
    test('final with dot season_episode pattern with years in title', () => {
        const result = (0, index_1.parseTorrentTitle)('Lgds.of.Tmrow-02_17.F.avi');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([17]);
    });
    test('season.episode pattern', () => {
        const result = (0, index_1.parseTorrentTitle)('Ozk.02.09.avi');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([9]);
    });
    test('final season.episode pattern', () => {
        const result = (0, index_1.parseTorrentTitle)('Ozk.02.10.F.avi');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([10]);
    });
    test('not detect season_episode pattern when other pattern present', () => {
        const result = (0, index_1.parseTorrentTitle)('Cestovatelé_S02E04_11_27.mkv');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([4]);
    });
    test("not detect season_episode pattern when it's additional info", () => {
        const result = (0, index_1.parseTorrentTitle)('S03E13_91.avi');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([13]);
    });
    test('not detect season.episode pattern (not working yet)', () => {
        const result = (0, index_1.parseTorrentTitle)('wwe.nxt.uk.11.26.mkv');
        expect(result.seasons).toEqual([11]);
        expect(result.episodes).toEqual([26]);
    });
    test('not detect season.episode pattern when other pattern present', () => {
        const result = (0, index_1.parseTorrentTitle)('Chernobyl.S01E01.1.23.45.mkv');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([1]);
    });
    test('season.episode pattern with S identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Witcher.S01.07.mp4');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([7]);
    });
    test('season episode pattern with S identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('Breaking Bad S02 03.mkv');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([3]);
    });
    test('season episode pattern with Season prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('NCIS Season 11 01.mp4');
        expect(result.seasons).toEqual([11]);
        expect(result.episodes).toEqual([1]);
    });
    test("not detect season.episode pattern when it's a date", () => {
        const result = (0, index_1.parseTorrentTitle)('Top Gear - 3x05 - 2003.11.23.avi');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([5]);
    });
    test('episode in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('[KTKJ]_[BLEACH]_[DVDRIP]_[116]_[x264_640x480_aac].mkv');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([116]);
    });
    test('episode in brackets but not years', () => {
        const result = (0, index_1.parseTorrentTitle)('[GM-Team][国漫][绝代双骄][Legendary Twins][2022][08][HEVC][GB][4K].mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([8]);
    });
    test('not season-episode pattern when with dot split', () => {
        const result = (0, index_1.parseTorrentTitle)('SG-1. Season 4.16. (2010).avi');
        expect(result.seasons).toEqual([4]);
        expect(result.episodes).toEqual([16]);
    });
    test('polish episode', () => {
        const result = (0, index_1.parseTorrentTitle)('Reset- odc. 10.mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([10]);
    });
    test('not season episode pattern but absolute episode', () => {
        const result = (0, index_1.parseTorrentTitle)('523 23.mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([523]);
    });
    test('only episode', () => {
        const result = (0, index_1.parseTorrentTitle)('Chernobyl E02 1 23 45.mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([2]);
    });
    test('regular episode with year range before', () => {
        const result = (0, index_1.parseTorrentTitle)('Lucky.Luke.1983-1992.S01E04.PL.720p.WEB-DL.H264-zyl.mkv');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([4]);
    });
    test('season dot episode format', () => {
        const result = (0, index_1.parseTorrentTitle)('11.14 - The List.mp4');
        expect(result.seasons).toEqual([11]);
        expect(result.episodes).toEqual([14]);
    });
    test('only episode v2', () => {
        const result = (0, index_1.parseTorrentTitle)('Watch Gary And His Demons Episode 10 - 0.00.07-0.11.02.mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([10]);
    });
    test('only episode v3', () => {
        const result = (0, index_1.parseTorrentTitle)('523 23.mp4');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toEqual([523]);
    });
    test("not season.episode pattern when it's a date without other pattern", () => {
        const result = (0, index_1.parseTorrentTitle)('wwf.raw.is.war.18.09.00.avi');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 2.0 sound", () => {
        const result = (0, index_1.parseTorrentTitle)('The Rat Race (1960) [1080p] [WEB-DL] [x264] [DD] [2-0] [DReaM] [LEKTOR PL]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 2.0 sound v2", () => {
        const result = (0, index_1.parseTorrentTitle)('Avatar 2009 [1080p.BDRip.x264.AC3-azjatycki] [2.0] [Lektor PL]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 5.1 sound", () => {
        const result = (0, index_1.parseTorrentTitle)('A Quiet Place: Day One (2024) [1080p] [WEB-DL] [x264] [AC3] [DD] [5-1] [LEKTOR PL]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 5.1 sound v2", () => {
        const result = (0, index_1.parseTorrentTitle)('Avatar 2009 [1080p.BDRip.x264.AC3-azjatycki] [5.1] [Lektor PL]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 7.1 sound", () => {
        const result = (0, index_1.parseTorrentTitle)('Frequency (2000) [1080p] [BluRay] [REMUX] [AVC] [DTS] [HD] [MA] [7-1] [MR]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test("not episodes when it's 7.1 sound v2", () => {
        const result = (0, index_1.parseTorrentTitle)('Avatar 2009 [1080p.BDRip.x264.AC3-azjatycki] [7.1] [Lektor PL]');
        expect(result.seasons).toBeUndefined();
        expect(result.episodes).toBeUndefined();
    });
    test('spanish cap format', () => {
        const result = (0, index_1.parseTorrentTitle)('Anatomia De Grey - Temporada 19 [HDTV][Cap.1905][Castellano][www.AtomoHD.nu].avi');
        expect(result.episodes).toEqual([1905]);
    });
    test('fairy tail 100 years quest', () => {
        const result = (0, index_1.parseTorrentTitle)('[SubsPlease] Fairy Tail - 100 Years Quest - 05 (1080p) [1107F3A9].mkv');
        expect(result.episodes).toEqual([5]);
    });
    test('no episodes in madmax', () => {
        const result = (0, index_1.parseTorrentTitle)('Mad.Max.Fury.Road.2015.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265[TGx]');
        expect(result.episodes).toBeUndefined();
    });
    test('episode with unusual format', () => {
        const result = (0, index_1.parseTorrentTitle)('Vikkatakavi 01E06.mkv');
        expect(result.episodes).toEqual([6]);
    });
    test('no episodes in hakkenden', () => {
        const result = (0, index_1.parseTorrentTitle)('[Deadfish] Hakkenden_Touhou Hakken Ibun S2 [720][AAC]');
        expect(result.episodes).toBeUndefined();
    });
    test('naruto episode with number in title', () => {
        const result = (0, index_1.parseTorrentTitle)("[Anime Time] Naruto - 116 - 360 Degrees of Vision The Byakugan's Blind Spot.mkv");
        expect(result.episodes).toEqual([116]);
    });
    test('boku no hero academia range', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Boku no Hero Academia S2 - 00~25 [1080p][Multiple Subtitle]');
        expect(result.episodes).toEqual(intRange(0, 25));
    });
    test('one punch man french range', () => {
        const result = (0, index_1.parseTorrentTitle)('One Punch Man (2019) - S02 - E01 à E12 - [WEB-DL][1080p][Multiple Subtitle][x264][Intégrale Saison 02]');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual(intRange(1, 12));
    });
});
