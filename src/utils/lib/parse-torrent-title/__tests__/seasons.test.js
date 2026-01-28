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
describe('parseTorrentTitle - seasons', () => {
    test('basic season detection', () => {
        const result = (0, index_1.parseTorrentTitle)('season 2 of 4');
        expect(result.seasons).toEqual([2]);
    });
    test('season in series type format', () => {
        const result = (0, index_1.parseTorrentTitle)('Game Of Thrones Complete Season 1,2,3,4,5,6,7 406p mkv + Subs');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    test('season in S01 format with one digit', () => {
        const result = (0, index_1.parseTorrentTitle)('Breaking.Bad.S0615.400p.WEB-DL.Rus.Eng.avi');
        expect(result.seasons).toEqual([6]);
    });
    test('season in S01 format', () => {
        const result = (0, index_1.parseTorrentTitle)('Game of Thrones - S02E07 - A Man Without Honor [2160p] [HDR] [5.1, 7.1, 5.1] [ger, eng, eng] [Vio].mkv');
        expect(result.seasons).toEqual([2]);
    });
    test('season with 3 digits', () => {
        const result = (0, index_1.parseTorrentTitle)('S011E16.mkv');
        expect(result.seasons).toEqual([11]);
    });
    test('season in xxx format', () => {
        const result = (0, index_1.parseTorrentTitle)('clny.3x11m720p.es[www.planetatorrent.com].mkv');
        expect(result.seasons).toEqual([3]);
    });
    test('season in xxx format with 0 padding', () => {
        const result = (0, index_1.parseTorrentTitle)('Doctor.Who.2005.8x11.Dark.Water.720p.HDTV.x264-FoV');
        expect(result.seasons).toEqual([8]);
    });
    test('season in pxp format', () => {
        const result = (0, index_1.parseTorrentTitle)('Doctor Who S01--S07--Complete with holiday episodes');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    test('season in pxp format russian style', () => {
        const result = (0, index_1.parseTorrentTitle)('Discovery. Парни с Юкона / Yokon Men [06х01-08] (2017) HDTVRip от GeneralFilm | P1');
        expect(result.seasons).toEqual([6]);
    });
    test('season with a dot in between', () => {
        const result = (0, index_1.parseTorrentTitle)('My Little Pony FiM - 6.01 - No Second Prances.mkv');
        expect(result.seasons).toEqual([6]);
    });
    test('season in brackets', () => {
        const result = (0, index_1.parseTorrentTitle)('[5.01] Weight Loss.avi');
        expect(result.seasons).toEqual([5]);
    });
    test('season range', () => {
        const result = (0, index_1.parseTorrentTitle)('24 Season 1-8 Complete with Subtitles');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    test('season with colon separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Naruto Shippuden Season 1:11');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
    test('season with dot notation', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball [5.134] Preliminary Peril.mp4');
        expect(result.seasons).toEqual([5]);
    });
    test('season with parentheses and dot notation', () => {
        const result = (0, index_1.parseTorrentTitle)('Smallville (1x02 Metamorphosis).avi');
        expect(result.seasons).toEqual([1]);
    });
    test('season with episode prefix Ep notation', () => {
        const result = (0, index_1.parseTorrentTitle)('Desperate Housewives - Episode 1.22 - Goodbye for now.avi');
        expect(result.seasons).toEqual([1]);
    });
    test('season with episode prefix sxep notation', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball Super S01 E23 French 1080p HDTV H264-Kesni');
        expect(result.seasons).toEqual([1]);
    });
    test('season with episode prefix SeEp notation', () => {
        const result = (0, index_1.parseTorrentTitle)('Mash S10E01b Thats Show Biz Part 2 1080p H.264 (moviesbyrizzo upload).mp4');
        expect(result.seasons).toEqual([10]);
    });
    test('season with suffix e', () => {
        const result = (0, index_1.parseTorrentTitle)('The Twilight Zone 1985 S01E22c The Library.mp4');
        expect(result.seasons).toEqual([1]);
    });
    test('season with suffix a', () => {
        const result = (0, index_1.parseTorrentTitle)('The Twilight Zone 1985 S01E23a Shadow Play.mp4');
        expect(result.seasons).toEqual([1]);
    });
    test('season with prefix and suffix', () => {
        const result = (0, index_1.parseTorrentTitle)('The.Man.In.The.High.Castle1x01.HDTV.XviD[www.DivxTotaL.com].avi');
        expect(result.seasons).toEqual([1]);
    });
    test('season range with zero padding', () => {
        const result = (0, index_1.parseTorrentTitle)('Skam.S01-S02-S03.SweSub.720p.WEB-DL.H264');
        expect(result.seasons).toEqual([1, 2, 3]);
    });
    test('season range with slashes separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Stargate Atlantis ALL Seasons - S01 / S02 / S03 / S04 / S05');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5]);
    });
    test('season range with hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Teen Titans Season 1-5');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5]);
    });
    test('season range with ampersand separator', () => {
        const result = (0, index_1.parseTorrentTitle)('The Boondocks Season 1, 2 & 3');
        expect(result.seasons).toEqual([1, 2, 3]);
    });
    test('season range with comma separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Boondocks, The - Seasons 1 + 2');
        expect(result.seasons).toEqual([1, 2]);
    });
    test('season range with to separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Game Of Thrones - Season 1 to 6 (Eng Subs)');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('season with russian season word', () => {
        const result = (0, index_1.parseTorrentTitle)('2 сезон 24 серия.avi');
        expect(result.seasons).toEqual([2]);
    });
    test('season with russian season word with number at front and nothing else', () => {
        const result = (0, index_1.parseTorrentTitle)('3 сезон');
        expect(result.seasons).toEqual([3]);
    });
    test('season with russian season word and underscore', () => {
        const result = (0, index_1.parseTorrentTitle)('2. Discovery-Kak_ustroena_Vselennaya.(2.sezon_8.serii.iz.8).2012.XviD.HDTVRip.Krasnodarka');
        expect(result.seasons).toEqual([2]);
    });
    test('season with russian season shortened word', () => {
        const result = (0, index_1.parseTorrentTitle)('Otchayannie.domochozyaiki.(8.sez.21.ser.iz.23).2012.XviD.HDTVRip.avi');
        expect(result.seasons).toEqual([8]);
    });
    test('season with russian season word and no prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('Интерны. Сезон №9. Серия №180.avi');
        expect(result.seasons).toEqual([9]);
    });
    test('season with russian x separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Discovery. Парни с Юкона / Yokon Men [06х01-08] (2017) HDTVRip от GeneralFilm | P1');
        expect(result.seasons).toEqual([6]);
    });
    test('season with russian season word in araic letters', () => {
        const result = (0, index_1.parseTorrentTitle)('Zvezdnie.Voiny.Voina.Klonov.3.sezon.22.seria.iz.22.XviD.HDRip.avi');
        expect(result.seasons).toEqual([3]);
    });
    test('season with hyphen separator between episode', () => {
        const result = (0, index_1.parseTorrentTitle)('2-06. Девичья сила.mkv');
        expect(result.seasons).toEqual([2]);
    });
    test('season with hyphen separator between episode v2', () => {
        const result = (0, index_1.parseTorrentTitle)('4-13 Cursed (HD).m4v');
        expect(result.seasons).toEqual([4]);
    });
    test('season with hyphen separator between episode v3', () => {
        const result = (0, index_1.parseTorrentTitle)('Доктор Хаус 03-20.mkv');
        expect(result.seasons).toEqual([3]);
    });
    test('episodes with hyphen separator between episode v4', () => {
        const result = (0, index_1.parseTorrentTitle)('Комиссар Рекс 11-13.avi');
        expect(result.seasons).toEqual([11]);
    });
    test("not season with hyphen separator when it's the title", () => {
        const result = (0, index_1.parseTorrentTitle)('13-13-13 2013 DVDrip x264 AAC-MiLLENiUM');
        expect(result.seasons).toBeUndefined();
        expect(result.title).toBe('13-13-13');
    });
    test('correct season with eps prefix and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('MARATHON EPISODES/Orphan Black S3 Eps.05-08.mp4');
        expect(result.seasons).toEqual([3]);
    });
    test('multiple seasons with end season without s symbol', () => {
        const result = (0, index_1.parseTorrentTitle)('Once Upon a Time [S01-07] (2011-2017) WEB-DLRip by Generalfilm');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    test('multiple seasons with one space and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('[F-D] Fairy Tail Season 1 -6 + Extras [480P][Dual-Audio]');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('multiple seasons with spaces and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('Coupling Season 1 - 4 Complete DVDRip - x264 - MKV by RiddlerA');
        expect(result.seasons).toEqual([1, 2, 3, 4]);
    });
    test('single season with spaces and hyphen separator', () => {
        const result = (0, index_1.parseTorrentTitle)('[HR] Boku no Hero Academia 87 (S4-24) [1080p HEVC Multi-Subs] HR-GZ');
        expect(result.seasons).toEqual([4]);
    });
    test('Tokyo Ghoul Root A - 07 [S2-07] [Eng Sub] 480p [email protected]', () => {
        const result = (0, index_1.parseTorrentTitle)('Tokyo Ghoul Root A - 07 [S2-07] [Eng Sub] 480p [email protected]');
        expect(result.seasons).toEqual([2]);
    });
    test('Ace of the Diamond: 1st Season', () => {
        const result = (0, index_1.parseTorrentTitle)('Ace of the Diamond: 1st Season');
        expect(result.seasons).toEqual([1]);
    });
    test('Ace of the Diamond: 2nd Season', () => {
        const result = (0, index_1.parseTorrentTitle)('Ace of the Diamond: 2nd Season');
        expect(result.seasons).toEqual([2]);
    });
    test('Adventure Time 10 th season', () => {
        const result = (0, index_1.parseTorrentTitle)('Adventure Time 10 th season');
        expect(result.seasons).toEqual([10]);
    });
    test('Kyoukai no Rinne (TV) 3rd Season - 23 [1080p]', () => {
        const result = (0, index_1.parseTorrentTitle)('Kyoukai no Rinne (TV) 3rd Season - 23 [1080p]');
        expect(result.seasons).toEqual([3]);
    });
    test('[Erai-raws] Granblue Fantasy The Animation Season 2 - 08 [1080p][Multiple Subtitle].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Granblue Fantasy The Animation Season 2 - 08 [1080p][Multiple Subtitle].mkv');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([8]);
    });
    test('The Nile Egypts Great River with Bettany Hughes Series 1 4of4 10', () => {
        const result = (0, index_1.parseTorrentTitle)('The Nile Egypts Great River with Bettany Hughes Series 1 4of4 10');
        expect(result.seasons).toEqual([1]);
    });
    test('Teen Wolf - 04ª Temporada 720p', () => {
        const result = (0, index_1.parseTorrentTitle)('Teen Wolf - 04ª Temporada 720p');
        expect(result.seasons).toEqual([4]);
    });
    test('Vikings 3 Temporada 720p', () => {
        const result = (0, index_1.parseTorrentTitle)('Vikings 3 Temporada 720p');
        expect(result.seasons).toEqual([3]);
    });
    test('Eu, a Patroa e as Crianças  4° Temporada Completa - HDTV - Dublado', () => {
        const result = (0, index_1.parseTorrentTitle)('Eu, a Patroa e as Crianças  4° Temporada Completa - HDTV - Dublado');
        expect(result.seasons).toEqual([4]);
    });
    test('Merl - Temporada 1', () => {
        const result = (0, index_1.parseTorrentTitle)('Merl - Temporada 1');
        expect(result.seasons).toEqual([1]);
    });
    test('Elementar 3º Temporada Dublado', () => {
        const result = (0, index_1.parseTorrentTitle)('Elementar 3º Temporada Dublado');
        expect(result.seasons).toEqual([3]);
    });
    test('Beavis and Butt-Head - 1a. Temporada', () => {
        const result = (0, index_1.parseTorrentTitle)('Beavis and Butt-Head - 1a. Temporada');
        expect(result.seasons).toEqual([1]);
    });
    test('3Âº Temporada Bob esponja Pt-Br', () => {
        const result = (0, index_1.parseTorrentTitle)('3Âº Temporada Bob esponja Pt-Br');
        expect(result.seasons).toEqual([3]);
    });
    test('Juego de Tronos - Temp.2 [ALTA DEFINICION 720p][Cap.209][Spanish].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Juego de Tronos - Temp.2 [ALTA DEFINICION 720p][Cap.209][Spanish].mkv');
        expect(result.seasons).toEqual([2]);
    });
    test('Los Simpsons Temp 7 DVDrip Espanol De Espana', () => {
        const result = (0, index_1.parseTorrentTitle)('Los Simpsons Temp 7 DVDrip Espanol De Espana');
        expect(result.seasons).toEqual([7]);
    });
    test('spanish season range with & separator', () => {
        const result = (0, index_1.parseTorrentTitle)('The Walking Dead [Temporadas 1 & 2 Completas Em HDTV E Legena');
        expect(result.seasons).toEqual([1, 2]);
    });
    test('spanish short season identifier', () => {
        const result = (0, index_1.parseTorrentTitle)('My Little Pony - A Amizade é Mágica - T02E22.mp4');
        expect(result.seasons).toEqual([2]);
    });
    test('spanish short season identifier with xe separator', () => {
        const result = (0, index_1.parseTorrentTitle)('30 M0N3D4S ESP T01XE08.mkv');
        expect(result.seasons).toEqual([1]);
    });
    test('sn naming scheme', () => {
        const result = (0, index_1.parseTorrentTitle)('Sons of Anarchy Sn4 Ep14 HD-TV - To Be, Act 2, By Cool Release');
        expect(result.seasons).toEqual([4]);
    });
    test('single season and not range in filename', () => {
        const result = (0, index_1.parseTorrentTitle)('[FFA] Kiratto Pri☆chan Season 3 - 11 [1080p][HEVC].mkv');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([11]);
    });
    test('single season and not range in filename v2', () => {
        const result = (0, index_1.parseTorrentTitle)('[Erai-raws] Granblue Fantasy The Animation Season 2 - 10 [1080p][Multiple Subtitle].mkv');
        expect(result.seasons).toEqual([2]);
        expect(result.episodes).toEqual([10]);
    });
    test('single season and not range in filename v3', () => {
        const result = (0, index_1.parseTorrentTitle)('[SCY] Attack on Titan Season 3 - 11 (BD 1080p Hi10 FLAC) [1FA13150].mkv');
        expect(result.seasons).toEqual([3]);
        expect(result.episodes).toEqual([11]);
    });
    test('single zero season', () => {
        const result = (0, index_1.parseTorrentTitle)('DARKER THAN BLACK - S00E04 - Darker Than Black Gaiden OVA 3.mkv');
        expect(result.seasons).toEqual([0]);
    });
    test('nl season word', () => {
        const result = (0, index_1.parseTorrentTitle)('Seizoen 22 - Zon & Maan Ultra Legendes/afl.18 Je ogen op de bal houden!.mp4');
        expect(result.seasons).toEqual([22]);
    });
    test('italian season word', () => {
        const result = (0, index_1.parseTorrentTitle)('Nobody Wants This - Stagione 1 (2024) [COMPLETA] 720p H264 ITA AAC 2.0-Zer0landia');
        expect(result.seasons).toEqual([1]);
    });
    test('italian season range', () => {
        const result = (0, index_1.parseTorrentTitle)('Red Oaks - Stagioni 01-03 (2014-2017) [COMPLETA] SD x264 AAC ITA SUB ITA - mkeagle3');
        expect(result.seasons).toEqual([1, 2, 3]);
    });
    test('polish season', () => {
        const result = (0, index_1.parseTorrentTitle)('Star.Wars.Skeleton.Crew.Sezon01.PLDUB.480p.DSNP.WEB-DL.H264.DDP5.1-K83');
        expect(result.seasons).toEqual([1]);
    });
    test('polish season with S prefix', () => {
        const result = (0, index_1.parseTorrentTitle)('Bitten.SezonSO3.PL.480p.NF.WEB-DL.DD5.1.XviD-Ralf');
        expect(result.seasons).toEqual([3]);
    });
    test('regular season with year range before', () => {
        const result = (0, index_1.parseTorrentTitle)("'Lucky.Luke.1983-1992.S01E04.PL.720p.WEB-DL.H264-zyl.mkv'");
        expect(result.seasons).toEqual([1]);
    });
    test('polish season range', () => {
        const result = (0, index_1.parseTorrentTitle)('Rizzoli & Isles 2010-2016 [Sezon 01-07] [1080p.WEB-DL.H265.EAC3-FT][Alusia]');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    test('season episode when not in boundary', () => {
        const result = (0, index_1.parseTorrentTitle)('Those.About.to.DieS01E06.MULTi.720p.AMZN.WEB-DL.H264.DDP5.1-K83.mkv');
        expect(result.seasons).toEqual([1]);
        expect(result.episodes).toEqual([6]);
    });
    test("not season when it's part of the name", () => {
        const result = (0, index_1.parseTorrentTitle)('Ranma-12-86.mp4');
        expect(result.seasons).toBeUndefined();
    });
    test("not season when it's part of group", () => {
        const result = (0, index_1.parseTorrentTitle)("The Killer's Game 2024 PL 1080p WEB-DL H264 DD5.1-S56");
        expect(result.seasons).toBeUndefined();
    });
    test("not season when it's part of group v2", () => {
        const result = (0, index_1.parseTorrentTitle)('Apollo 13 (1995) [1080p] [WEB-DL] [x264] [E-AC3-S78] [Lektor PL]');
        expect(result.seasons).toBeUndefined();
    });
    test("not season dot episode notation when it's a title", () => {
        const result = (0, index_1.parseTorrentTitle)('3.10 to Yuma (2007).mkv');
        expect(result.seasons).toBeUndefined();
    });
    test('not season dot episode notation when there is year in name', () => {
        const result = (0, index_1.parseTorrentTitle)('18.11 - A Code Of Secrecy (2014) x264 1080p-AAC-ESUB [Parth].mkv');
        expect(result.seasons).toBeUndefined();
    });
    // Additional comprehensive tests
    test('All of Us Are Dead . 2022 . S01 EP #1.2.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('All of Us Are Dead . 2022 . S01 EP #1.2.mkv');
        expect(result.seasons).toEqual([1]);
    });
    test('breaking.bad.s01e01.720p.bluray.x264-reward', () => {
        const result = (0, index_1.parseTorrentTitle)('breaking.bad.s01e01.720p.bluray.x264-reward');
        expect(result.seasons).toEqual([1]);
    });
    test('Breaking Bad Complete Season 1 , 2 , 3, 4 ,5 ,1080p HEVC', () => {
        const result = (0, index_1.parseTorrentTitle)('Breaking Bad Complete Season 1 , 2 , 3, 4 ,5 ,1080p HEVC');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5]);
    });
    test('Bron - S4 - 720P - SweSub.mp4', () => {
        const result = (0, index_1.parseTorrentTitle)('Bron - S4 - 720P - SweSub.mp4');
        expect(result.seasons).toEqual([4]);
    });
    test('Empty Nest Season 1 (1988 - 89) fiveofseven', () => {
        const result = (0, index_1.parseTorrentTitle)('Empty Nest Season 1 (1988 - 89) fiveofseven');
        expect(result.seasons).toEqual([1]);
    });
    test('Friends.Complete.Series.S01-S10.720p.BluRay.2CH.x265.HEVC-PSA', () => {
        const result = (0, index_1.parseTorrentTitle)('Friends.Complete.Series.S01-S10.720p.BluRay.2CH.x265.HEVC-PSA');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
    test('Friends S04 Season 4 1080p 5.1Ch BluRay ReEnc-DeeJayAhmed', () => {
        const result = (0, index_1.parseTorrentTitle)('Friends S04 Season 4 1080p 5.1Ch BluRay ReEnc-DeeJayAhmed');
        expect(result.seasons).toEqual([4]);
    });
    test('Futurama Season 1 2 3 4 5 6 7 + 4 Movies - threesixtyp', () => {
        const result = (0, index_1.parseTorrentTitle)('Futurama Season 1 2 3 4 5 6 7 + 4 Movies - threesixtyp');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    test('Game of Thrones / Сезон: 1-8 / Серии: 1-73 из 73 [2011-2019, США, BDRip 1080p] MVO (LostFilm)', () => {
        const result = (0, index_1.parseTorrentTitle)('Game of Thrones / Сезон: 1-8 / Серии: 1-73 из 73 [2011-2019, США, BDRip 1080p] MVO (LostFilm)');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    test('House MD All Seasons (1-8) 720p Ultra-Compressed', () => {
        const result = (0, index_1.parseTorrentTitle)('House MD All Seasons (1-8) 720p Ultra-Compressed');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    test('How I Met Your Mother Season 1, 2, 3, 4, 5, & 6 + Extras DVDRip', () => {
        const result = (0, index_1.parseTorrentTitle)('How I Met Your Mother Season 1, 2, 3, 4, 5, & 6 + Extras DVDRip');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('Mad Men S02 Season 2 720p 5.1Ch BluRay ReEnc-DeeJayAhmed', () => {
        const result = (0, index_1.parseTorrentTitle)('Mad Men S02 Season 2 720p 5.1Ch BluRay ReEnc-DeeJayAhmed');
        expect(result.seasons).toEqual([2]);
    });
    test('One Punch Man 01 - 12 Season 1 Complete [720p] [Eng Subs] [Xerxe:16', () => {
        const result = (0, index_1.parseTorrentTitle)('One Punch Man 01 - 12 Season 1 Complete [720p] [Eng Subs] [Xerxe:16');
        expect(result.seasons).toEqual([1]);
    });
    test('Orange Is The New Black Season 5 Episodes 1-10 INCOMPLETE (LEAKED)', () => {
        const result = (0, index_1.parseTorrentTitle)('Orange Is The New Black Season 5 Episodes 1-10 INCOMPLETE (LEAKED)');
        expect(result.seasons).toEqual([5]);
    });
    test('Perdidos: Lost: Castellano: Temporadas 1 2 3 4 5 6 (Serie Com', () => {
        const result = (0, index_1.parseTorrentTitle)('Perdidos: Lost: Castellano: Temporadas 1 2 3 4 5 6 (Serie Com');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('Seinfeld S02 Season 2 720p WebRip ReEnc-DeeJayAhmed', () => {
        const result = (0, index_1.parseTorrentTitle)('Seinfeld S02 Season 2 720p WebRip ReEnc-DeeJayAhmed');
        expect(result.seasons).toEqual([2]);
    });
    test('Seinfeld Season 2 S02 720p AMZN WEBRip x265 HEVC Complete', () => {
        const result = (0, index_1.parseTorrentTitle)('Seinfeld Season 2 S02 720p AMZN WEBRip x265 HEVC Complete');
        expect(result.seasons).toEqual([2]);
    });
    test('South Park Complete Seasons 1: 11', () => {
        const result = (0, index_1.parseTorrentTitle)('South Park Complete Seasons 1: 11');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
    test('Stargate Atlantis Complete (Season 1 2 3 4 5) 720p HEVC x265', () => {
        const result = (0, index_1.parseTorrentTitle)('Stargate Atlantis Complete (Season 1 2 3 4 5) 720p HEVC x265');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5]);
    });
    test('The Boondocks Seasons 1-4 MKV', () => {
        const result = (0, index_1.parseTorrentTitle)('The Boondocks Seasons 1-4 MKV');
        expect(result.seasons).toEqual([1, 2, 3, 4]);
    });
    test('The Expanse Complete Seasons 01 & 02 1080p', () => {
        const result = (0, index_1.parseTorrentTitle)('The Expanse Complete Seasons 01 & 02 1080p');
        expect(result.seasons).toEqual([1, 2]);
    });
    test('The Simpsons S28E21 720p HDTV x264-AVS', () => {
        const result = (0, index_1.parseTorrentTitle)('The Simpsons S28E21 720p HDTV x264-AVS');
        expect(result.seasons).toEqual([28]);
    });
    test('The Simpsons Season 20 21 22 23 24 25 26 27 - threesixtyp', () => {
        const result = (0, index_1.parseTorrentTitle)('The Simpsons Season 20 21 22 23 24 25 26 27 - threesixtyp');
        expect(result.seasons).toEqual([20, 21, 22, 23, 24, 25, 26, 27]);
    });
    test('Travelers - Seasons 1 and 2 - Mp4 x264 AC3 1080p', () => {
        const result = (0, index_1.parseTorrentTitle)('Travelers - Seasons 1 and 2 - Mp4 x264 AC3 1080p');
        expect(result.seasons).toEqual([1, 2]);
    });
    test('True Blood Season 1, 2, 3, 4, 5 & 6 + Extras BDRip TSV', () => {
        const result = (0, index_1.parseTorrentTitle)('True Blood Season 1, 2, 3, 4, 5 & 6 + Extras BDRip TSV');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('Друзья / Friends / Сезон: 1 / Серии: 1-24 из 24 [1994-1995, США, BDRip 720p] MVO + Original + Sub (Rus, Eng)', () => {
        const result = (0, index_1.parseTorrentTitle)('Друзья / Friends / Сезон: 1 / Серии: 1-24 из 24 [1994-1995, США, BDRip 720p] MVO + Original + Sub (Rus, Eng)');
        expect(result.seasons).toEqual([1]);
    });
    test('Друзья / Friends / Сезон: 1, 2 / Серии: 1-24 из 24 [1994-1999, США, BDRip 720p] MVO', () => {
        const result = (0, index_1.parseTorrentTitle)('Друзья / Friends / Сезон: 1, 2 / Серии: 1-24 из 24 [1994-1999, США, BDRip 720p] MVO');
        expect(result.seasons).toEqual([1, 2]);
    });
    test('Леди Баг и Супер-Кот – Сезон 3, Эпизод 21 – Кукловод 2 [1080p].mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Леди Баг и Супер-Кот – Сезон 3, Эпизод 21 – Кукловод 2 [1080p].mkv');
        expect(result.seasons).toEqual([3]);
    });
    test('Проклятие острова ОУК_ 5-й сезон 09-я серия_ Прорыв Дэна.avi', () => {
        const result = (0, index_1.parseTorrentTitle)('Проклятие острова ОУК_ 5-й сезон 09-я серия_ Прорыв Дэна.avi');
        expect(result.seasons).toEqual([5]);
    });
    test('Разрушители легенд. MythBusters. Сезон 15. Эпизод 09. Скрытая угроза (2015).avi', () => {
        const result = (0, index_1.parseTorrentTitle)('Разрушители легенд. MythBusters. Сезон 15. Эпизод 09. Скрытая угроза (2015).avi');
        expect(result.seasons).toEqual([15]);
    });
    test('Сезон 5/Серия 11.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Сезон 5/Серия 11.mkv');
        expect(result.seasons).toEqual([5]);
    });
    test('Vikkatakavi 01E06.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('Vikkatakavi 01E06.mkv');
        expect(result.seasons).toEqual([1]);
    });
    test('Swamp People 2010 Seasons 1 to 15 Complete 720p WEB x264 [i_c]', () => {
        const result = (0, index_1.parseTorrentTitle)('Swamp People 2010 Seasons 1 to 15 Complete 720p WEB x264 [i_c]');
        expect(result.seasons).toEqual(intRange(1, 15));
    });
    test("Клинок, рассекающий демонов (ТВ-1) / Kimetsu no Yaiba / Demon Slayer [TV] [26 из 26] [RUS(ext), ENG, JAP+Sub] [2019, BDRip] [1080p]", () => {
        const result = (0, index_1.parseTorrentTitle)("Клинок, рассекающий демонов (ТВ-1) / Kimetsu no Yaiba / Demon Slayer [TV] [26 из 26] [RUS(ext), ENG, JAP+Sub] [2019, BDRip] [1080p]");
        expect(result.seasons).toEqual([1]);
    });
    test('Swamp People - Season 1 to 6 Plus Specials - 720P - HDTV - X265-HEVC - O69', () => {
        const result = (0, index_1.parseTorrentTitle)('Swamp People - Season 1 to 6 Plus Specials - 720P - HDTV - X265-HEVC - O69');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('One.Piece.S004E111.Dash.For.a.Miracle!.Alabasta.Animal.Land!.1080p.NF.WEB-DL.DDP2.0.x264-KQRM.mkv', () => {
        const result = (0, index_1.parseTorrentTitle)('One.Piece.S004E111.Dash.For.a.Miracle!.Alabasta.Animal.Land!.1080p.NF.WEB-DL.DDP2.0.x264-KQRM.mkv');
        expect(result.seasons).toEqual([4]);
    });
    test('Archer.S02.1080p.BluRay.DTSMA.AVC.Remux', () => {
        const result = (0, index_1.parseTorrentTitle)('Archer.S02.1080p.BluRay.DTSMA.AVC.Remux');
        expect(result.seasons).toEqual([2]);
    });
    test('The Simpsons S01E01 1080p BluRay x265 HEVC 10bit AAC 5.1 Tigole', () => {
        const result = (0, index_1.parseTorrentTitle)('The Simpsons S01E01 1080p BluRay x265 HEVC 10bit AAC 5.1 Tigole');
        expect(result.seasons).toEqual([1]);
    });
    test('[F-D] Fairy Tail Season 1 - 6 + Extras [480P][Dual-Audio]', () => {
        const result = (0, index_1.parseTorrentTitle)('[F-D] Fairy Tail Season 1 - 6 + Extras [480P][Dual-Audio]');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('Bleach 10º Temporada - 215 ao 220 - [DB-BR]', () => {
        const result = (0, index_1.parseTorrentTitle)('Bleach 10º Temporada - 215 ao 220 - [DB-BR]');
        expect(result.seasons).toEqual([10]);
    });
    test('Lost.[Perdidos].6x05.HDTV.XviD.[www.DivxTotaL.com]', () => {
        const result = (0, index_1.parseTorrentTitle)('Lost.[Perdidos].6x05.HDTV.XviD.[www.DivxTotaL.com]');
        expect(result.seasons).toEqual([6]);
    });
    test('Dragon Ball Z Movie - 09 - Bojack Unbound - 1080p BluRay x264 DTS 5.1 -DDR', () => {
        const result = (0, index_1.parseTorrentTitle)('Dragon Ball Z Movie - 09 - Bojack Unbound - 1080p BluRay x264 DTS 5.1 -DDR');
        expect(result.seasons).toBeUndefined();
    });
    test('BoJack Horseman [06x01-08 of 16] (2019-2020) WEB-DLRip 720p', () => {
        const result = (0, index_1.parseTorrentTitle)('BoJack Horseman [06x01-08 of 16] (2019-2020) WEB-DLRip 720p');
        expect(result.seasons).toEqual([6]);
    });
    test('추노.The.Slave.Hunters.S01', () => {
        const result = (0, index_1.parseTorrentTitle)('추노.The.Slave.Hunters.S01');
        expect(result.seasons).toEqual([1]);
    });
    test('[AniDub]_Love.Scout.s01', () => {
        const result = (0, index_1.parseTorrentTitle)('[AniDub]_Love.Scout.s01');
        expect(result.seasons).toEqual([1]);
    });
    test('season range with leading zeros in pack without extension', () => {
        const result = (0, index_1.parseTorrentTitle)('Example Show Season 01-06 Complete');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
        expect(result.episodes).toBeUndefined();
    });
    test('multiple season notations should not duplicate', () => {
        const result = (0, index_1.parseTorrentTitle)('Cougar Town (2009) Season 1-6 S01-06 (1080p AMZN WEB-DL x265 HEVC 10bit AAC 5.1 MONOLITH) [QxR]');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
        expect(result.episodes).toBeUndefined();
    });
    test('multiple season notations should not duplicate', () => {
        const result = (0, index_1.parseTorrentTitle)('Cougar Town (2009) Season 01-6 S01-06 (1080p AMZN WEB-DL x265 HEVC 10bit AAC 5.1 MONOLITH) [QxR]');
        expect(result.seasons).toEqual([1, 2, 3, 4, 5, 6]);
        expect(result.episodes).toBeUndefined();
    });
    test('season range should not be parsed as episodes when season word is present', () => {
        const result = (0, index_1.parseTorrentTitle)('Show Name Season 3-5 Complete');
        expect(result.seasons).toEqual([3, 4, 5]);
        expect(result.episodes).toBeUndefined();
    });
});
