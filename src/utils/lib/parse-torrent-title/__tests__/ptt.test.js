"use strict";
/**
 * Main PTT parsing tests
 * Ported from ptt_test.go
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
// Helper function to create integer ranges
const intRange = (start, end) => {
    const nums = [];
    for (let i = start; i <= end; i++) {
        nums.push(i);
    }
    return nums;
};
describe('Parse Torrent Title', () => {
    const testCases = [
        {
            title: 'sons.of.anarchy.s05e10.480p.BluRay.x264-GAnGSteR',
            expected: {
                title: 'sons of anarchy',
                resolution: '480p',
                seasons: [5],
                episodes: [10],
                quality: 'BluRay',
                codec: 'x264',
                group: 'GAnGSteR'
            }
        },
        {
            title: 'Color.Of.Night.Unrated.DC.VostFR.BRrip.x264',
            expected: {
                title: 'Color Of Night',
                unrated: true,
                languages: ['fr'],
                quality: 'BRRip',
                codec: 'x264'
            }
        },
        {
            title: 'Da Vinci Code DVDRip',
            expected: {
                title: 'Da Vinci Code',
                quality: 'DVDRip'
            }
        },
        {
            title: 'Some.girls.1998.DVDRip',
            expected: {
                title: 'Some girls',
                quality: 'DVDRip',
                year: '1998'
            }
        },
        {
            title: 'Ecrit.Dans.Le.Ciel.1954.MULTI.DVDRIP.x264.AC3-gismo65',
            expected: {
                title: 'Ecrit Dans Le Ciel',
                quality: 'DVDRip',
                year: '1954',
                languages: ['multi audio'],
                dubbed: true,
                codec: 'x264',
                audio: ['AC3'],
                group: 'gismo65'
            }
        },
        {
            title: '2019 After The Fall Of New York 1983 REMASTERED BDRip x264-GHOULS',
            expected: {
                title: '2019 After The Fall Of New York',
                quality: 'BDRip',
                edition: 'Remastered',
                remastered: true,
                year: '1983',
                codec: 'x264',
                group: 'GHOULS'
            }
        },
        {
            title: 'Ghost In The Shell 2017 720p HC HDRip X264 AC3-EVO',
            expected: {
                title: 'Ghost In The Shell',
                quality: 'HDRip',
                hardcoded: true,
                year: '2017',
                resolution: '720p',
                codec: 'x264',
                audio: ['AC3'],
                group: 'EVO'
            }
        },
        {
            title: 'Rogue One 2016 1080p BluRay x264-SPARKS',
            expected: {
                title: 'Rogue One',
                quality: 'BluRay',
                year: '2016',
                resolution: '1080p',
                codec: 'x264',
                group: 'SPARKS'
            }
        },
        {
            title: 'Desperation 2006 Multi Pal DvdR9-TBW1973',
            expected: {
                title: 'Desperation',
                quality: 'DVD',
                year: '2006',
                languages: ['multi audio'],
                dubbed: true,
                region: 'R9',
                group: 'TBW1973'
            }
        },
        {
            title: "Maman, j'ai raté l'avion 1990 VFI 1080p BluRay DTS x265-HTG",
            expected: {
                title: "Maman, j'ai raté l'avion",
                quality: 'BluRay',
                year: '1990',
                audio: ['DTS Lossy'],
                resolution: '1080p',
                languages: ['fr'],
                codec: 'x265',
                group: 'HTG'
            }
        },
        {
            title: 'Game of Thrones - The Complete Season 3 [HDTV]',
            expected: {
                title: 'Game of Thrones',
                seasons: [3],
                quality: 'HDTV'
            }
        },
        {
            title: 'The Sopranos: The Complete Series (Season 1,2,3,4,5&6) + Extras',
            expected: {
                title: 'The Sopranos',
                seasons: [1, 2, 3, 4, 5, 6],
                complete: true
            }
        },
        {
            title: 'Skins Season S01-S07 COMPLETE UK Soundtrack 720p WEB-DL',
            expected: {
                title: 'Skins',
                seasons: [1, 2, 3, 4, 5, 6, 7],
                resolution: '720p',
                quality: 'WEB-DL',
                complete: true
            }
        },
        {
            title: 'Futurama.COMPLETE.S01-S07.720p.BluRay.x265-HETeam',
            expected: {
                title: 'Futurama',
                seasons: [1, 2, 3, 4, 5, 6, 7],
                resolution: '720p',
                quality: 'BluRay',
                codec: 'x265',
                group: 'HETeam',
                complete: true
            }
        },
        {
            title: 'You.[Uncut].S01.SweSub.1080p.x264-Justiso',
            expected: {
                codec: 'x264',
                edition: 'Uncut',
                group: 'Justiso',
                languages: ['sv'],
                resolution: '1080p',
                seasons: [1],
                subbed: true,
                title: 'You'
            }
        },
        {
            title: 'Stephen Colbert 2019 10 25 Eddie Murphy 480p x264-mSD [eztv]',
            expected: {
                title: 'Stephen Colbert',
                date: '2019-10-25',
                resolution: '480p',
                codec: 'x264'
            }
        },
        {
            title: 'House MD Season 7 Complete MKV',
            expected: {
                title: 'House MD',
                seasons: [7],
                container: 'mkv',
                complete: true
            }
        },
        {
            title: '2008 The Incredible Hulk Feature Film.mp4',
            expected: {
                title: 'The Incredible Hulk Feature Film',
                year: '2008',
                container: 'mp4',
                extension: 'mp4'
            }
        },
        {
            title: '【4月/悠哈璃羽字幕社】[UHA-WINGS][不要输！恶之军团][Makeruna!! Aku no Gundan!][04][1080p AVC_AAC][简繁外挂][sc_tc]',
            expected: {
                title: 'Makeruna!! Aku no Gundan!',
                episodes: [4],
                resolution: '1080p',
                codec: 'avc',
                audio: ['AAC'],
                languages: ['zh']
            }
        },
        {
            title: '[GM-Team][国漫][西行纪之集结篇][The Westward Ⅱ][2019][17][AVC][GB][1080P]',
            expected: {
                title: 'The Westward Ⅱ',
                year: '2019',
                episodes: [17],
                resolution: '1080p',
                codec: 'avc',
                group: 'GM-Team',
                languages: ['zh']
            }
        },
        {
            title: 'Черное зеркало / Black Mirror / Сезон 4 / Серии 1-6 (6) [2017, США, WEBRip 1080p] MVO + Eng Sub',
            expected: {
                title: 'Black Mirror',
                year: '2017',
                seasons: [4],
                episodes: [1, 2, 3, 4, 5, 6],
                languages: ['en', 'ru'],
                resolution: '1080p',
                quality: 'WEBRip',
                subbed: true
            }
        },
        {
            title: "[neoHEVC] Student Council's Discretion / Seitokai no Ichizon [Season 1} [BD 1080p x265 HEVC AAC]",
            expected: {
                title: "Student Council's Discretion / Seitokai no Ichizon",
                seasons: [1],
                resolution: '1080p',
                quality: 'BDRip',
                audio: ['AAC'],
                codec: 'hevc',
                group: 'neoHEVC'
            }
        },
        {
            title: '[Commie] Chihayafuru 3 - 21 [BD 720p AAC] [5F1911ED].mkv',
            expected: {
                title: 'Chihayafuru 3',
                episodes: [21],
                resolution: '720p',
                quality: 'BDRip',
                audio: ['AAC'],
                container: 'mkv',
                extension: 'mkv',
                episodeCode: '5F1911ED',
                group: 'Commie'
            }
        },
        {
            title: '[DVDRip-ITA]The Fast and the Furious: Tokyo Drift [CR-Bt]',
            expected: {
                title: 'The Fast and the Furious: Tokyo Drift',
                quality: 'DVDRip',
                languages: ['it']
            }
        },
        {
            title: '[BluRay Rip 720p ITA AC3 - ENG AC3 SUB] Hostel[2005]-LIFE[ultimafrontiera]',
            expected: {
                title: 'Hostel',
                year: '2005',
                resolution: '720p',
                quality: 'BRRip',
                audio: ['AC3'],
                languages: ['en', 'it'],
                group: 'LIFE',
                subbed: true
            }
        },
        {
            title: '[OFFICIAL ENG SUB] Soul Land Episode 121-125 [1080p][Soft Sub][Web-DL][Douluo Dalu][斗罗大陆]',
            expected: {
                title: 'Soul Land',
                episodes: [121, 122, 123, 124, 125],
                resolution: '1080p',
                quality: 'WEB-DL',
                languages: ['en', 'zh'],
                subbed: true
            }
        },
        {
            title: '[720p] The God of Highschool Season 1',
            expected: {
                title: 'The God of Highschool',
                seasons: [1],
                resolution: '720p'
            }
        },
        {
            title: 'Heidi Audio Latino DVDRip [cap. 3 Al 18]',
            expected: {
                title: 'Heidi',
                episodes: [3],
                quality: 'DVDRip',
                languages: ['es-419']
            }
        },
        {
            title: 'Sprint.2024.S01.COMPLETE.1080p.WEB.h264-EDITH[TGx]',
            expected: {
                title: 'Sprint',
                year: '2024',
                seasons: [1],
                quality: 'WEB',
                resolution: '1080p',
                codec: 'h264',
                group: 'EDITH',
                complete: true
            }
        },
        {
            title: 'High Heat *2022* [BRRip.XviD] Lektor PL',
            expected: {
                title: 'High Heat',
                year: '2022',
                codec: 'xvid',
                quality: 'BRRip',
                languages: ['pl']
            }
        },
        {
            title: 'Ghost Busters *1984-2021* [720p] [BDRip] [AC-3] [XviD] [Lektor + Dubbing PL] [DYZIO]',
            expected: {
                title: 'Ghost Busters',
                year: '1984-2021',
                resolution: '720p',
                audio: ['AC3'],
                codec: 'xvid',
                complete: true,
                quality: 'BDRip',
                languages: ['pl']
            }
        },
        {
            title: '20-20.2024.11.15.Fatal.Disguise.XviD-AFG[EZTVx.to].avi',
            expected: {
                title: '20-20',
                date: '2024-11-15',
                codec: 'xvid',
                group: 'AFG',
                container: 'avi',
                extension: 'avi',
                site: 'EZTVx.to'
            }
        },
        {
            title: 'Anatomia De Grey - Temporada 19 [HDTV][Castellano][www.AtomoHD.nu].avi',
            expected: {
                title: 'Anatomia De Grey',
                seasons: [19],
                container: 'avi',
                extension: 'avi',
                languages: ['es'],
                quality: 'HDTV',
                site: 'www.AtomoHD.nu'
            }
        },
        {
            title: 'Madame Web 2024 UHD BluRay 2160p TrueHD Atmos 7 1 DV HEVC REMUX-FraMeSToR',
            expected: {
                title: 'Madame Web',
                year: '2024',
                quality: 'BluRay REMUX',
                resolution: '4k',
                channels: ['7.1'],
                audio: ['Atmos', 'TrueHD'],
                codec: 'hevc',
                hdr: ['DV'],
                group: 'FraMeSToR'
            }
        },
        {
            title: 'The.Witcher.US.S01.INTERNAL.1080p.WEB.x264-STRiFE',
            expected: {
                title: 'The Witcher',
                seasons: [1],
                quality: 'WEB',
                resolution: '1080p',
                codec: 'x264',
                group: 'STRiFE'
            }
        },
        {
            title: 'Madame Web (2024) 1080p HINDI ENGLISH 10bit AMZN WEBRip DDP5 1 x265 HEVC - PSA Shadow',
            expected: {
                title: 'Madame Web',
                year: '2024',
                languages: ['en', 'hi'],
                quality: 'WEBRip',
                resolution: '1080p',
                bitDepth: '10bit',
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'hevc',
                network: 'Amazon'
            }
        },
        {
            title: 'The Simpsons S01E01 1080p BluRay x265 HEVC 10bit AAC 5.1 Tigole',
            expected: {
                title: 'The Simpsons',
                seasons: [1],
                episodes: [1],
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'hevc',
                bitDepth: '10bit',
                audio: ['AAC'],
                channels: ['5.1']
            }
        },
        {
            title: '[DB]_Bleach_264_[012073FE].avi',
            expected: {
                title: 'Bleach',
                container: 'avi',
                extension: 'avi',
                episodeCode: '012073FE',
                episodes: [264],
                group: 'DB'
            }
        },
        {
            title: '[SubsPlease] One Piece - 1111 (480p) [2E05E658].mkv',
            expected: {
                title: 'One Piece',
                container: 'mkv',
                resolution: '480p',
                extension: 'mkv',
                episodeCode: '2E05E658',
                episodes: [1111],
                group: 'SubsPlease'
            }
        },
        {
            title: 'One Piece S01E1056 VOSTFR 1080p WEB x264 AAC -Tsundere-Raws (CR) mkv',
            expected: {
                title: 'One Piece',
                seasons: [1],
                episodes: [1056],
                languages: ['fr'],
                container: 'mkv',
                resolution: '1080p',
                quality: 'WEB',
                codec: 'x264',
                audio: ['AAC']
            }
        },
        {
            title: 'Mary.Poppins.1964.50th.ANNIVERSARY.EDITION.REMUX.1080p.Bluray.AVC.DTS-HD.MA.5.1-LEGi0N',
            expected: {
                title: 'Mary Poppins',
                year: '1964',
                edition: 'Anniversary Edition',
                quality: 'BluRay REMUX',
                resolution: '1080p',
                audio: ['DTS Lossless'],
                channels: ['5.1'],
                codec: 'avc',
                group: 'LEGi0N'
            }
        },
        {
            title: 'The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.EXTENDED.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-BOREDOR',
            expected: {
                title: 'The Lord of the Rings The Fellowship of the Ring',
                year: '2001',
                resolution: '4k',
                edition: 'Extended Edition',
                extended: true,
                quality: 'BluRay',
                codec: 'x265',
                bitDepth: '10bit',
                audio: ['Atmos', 'TrueHD'],
                channels: ['7.1'],
                hdr: ['HDR'],
                group: 'BOREDOR'
            }
        },
        {
            title: 'Tyler.Perrys.The.Oval.S01E10.1080p.WEB.H264-CAKES[TGx]',
            expected: {
                title: 'Tyler Perrys The Oval',
                seasons: [1],
                episodes: [10],
                resolution: '1080p',
                quality: 'WEB',
                codec: 'h264',
                group: 'CAKES'
            }
        },
        {
            title: 'Escaflowne (2000) (BDRip 1896x1048p x265 HEVC TrueHD, FLACx3, AC3 5.1x2+2.0x3)(Triple Audio)[sxales].mkv',
            expected: {
                title: 'Escaflowne',
                year: '2000',
                quality: 'BDRip',
                codec: 'hevc',
                languages: ['multi audio'],
                resolution: '1048p',
                audio: ['TrueHD', 'FLAC', 'AC3'],
                channels: ['5.1', '2.0'],
                dubbed: true,
                container: 'mkv',
                extension: 'mkv'
            }
        },
        {
            title: '[www.1TamilMV.pics]_The.Great.Indian.Suicide.2023.Tamil.TRUE.WEB-DL.4K.SDR.HEVC.(DD+5.1.384Kbps.&.AAC).3.2GB.ESub.mkv',
            expected: {
                audio: ['TrueHD', 'DDP', 'AAC'],
                channels: ['5.1'],
                codec: 'hevc',
                container: 'mkv',
                extension: 'mkv',
                hdr: ['SDR'],
                languages: ['en', 'ta'],
                quality: 'WEB-DL',
                resolution: '4k',
                site: 'www.1TamilMV.pics',
                size: '3.2GB',
                subbed: true,
                title: 'The Great Indian Suicide',
                year: '2023'
            }
        },
        {
            title: 'www.5MovieRulz.show - Khel Khel Mein (2024) 1080p Hindi DVDScr - x264 - AAC - 2.3GB.mkv',
            expected: {
                title: 'Khel Khel Mein',
                year: '2024',
                languages: ['hi'],
                quality: 'SCR',
                codec: 'x264',
                audio: ['AAC'],
                resolution: '1080p',
                container: 'mkv',
                extension: 'mkv',
                size: '2.3GB',
                site: 'www.5MovieRulz.show'
            }
        },
        {
            title: '超能警探.Memorist.S01E01.2160p.WEB-DL.H265.AAC-FLTTH.mkv',
            expected: {
                title: 'Memorist',
                seasons: [1],
                episodes: [1],
                languages: ['zh'],
                quality: 'WEB-DL',
                codec: 'h265',
                audio: ['AAC'],
                resolution: '4k',
                container: 'mkv',
                extension: 'mkv',
                group: 'FLTTH'
            }
        },
        {
            title: 'Futurama.S08E03.How.the.West.Was.1010001.1080p.HULU.WEB-DL.DDP5.1.H.264-FLUX.mkv',
            expected: {
                title: 'Futurama',
                seasons: [8],
                episodes: [3],
                network: 'Hulu',
                codec: 'h264',
                container: 'mkv',
                extension: 'mkv',
                audio: ['DDP'],
                channels: ['5.1'],
                quality: 'WEB-DL',
                resolution: '1080p',
                group: 'FLUX'
            }
        },
        {
            title: 'V.H.S.2 [2013] 1080p BDRip x265 DTS-HD MA 5.1 Kira [SEV].mkv',
            expected: {
                title: 'V H S 2',
                year: '2013',
                quality: 'BDRip',
                codec: 'x265',
                audio: ['DTS Lossless'],
                channels: ['5.1'],
                container: 'mkv',
                extension: 'mkv',
                resolution: '1080p'
            }
        },
        {
            title: '{WWW.BLUDV.TV} Love, Death & Robots - 1ª Temporada Completa 2019 (1080p) Acesse o ORIGINAL WWW.BLUDV.TV',
            expected: {
                title: 'Love, Death & Robots',
                seasons: [1],
                languages: ['es'],
                resolution: '1080p',
                year: '2019',
                complete: true,
                site: 'WWW.BLUDV.TV'
            }
        },
        {
            title: 'www.MovCr.to - Bikram Yogi, Guru, Predator (2019) 720p WEB_DL x264 ESubs [Dual Audio]-[Hindi + Eng] - 950MB - MovCr.mkv',
            expected: {
                codec: 'x264',
                container: 'mkv',
                dubbed: true,
                extension: 'mkv',
                group: 'MovCr',
                languages: ['dual audio', 'en', 'hi'],
                quality: 'WEB-DL',
                resolution: '720p',
                site: 'www.MovCr.to',
                size: '950MB',
                subbed: true,
                title: 'Bikram Yogi, Guru, Predator',
                year: '2019'
            }
        },
        {
            title: '28.days.2000.1080p.bluray.x264-mimic.mkv',
            expected: {
                title: '28 days',
                year: '2000',
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'x264',
                container: 'mkv',
                extension: 'mkv',
                group: 'mimic'
            }
        },
        {
            title: '4.20.Massacre.2018.1080p.BluRay.x264.AAC-[YTS.MX].mp4',
            expected: {
                title: '4 20 Massacre',
                year: '2018',
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'x264',
                audio: ['AAC'],
                container: 'mp4',
                extension: 'mp4',
                site: 'YTS.MX'
            }
        },
        {
            title: 'inside.out.2.2024.d.ru.ua.ts.1o8op.mkv',
            expected: {
                title: 'inside out 2',
                year: '2024',
                quality: 'TeleSync',
                container: 'mkv',
                extension: 'mkv',
                languages: ['ru']
            }
        },
        {
            title: 'I.S.S.2023.P.WEB-DL.1O8Op.mkv',
            expected: {
                title: 'I S S',
                year: '2023',
                quality: 'WEB-DL',
                container: 'mkv',
                extension: 'mkv'
            }
        },
        {
            title: 'Skazka.2022.Pa.WEB-DL.1O8Op.mkv',
            expected: {
                title: 'Skazka',
                year: '2022',
                quality: 'WEB-DL',
                container: 'mkv',
                extension: 'mkv'
            }
        },
        {
            title: 'Spider-Man.Across.the.Spider-Verse.2023.Dt.WEBRip.1O8Op.mkv',
            expected: {
                title: 'Spider-Man Across the Spider-Verse',
                year: '2023',
                quality: 'WEBRip',
                container: 'mkv',
                extension: 'mkv'
            }
        },
        {
            title: 'Civil.War.2024.D.WEB-DL.1O8Op.mkv',
            expected: {
                title: 'Civil War',
                year: '2024',
                quality: 'WEB-DL',
                container: 'mkv',
                extension: 'mkv'
            }
        },
        {
            title: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX[TGx]',
            expected: {
                title: 'Dune Part Two',
                year: '2024',
                resolution: '4k',
                quality: 'WEB-DL',
                codec: 'h265',
                audio: ['Atmos', 'DDP'],
                channels: ['5.1'],
                group: 'FLUX',
                hdr: ['DV', 'HDR']
            }
        },
        {
            title: 'Saw.3D.2010.1080p.ITA-ENG.BluRay.x265.AAC-V3SP4EV3R.mkv',
            expected: {
                title: 'Saw 3D',
                year: '2010',
                languages: ['en', 'it'],
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'x265',
                audio: ['AAC'],
                container: 'mkv',
                extension: 'mkv',
                group: 'V3SP4EV3R'
            }
        },
        {
            title: 'Dead Before Dawn 3D (2012) [3D.BLU-RAY] [1080p 3D] [BluRay] [HSBS] [YTS.MX]',
            expected: {
                title: 'Dead Before Dawn',
                year: '2012',
                resolution: '1080p',
                quality: 'BluRay',
                threeD: '3D HSBS',
                site: 'YTS.MX'
            }
        },
        {
            title: 'Wonder.Woman.1984.2020.3D.1080p.BluRay.x264-SURCODE[rarbg]',
            expected: {
                title: 'Wonder Woman 1984',
                year: '2020',
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'x264',
                group: 'SURCODE',
                threeD: '3D'
            }
        },
        {
            title: 'The.Last.of.Us.S01E08.1080p.WEB.H264-CAKES[TGx]',
            expected: {
                title: 'The Last of Us',
                seasons: [1],
                episodes: [8],
                resolution: '1080p',
                quality: 'WEB',
                codec: 'h264',
                group: 'CAKES'
            }
        },
        {
            title: 'The.Office.UK.S01.1080P.BLURAY.REMUX.AVC.DD5.1-NOGRP',
            expected: {
                title: 'The Office',
                seasons: [1],
                quality: 'BluRay REMUX',
                resolution: '1080p',
                audio: ['DD'],
                channels: ['5.1'],
                codec: 'avc',
                group: 'NOGRP'
            }
        },
        {
            title: 'The.Office.US.S01-09.COMPLETE.SERIES.1080P.BLURAY.X265-HIQVE',
            expected: {
                title: 'The Office',
                seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9],
                quality: 'BluRay',
                resolution: '1080p',
                codec: 'x265',
                complete: true,
                group: 'HIQVE'
            }
        },
        {
            title: 'Hard Knocks 2001 S23E01 1080p MAX WEB-DL DDP2 0 x264-NTb[EZTVx.to].mkv',
            expected: {
                title: 'Hard Knocks',
                year: '2001',
                seasons: [23],
                episodes: [1],
                quality: 'WEB-DL',
                resolution: '1080p',
                codec: 'x264',
                audio: ['DDP'],
                channels: ['2.0'],
                group: 'NTb',
                extension: 'mkv',
                container: 'mkv',
                site: 'EZTVx.to'
            }
        },
        {
            title: 'Fallout.S01E03.The.Head.2160p.DV.HDR10Plus.Ai-Enhanced.H265.DDP.5.1.MULTI.RIFE.4.15v2-60fps-DirtyHippie.mkv',
            expected: {
                title: 'Fallout',
                seasons: [1],
                episodes: [3],
                languages: ['multi audio'],
                resolution: '4k',
                codec: 'h265',
                audio: ['DDP'],
                bitDepth: '10bit',
                channels: ['5.1'],
                group: 'DirtyHippie',
                container: 'mkv',
                dubbed: true,
                extension: 'mkv',
                hdr: ['DV', 'HDR10+'],
                upscaled: true
            }
        },
        {
            title: 'BoJack Horseman [06x01-08 of 16] (2019-2020) WEB-DLRip 720p',
            expected: {
                title: 'BoJack Horseman',
                seasons: [6],
                episodes: [1, 2, 3, 4, 5, 6, 7, 8],
                resolution: '720p',
                quality: 'WEB-DLRip',
                complete: true,
                year: '2019-2020'
            }
        },
        {
            title: 'Трон: Наследие / TRON: Legacy (2010) WEB-DL 1080p | D | Open Matte',
            expected: {
                title: 'TRON: Legacy',
                year: '2010',
                languages: ['ru'],
                resolution: '1080p',
                quality: 'WEB-DL'
            }
        },
        {
            title: 'Wentworth.S08E06.PDTV.AAC2.0.x264-BTN',
            expected: {
                title: 'Wentworth',
                seasons: [8],
                episodes: [6],
                quality: 'PDTV',
                codec: 'x264',
                audio: ['AAC'],
                channels: ['2.0'],
                group: 'BTN'
            }
        },
        {
            title: 'www.1Tamilblasters.co - Guardians of the Galaxy Vol. 3 (2023) [4K IMAX UHD HEVC - BDRip - [Tam + Mal + Tel + Hin + Eng] - x264 - DDP5.1 (192Kbps) - 8.3GB - ESub].mkv',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'hevc',
                container: 'mkv',
                edition: 'IMAX',
                extension: 'mkv',
                languages: ['en', 'hi', 'te', 'ta', 'ml'],
                quality: 'BDRip',
                resolution: '4k',
                site: 'www.1Tamilblasters.co',
                size: '8.3GB',
                subbed: true,
                title: 'Guardians of the Galaxy Vol. 3',
                year: '2023'
            }
        },
        {
            title: '【高清影视之家发布 www.hdbthd.com】奥本海默 杜比视界版本 高码版 国英多音轨 中文字幕 .oppenheimer.2023.2160p.hq.web-dl.h265.dv.ddp5.1.2audio-dreamhd',
            expected: {
                title: 'oppenheimer',
                year: '2023',
                languages: ['zh'],
                quality: 'WEB-DL',
                codec: 'h265',
                audio: ['DDP'],
                channels: ['5.1'],
                resolution: '4k',
                site: 'www.hdbthd.com',
                group: 'dreamhd',
                hdr: ['DV']
            }
        },
        {
            title: 'Venom (2018) HD-TS 720p Hindi Dubbed (Clean Audio) x264',
            expected: {
                title: 'Venom',
                year: '2018',
                languages: ['hi'],
                quality: 'TeleSync',
                resolution: '720p',
                codec: 'x264',
                audio: ['HQ'],
                dubbed: true
            }
        },
        {
            title: 'www.Tamilblasters.party - The Wheel of Time (2021) Season 01 EP(01-08) [720p HQ HDRip - [Tam + Tel + Hin] - DDP5.1 - x264 - 2.7GB - ESubs]',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'x264',
                episodes: [1, 2, 3, 4, 5, 6, 7, 8],
                languages: ['hi', 'te', 'ta'],
                quality: 'HDRip',
                resolution: '720p',
                seasons: [1],
                site: 'www.Tamilblasters.party',
                size: '2.7GB',
                subbed: true,
                title: 'The Wheel of Time',
                year: '2021'
            }
        },
        {
            title: 'The.Walking.Dead.S06E07.SUBFRENCH.HDTV.x264-AMB3R.mkv',
            expected: {
                codec: 'x264',
                container: 'mkv',
                episodes: [7],
                extension: 'mkv',
                group: 'AMB3R',
                languages: ['fr'],
                quality: 'HDTV',
                seasons: [6],
                subbed: true,
                title: 'The Walking Dead'
            }
        },
        {
            title: 'The Walking Dead S05E03 720p Remux x264-ASAP[ettv]',
            expected: {
                title: 'The Walking Dead',
                seasons: [5],
                episodes: [3],
                quality: 'REMUX',
                resolution: '720p',
                codec: 'x264',
                group: 'ASAP'
            }
        },
        {
            title: 'www.TamilBlasters.vip - Shang-Chi (2021) [720p BDRip - [Tamil + Telugu + Hindi + Eng] - x264 - DDP5.1 (192 Kbps) - 1.4GB - ESubs].mkv',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'x264',
                container: 'mkv',
                extension: 'mkv',
                languages: ['en', 'hi', 'te', 'ta'],
                quality: 'BDRip',
                resolution: '720p',
                site: 'www.TamilBlasters.vip',
                size: '1.4GB',
                subbed: true,
                title: 'Shang-Chi',
                year: '2021'
            }
        },
        {
            title: 'Game of Thrones 1ª a 8ª Temporada Completa [720p-1080p] [BluRay] [DUAL]',
            expected: {
                title: 'Game of Thrones',
                seasons: [1, 2, 3, 4, 5, 6, 7, 8],
                languages: ['es', 'dual audio'],
                resolution: '1080p',
                quality: 'BluRay',
                complete: true,
                dubbed: true
            }
        },
        {
            title: 'Kill.2024.REPACK.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-XEBEC.mkv',
            expected: {
                title: 'Kill',
                year: '2024',
                resolution: '1080p',
                quality: 'WEB-DL',
                codec: 'h264',
                audio: ['Atmos', 'DDP'],
                channels: ['5.1'],
                group: 'XEBEC',
                container: 'mkv',
                extension: 'mkv',
                network: 'Amazon',
                repack: true
            }
        },
        {
            title: 'Mad.Max.Fury.Road.2015.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265[TGx]',
            expected: {
                title: 'Mad Max Fury Road',
                year: '2015',
                resolution: '1080p',
                codec: 'x265',
                bitDepth: '10bit',
                audio: ['DDP'],
                channels: ['5.1'],
                group: 'GalaxyRG265',
                quality: 'BluRay'
            }
        },
        {
            title: 'Властелин колец: Кольца власти (S1E1-8 of 8) / The Lord of the Rings: The Rings of Power (2022) WEB-DL',
            expected: {
                title: 'Властелин колец: Кольца власти',
                year: '2022',
                seasons: [1],
                episodes: [1, 2, 3, 4, 5, 6, 7, 8],
                languages: ['ru'],
                quality: 'WEB-DL'
            }
        },
        {
            title: '抓娃娃 Successor.2024.TC1080P.国语中字',
            expected: {
                title: 'Successor',
                year: '2024',
                languages: ['zh'],
                resolution: '1080p',
                quality: 'TeleCine'
            }
        },
        {
            title: 'True.Detective.S03E02.720p.WEB.x265-MiNX[eztv].mkv',
            expected: {
                title: 'True Detective',
                seasons: [3],
                episodes: [2],
                resolution: '720p',
                quality: 'WEB',
                codec: 'x265',
                group: 'MiNX',
                extension: 'mkv',
                container: 'mkv'
            }
        },
        {
            title: 'True.Grit.1969.720p.WEB.x265-MiNX[eztv].mkv',
            expected: {
                title: 'True Grit',
                year: '1969',
                resolution: '720p',
                quality: 'WEB',
                codec: 'x265',
                group: 'MiNX',
                extension: 'mkv',
                container: 'mkv'
            }
        },
        {
            title: 'Free Samples (2012) [BluRay] [1080p] [YTS.AM]',
            expected: {
                title: 'Free Samples',
                year: '2012',
                resolution: '1080p',
                quality: 'BluRay'
            }
        },
        {
            title: 'Trailer Park Boys S01-S10 + Movies + Specials + Extras [Ultimate Collection]-CAPTAiN',
            expected: {
                title: 'Trailer Park Boys',
                seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                complete: true,
                group: 'CAPTAiN'
            }
        },
        {
            title: 'Adbhut (2024) Hindi 1080p HDTVRip x264 AAC 5.1 [2.2GB] - QRips',
            expected: {
                title: 'Adbhut',
                year: '2024',
                languages: ['hi'],
                resolution: '1080p',
                quality: 'HDTVRip',
                codec: 'x264',
                audio: ['AAC'],
                channels: ['5.1'],
                group: 'QRips',
                size: '2.2GB'
            }
        },
        {
            title: 'Blood Diamond (2006) 1080p BluRay H264 DolbyD 5 1 + nickarad mp4',
            expected: {
                title: 'Blood Diamond',
                year: '2006',
                resolution: '1080p',
                quality: 'BluRay',
                codec: 'h264',
                audio: ['DD'],
                channels: ['5.1'],
                container: 'mp4'
            }
        },
        {
            title: 'The Lockerbie Bombing (2013) Documentary HDTVRIP',
            expected: {
                title: 'The Lockerbie Bombing',
                year: '2013',
                documentary: true,
                quality: 'HDTVRip'
            }
        },
        {
            title: 'STEVE.martin.a.documentary.in.2.pieces.S01.COMPLETE.1080p.WEB.H264-SuccessfulCrab[TGx]',
            expected: {
                title: 'STEVE martin a documentary in 2 pieces',
                seasons: [1],
                quality: 'WEB',
                codec: 'h264',
                group: 'SuccessfulCrab',
                resolution: '1080p',
                documentary: true,
                complete: true
            }
        },
        {
            title: 'The New Frontier S01E10 720p WEB H264-INFLATE[eztv] mkv',
            expected: {
                title: 'The New Frontier',
                seasons: [1],
                episodes: [10],
                quality: 'WEB',
                container: 'mkv',
                codec: 'h264',
                group: 'INFLATE',
                resolution: '720p'
            }
        },
        {
            title: '[BEST-TORRENTS.COM] The.Penguin.S01E07.MULTi.1080p.AMZN.WEB-DL.H264.DDP5.1.Atmos-K83',
            expected: {
                title: 'The Penguin',
                seasons: [1],
                episodes: [7],
                languages: ['multi audio'],
                resolution: '1080p',
                quality: 'WEB-DL',
                network: 'Amazon',
                codec: 'h264',
                dubbed: true,
                audio: ['Atmos', 'DDP'],
                channels: ['5.1'],
                site: 'BEST-TORRENTS.COM'
            }
        },
        {
            title: '[ Torrent911.my ] The.Penguin.S01E07.FRENCH.WEBRip.x264.mp4',
            expected: {
                title: 'The Penguin',
                seasons: [1],
                episodes: [7],
                languages: ['fr'],
                quality: 'WEBRip',
                codec: 'x264',
                site: 'Torrent911.my',
                container: 'mp4',
                extension: 'mp4'
            }
        },
        {
            title: 'The.O.C.Seasons.01-04.AMZN.1080p.10bit.x265.hevc-Bearfish',
            expected: {
                title: 'The O C',
                seasons: [1, 2, 3, 4],
                resolution: '1080p',
                network: 'Amazon',
                codec: 'hevc',
                bitDepth: '10bit',
                group: 'Bearfish'
            }
        },
        {
            title: 'The Adam Project 2022 2160p NF WEB-DL DDP 5 1 Atmos DoVi HDR HEVC-SiC mkv',
            expected: {
                title: 'The Adam Project',
                year: '2022',
                resolution: '4k',
                quality: 'WEB-DL',
                network: 'Netflix',
                codec: 'hevc',
                container: 'mkv',
                audio: ['Atmos', 'DDP'],
                channels: ['5.1'],
                hdr: ['DV', 'HDR'],
                group: 'SiC'
            }
        },
        {
            title: '1923 S02E01 The Killing Season 1080p AMZN WEB-DL DDP5 1 H 264-FLUX[TGx]',
            expected: {
                title: '1923',
                seasons: [2],
                episodes: [1],
                resolution: '1080p',
                quality: 'WEB-DL',
                network: 'Amazon',
                codec: 'h264',
                audio: ['DDP'],
                channels: ['5.1'],
                group: 'FLUX'
            }
        },
        {
            title: '1883.S01E01.1883.2160p.WEB-DL.DDP5.1.H.265-NTb.mkv',
            expected: {
                title: '1883',
                seasons: [1],
                episodes: [1],
                resolution: '4k',
                quality: 'WEB-DL',
                codec: 'h265',
                audio: ['DDP'],
                channels: ['5.1'],
                group: 'NTb',
                extension: 'mkv',
                container: 'mkv'
            }
        },
        {
            title: '1923 S02E01 1080p WEB H264-SuccessfulCrab',
            expected: {
                title: '1923',
                seasons: [2],
                episodes: [1],
                resolution: '1080p',
                quality: 'WEB',
                codec: 'h264',
                group: 'SuccessfulCrab'
            }
        },
        {
            title: 'Inherent.Vice.2014.1080p.BluRay.AVC.DTS-HD.MA.5.1-RARBG',
            expected: {
                title: 'Inherent Vice',
                year: '2014',
                resolution: '1080p',
                codec: 'avc',
                audio: ['DTS Lossless'],
                channels: ['5.1'],
                group: 'RARBG',
                quality: 'BluRay'
            }
        },
        {
            title: 'Агентство / The Agency / Сезон: 1 / Серии: 1-10 из 10 [2024 HEVC HDR10 Dolby Vision WEB-DL 2160p 4k] MVO (HDRezka Studio) + DVO (Viruse Project) + Original + Sub (Eng)',
            expected: {
                title: 'The Agency',
                seasons: [1],
                episodes: intRange(1, 10),
                languages: ['en', 'ru'],
                quality: 'WEB-DL',
                resolution: '4k',
                bitDepth: '10bit',
                codec: 'hevc',
                hdr: ['DV', 'HDR'],
                subbed: true,
                year: '2024',
                group: 'Eng'
            }
        },
        {
            title: 'A Complete Unknown 2024 1080p MA WEB-DL DDP5 1 Atmos H 264-BYNDR mkv',
            expected: {
                title: 'A Complete Unknown',
                year: '2024',
                quality: 'WEB-DL',
                resolution: '1080p',
                codec: 'h264',
                container: 'mkv',
                group: 'BYNDR',
                audio: ['Atmos', 'DDP'],
                channels: ['5.1']
            }
        },
        {
            title: '[Ex-torrenty.org]iCarly.S04.PLDUB.1080p.AMZN.WEB-DL.DDP2.0.H264-Ralf',
            expected: {
                audio: ['DDP'],
                channels: ['2.0'],
                codec: 'h264',
                group: 'Ralf',
                languages: ['pl'],
                network: 'Amazon',
                quality: 'WEB-DL',
                resolution: '1080p',
                seasons: [4],
                site: 'Ex-torrenty.org',
                title: 'iCarly'
            }
        },
        {
            title: 'Deadpool (2016) [2160p] [7.1 AAC ENG] [5.1 AAC ENG FRE GER ITA SPA] [COMMENTARY] [Multi-Sub] [10bit] [UHD] [HEVC] [x265] [pseudo].mkv',
            expected: {
                audio: ['AAC'],
                bitDepth: '10bit',
                channels: ['5.1', '7.1'],
                codec: 'hevc',
                commentary: true,
                container: 'mkv',
                extension: 'mkv',
                languages: ['multi subs', 'en', 'fr', 'es', 'it', 'de'],
                resolution: '4k',
                subbed: true,
                title: 'Deadpool',
                year: '2016'
            }
        },
        {
            title: 'Deadpool [BDremux 1080p][AC3 5.1-DTS 5.1 Castellano-DTSEX 5.1 Ingles+Subs][ES-EN]',
            expected: {
                audio: ['DTS Lossless', 'DTS Lossy', 'AC3'],
                channels: ['5.1'],
                languages: ['en', 'es'],
                quality: 'BluRay REMUX',
                resolution: '1080p',
                subbed: true,
                title: 'Deadpool'
            }
        },
        {
            title: 'X-Men Complete 13 Movie Collection Sci-Fi 2000 - 2020 Eng Rus Multi-Subs 1080p [H264-mp4]',
            expected: {
                container: 'mp4',
                resolution: '1080p',
                complete: true,
                codec: 'h264',
                languages: ['multi subs', 'en', 'ru'],
                subbed: true,
                title: 'X-Men Complete 13 Movie Collection Sci-Fi',
                year: '2000-2020'
            }
        },
        {
            title: 'BLACK PANTHER - Wakanda Forever (2022) 10bit.m1080p.BRRip.H265.MKV.AC3-5.1 DUBPL-ENG-NapisyPL [StarLord]',
            expected: {
                container: 'mkv',
                resolution: '1080p',
                codec: 'h265',
                languages: ['en', 'pl'],
                audio: ['AC3'],
                bitDepth: '10bit',
                channels: ['5.1'],
                quality: 'BRRip',
                year: '2022',
                title: 'BLACK PANTHER - Wakanda Forever'
            }
        },
        {
            title: 'The.White.Lotus.2.Sezon.7.Bölüm.2021.1080p.BLUTV.WEB-DL.AAC2.0.H.264-TURG.mkv',
            expected: {
                container: 'mkv',
                resolution: '1080p',
                codec: 'h264',
                episodes: [7],
                seasons: [2],
                audio: ['AAC'],
                channels: ['2.0'],
                quality: 'WEB-DL',
                title: 'The White Lotus',
                year: '2021',
                extension: 'mkv',
                group: 'TURG'
            }
        },
        {
            title: 'Apollo 13 (1995) [1080p] [WEB-DL] [x264] [E-AC3-S78] [Lektor PL]',
            expected: {
                audio: ['EAC3'],
                codec: 'x264',
                languages: ['pl'],
                quality: 'WEB-DL',
                resolution: '1080p',
                title: 'Apollo 13',
                year: '1995'
            }
        },
        {
            title: "The Killer's Game 2024 PL 1080p WEB-DL H264 DD5.1-S56",
            expected: {
                audio: ['DD'],
                channels: ['5.1'],
                codec: 'h264',
                languages: ['pl'],
                quality: 'WEB-DL',
                resolution: '1080p',
                title: "The Killer's Game",
                year: '2024'
            }
        },
        {
            title: '[a-s]_fairy_tail_-_003_-_infiltrate_the_everlue_mansion__rs2_[1080p_bd-rip][4CB16872].mkv',
            expected: {
                container: 'mkv',
                episodeCode: '4CB16872',
                episodes: [3],
                extension: 'mkv',
                group: 'a-s',
                quality: 'BDRip',
                resolution: '1080p',
                title: 'fairy tail'
            }
        }
    ];
    testCases.forEach(({ title, expected }) => {
        test(title, () => {
            const result = (0, index_1.parseTorrentTitle)(title);
            // Check each expected property
            Object.keys(expected).forEach((key) => {
                const expectedValue = expected[key];
                const actualValue = result[key];
                if (Array.isArray(expectedValue)) {
                    expect(actualValue).toEqual(expectedValue);
                }
                else {
                    expect(actualValue).toBe(expectedValue);
                }
            });
        });
    });
});
describe('Parse Torrent Title - Additional Cases', () => {
    const additionalCases = [
        {
            title: '[Golumpa] Fairy Tail - 214 [FuniDub 720p x264 AAC] [5E46AC39]',
            expected: {
                audio: ['AAC'],
                codec: 'x264',
                episodeCode: '5E46AC39',
                episodes: [214],
                group: 'Golumpa',
                resolution: '720p',
                title: 'Fairy Tail'
            }
        },
        {
            title: 'The.Matrix.1999.1080p.BluRay.x264',
            expected: {
                codec: 'x264',
                resolution: '1080p',
                quality: 'BluRay',
                title: 'The Matrix',
                year: '1999'
            }
        }
    ];
    additionalCases.forEach(({ title, expected }) => {
        test(title, () => {
            const result = (0, index_1.parseTorrentTitle)(title);
            Object.keys(expected).forEach((key) => {
                const expectedValue = expected[key];
                const actualValue = result[key];
                if (Array.isArray(expectedValue)) {
                    expect(actualValue).toEqual(expectedValue);
                }
                else {
                    expect(actualValue).toBe(expectedValue);
                }
            });
        });
    });
});
describe('Parse Torrent Title - Edge Cases', () => {
    const edgeCases = [
        {
            title: 'Game of Thrones - Sezon 4 Odcinek 10 [480p.720p.WEB-DL.H264-NitroTeam] [Lektor PL].mkv',
            expected: {
                codec: 'h264',
                container: 'mkv',
                extension: 'mkv',
                languages: ['pl'],
                quality: 'WEB-DL',
                resolution: '720p',
                seasons: [4],
                title: 'Game of Thrones'
            }
        },
        {
            title: '[Taxi 1998] [BDRemux Rutracker.org].mkv',
            expected: {
                container: 'mkv',
                extension: 'mkv',
                quality: 'BluRay REMUX',
                site: 'Rutracker.org',
                title: 'Taxi',
                year: '1998'
            }
        },
        {
            title: 'www 1TamilBlasters tel - Migration (2023) [English - 720p HQ HDRip - x264 - [DD5 1  (192Kbps) + AAC] - 850MB - ESub] mkv',
            expected: {
                audio: ['DD', 'AAC'],
                channels: ['5.1'],
                codec: 'x264',
                container: 'mkv',
                languages: ['en'],
                quality: 'HDRip',
                resolution: '720p',
                site: 'www 1TamilBlasters tel',
                size: '850MB',
                subbed: true,
                title: 'Migration',
                year: '2023'
            }
        },
        {
            title: 'www TamilBlasters tel - Sonic the Hedgehog 2 (2022) English 720p HDRip x264 AAC 800MB ESubs mkv',
            expected: {
                audio: ['AAC'],
                codec: 'x264',
                container: 'mkv',
                languages: ['en'],
                quality: 'HDRip',
                resolution: '720p',
                site: 'www TamilBlasters tel',
                size: '800MB',
                subbed: true,
                title: 'Sonic the Hedgehog 2',
                year: '2022'
            }
        },
        {
            title: 'The.Hunting.Party.S01E01.Richard.Harris.1080p.10bit.AMZN.WEB-DL.DDP5.1.HEVC-Vyndros.mkv',
            expected: {
                resolution: '1080p',
                quality: 'WEB-DL',
                bitDepth: '10bit',
                codec: 'hevc',
                channels: ['5.1'],
                audio: ['DDP'],
                group: 'Vyndros',
                container: 'mkv',
                seasons: [1],
                episodes: [1],
                network: 'Amazon',
                extension: 'mkv',
                title: 'The Hunting Party'
            }
        },
        {
            title: 'Search.WWW.S01.KOREAN.1080p.NF.WEBRip.DDP2.0.x264-ExREN[rartv]',
            expected: {
                audio: ['DDP'],
                channels: ['2.0'],
                codec: 'x264',
                group: 'ExREN',
                languages: ['ko'],
                network: 'Netflix',
                quality: 'WEBRip',
                resolution: '1080p',
                seasons: [1],
                title: 'Search WWW'
            }
        },
        {
            title: 'www.-tamil-blasters.hair-deiva-thirumagal-2011-tamil-1080p-hq-hdrip-x-264-ddp-5.1-640-kbps-aac-3-gb',
            expected: {
                quality: 'HDRip',
                codec: 'x264',
                audio: ['DDP'],
                channels: ['5.1'],
                group: 'gb',
                languages: ['ta'],
                resolution: '1080p',
                title: 'deiva-thirumagal',
                year: '2011',
                site: 'www.-tamil-blasters.hair'
            }
        },
        {
            title: 'That 70s Show S02 1080p BluRay REMUX AVC DTS-HD MA 5 1-EPSiLON',
            expected: {
                audio: ['DTS Lossless'],
                channels: ['5.1'],
                codec: 'avc',
                group: 'EPSiLON',
                quality: 'BluRay REMUX',
                resolution: '1080p',
                seasons: [2],
                title: 'That 70s Show'
            }
        },
        {
            title: 'Emma.1996.TV.Movie.x264.aac.2.0.mkv',
            expected: {
                channels: ['2.0'],
                codec: 'x264',
                container: 'mkv',
                extension: 'mkv',
                title: 'Emma',
                year: '1996'
            }
        },
        {
            title: '"Popeye 1960-1961 TV Version MKV"',
            expected: {
                complete: true,
                container: 'mkv',
                title: 'Popeye',
                year: '1960-1961'
            }
        },
        {
            title: '[bonkai77].RahXephon.Episode.08.Bitterly.Cold.Holy.Night.[BD.1080p.Dual.Audio.x265.HEVC.10bit].mkv',
            expected: {
                bitDepth: '10bit',
                codec: 'hevc',
                container: 'mkv',
                dubbed: true,
                episodes: [8],
                extension: 'mkv',
                group: 'bonkai77',
                languages: ['dual audio'],
                quality: 'BDRip',
                resolution: '1080p',
                title: 'RahXephon'
            }
        },
        {
            title: 'The Shawshank Redemption 1994 1080p BluRay DDP 5 1 x265-EDGE2020 mkv',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'x265',
                quality: 'BluRay',
                resolution: '1080p',
                title: 'The Shawshank Redemption',
                year: '1994',
                group: 'EDGE2020'
            }
        },
        {
            title: 'Mission Impossible Dead Reckoning Part One 2023 1080p BluRay DDP 7 1 x265-EDGE2020 mkv',
            expected: {
                audio: ['DDP'],
                channels: ['7.1'],
                codec: 'x265',
                container: 'mkv',
                group: 'EDGE2020',
                quality: 'BluRay',
                resolution: '1080p',
                title: 'Mission Impossible Dead Reckoning Part One',
                year: '2023'
            }
        },
        {
            title: 'Interstellar 2014 1080p BluRay DDP 5 1 x265-EDGE2020 mkv',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'x265',
                container: 'mkv',
                group: 'EDGE2020',
                quality: 'BluRay',
                resolution: '1080p',
                title: 'Interstellar',
                year: '2014'
            }
        },
        {
            title: 'The Fairly OddParents Fairly Odder S01 720p PMTP WEBRip DDP5 1 x264 TEPES rartv ORARBG',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'x264',
                quality: 'WEBRip',
                resolution: '720p',
                seasons: [1],
                title: 'The Fairly OddParents Fairly Odder'
            }
        },
        {
            title: 'Formula1.S2025E86.Italy.Grand.Prix.1080i.HDTV.MPA2.0.H.264-playTV',
            expected: {
                codec: 'h264',
                episodes: [86],
                group: 'playTV',
                quality: 'HDTV',
                resolution: '1080p',
                seasons: [2025],
                title: 'Formula1'
            }
        },
        {
            title: 'Georgie and Mandys First Marriage S01E18 TV Money 720p AMZN WEB DL DDP5 1 H 264 FLUX EZTV',
            expected: {
                audio: ['DDP'],
                channels: ['5.1'],
                codec: 'h264',
                quality: 'WEB-DL',
                resolution: '720p',
                seasons: [1],
                episodes: [18],
                network: 'Amazon',
                title: 'Georgie and Mandys First Marriage'
            }
        },
        {
            title: 'Dragon Ball Z (Complete Series) [1080p] [MP4] [English Audio]',
            expected: {
                complete: true,
                container: 'mp4',
                languages: ['en'],
                resolution: '1080p',
                title: 'Dragon Ball Z'
            }
        },
        {
            title: 'Implosion The Titanic Sub Disaster 2025 720p AMZN WEB-DL DDP2 0 H 264-Kitsune',
            expected: {
                audio: ['DDP'],
                channels: ['2.0'],
                codec: 'h264',
                group: 'Kitsune',
                network: 'Amazon',
                quality: 'WEB-DL',
                resolution: '720p',
                title: 'Implosion The Titanic Sub Disaster',
                year: '2025'
            }
        }
    ];
    edgeCases.forEach(({ title, expected }) => {
        test(title, () => {
            const result = (0, index_1.parseTorrentTitle)(title);
            Object.keys(expected).forEach((key) => {
                const expectedValue = expected[key];
                const actualValue = result[key];
                if (Array.isArray(expectedValue)) {
                    expect(actualValue).toEqual(expectedValue);
                }
                else {
                    expect(actualValue).toBe(expectedValue);
                }
            });
        });
    });
});
describe('Parse Torrent Title - Anime Tests', () => {
    const animeCases = [
        {
            title: 'Detective Conan season 1 to season 22 + season 23(incomplete)',
            expected: {
                group: 'incomplete',
                seasons: intRange(1, 22),
                title: 'Detective Conan'
            }
        },
        {
            title: 'One Piece Season  2 Complete 009 - 030 720p HDTV x264 [i_c]',
            expected: {
                codec: 'x264',
                complete: true,
                episodes: intRange(9, 30),
                quality: 'HDTV',
                resolution: '720p',
                seasons: [2],
                title: 'One Piece'
            }
        },
        {
            title: '[EMBER] Sousou no Frieren - 01.mkv',
            expected: {
                container: 'mkv',
                episodes: [1],
                extension: 'mkv',
                group: 'EMBER',
                title: 'Sousou no Frieren'
            }
        },
        {
            title: 'S01E01-The Storm Dragon, Veldora [47C8F23B].mkv',
            expected: {
                container: 'mkv',
                episodeCode: '47C8F23B',
                episodes: [1],
                extension: 'mkv',
                seasons: [1],
                title: 'The Storm Dragon, Veldora'
            }
        },
        {
            title: '[MTBB] Mushoku Tensei - 05v3 [30C35CEC].mkv',
            expected: {
                container: 'mkv',
                episodeCode: '30C35CEC',
                episodes: [5],
                extension: 'mkv',
                group: 'MTBB',
                title: 'Mushoku Tensei'
            }
        },
        {
            title: '[MTBB] Mushoku Tensei - 15 [201D4E93].mkv',
            expected: {
                container: 'mkv',
                episodeCode: '201D4E93',
                episodes: [15],
                extension: 'mkv',
                group: 'MTBB',
                title: 'Mushoku Tensei'
            }
        },
        {
            title: '[Salieri] Mushoku Tensei - Jobless Reincarnation - 17.5 (1080p) (HDR) [Dual Audio].mkv',
            expected: {
                container: 'mkv',
                dubbed: true,
                episodes: [17],
                extension: 'mkv',
                group: 'Salieri',
                hdr: ['HDR'],
                languages: ['dual audio'],
                resolution: '1080p',
                title: 'Mushoku Tensei - Jobless Reincarnation'
            }
        },
        {
            title: '[Anime Time] One Piece (0001-1071+Movies+Specials) [BD+CR] [Dual Audio] [1080p][HEVC 10bit x265][AAC][Multi Sub]',
            expected: {
                audio: ['AAC'],
                bitDepth: '10bit',
                codec: 'hevc',
                dubbed: true,
                episodes: intRange(1, 1071),
                group: 'Anime Time',
                languages: ['multi subs', 'dual audio'],
                resolution: '1080p',
                subbed: true,
                title: 'One Piece'
            }
        },
        {
            title: '[New-raws] One Piece -1093 [1080p] [WEB].mkv',
            expected: {
                container: 'mkv',
                episodes: [1093],
                extension: 'mkv',
                group: 'New-raws',
                quality: 'WEB',
                resolution: '1080p',
                title: 'One Piece'
            }
        },
        {
            title: '[Erai-raws] Boku no Hero Academia S2 - 00~25 [1080p][Multiple Subtitle]',
            expected: {
                episodes: intRange(0, 25),
                group: 'Erai-raws',
                languages: ['multi subs'],
                resolution: '1080p',
                seasons: [2],
                subbed: true,
                title: 'Boku no Hero Academia'
            }
        },
        {
            title: 'One.Piece.S004E111.Dash.For.a.Miracle!.Alabasta.Animal.Land!.1080p.NF.WEB-DL.DDP2.0.x264-KQRM.mkv',
            expected: {
                audio: ['DDP'],
                channels: ['2.0'],
                codec: 'x264',
                container: 'mkv',
                episodes: [111],
                extension: 'mkv',
                group: 'KQRM',
                network: 'Netflix',
                quality: 'WEB-DL',
                resolution: '1080p',
                seasons: [4],
                title: 'One Piece'
            }
        },
        {
            title: '[Anime Time] One Punch Man [S1+S2+OVA&ODA][Dual Audio][1080p BD][HEVC 10bit x265][AAC][Eng Subs]',
            expected: {
                audio: ['AAC'],
                bitDepth: '10bit',
                codec: 'hevc',
                dubbed: true,
                group: 'Anime Time',
                languages: ['dual audio', 'en'],
                resolution: '1080p',
                releaseTypes: ['OVA', 'ODA'],
                seasons: [1, 2],
                subbed: true,
                title: 'One Punch Man'
            }
        },
        {
            title: 'One Punch Man S2 OVA - 02.mkv',
            expected: {
                container: 'mkv',
                episodes: [2],
                extension: 'mkv',
                releaseTypes: ['OVA'],
                seasons: [2],
                title: 'One Punch Man'
            }
        },
        {
            title: '[Lazyleido-Mini] DIGIMON BEATBREAK - 08 (S01E08) - (WEB 1080p AV1 10-bit AAC 2.0) [9FE6F0C7]',
            expected: {
                episodeCode: '9FE6F0C7',
                resolution: '1080p',
                quality: 'WEB',
                audio: ['AAC'],
                bitDepth: '10bit',
                codec: 'av1',
                channels: ['2.0'],
                seasons: [1],
                episodes: [8],
                group: 'Lazyleido-Mini',
                title: 'DIGIMON BEATBREAK'
            }
        },
        {
            title: '[Anipakku] Shingeki no Kyojin - Season 3 46.mkv',
            expected: {
                container: 'mkv',
                episodes: [46],
                extension: 'mkv',
                group: 'Anipakku',
                seasons: [3],
                title: 'Shingeki no Kyojin'
            }
        },
        {
            title: 'Что случилось, тигровая лилия[torrents.ru].avi',
            expected: {
                container: 'avi',
                extension: 'avi',
                languages: ['ru'],
                site: 'torrents.ru',
                title: 'Что случилось, тигровая лилия'
            }
        },
        {
            title: "[Anime Time] Naruto - 116 - 360 Degrees of Vision The Byakugan's Blind Spot.mkv",
            expected: {
                title: 'Naruto',
                episodes: [116],
                group: 'Anime Time',
                extension: 'mkv',
                container: 'mkv'
            }
        },
        {
            title: '[DKB] Blue Lock - (Season 01) [1080p][HEVC x265 10bit][Multi-Subs]',
            expected: {
                title: 'Blue Lock',
                seasons: [1],
                languages: ['multi subs'],
                resolution: '1080p',
                bitDepth: '10bit',
                codec: 'hevc',
                subbed: true,
                group: 'DKB'
            }
        },
        {
            title: '[JySzE] Naruto [v2] [R2J] [VFR] [Dual Audio] [Complete] [Extras] [x264]',
            expected: {
                title: 'Naruto',
                languages: ['dual audio', 'fr'],
                codec: 'x264',
                dubbed: true,
                group: 'JySzE',
                complete: true,
                region: 'R2J'
            }
        },
        {
            title: 'Naruto HD [1080p] (001-220) [Complete Series + Movies]',
            expected: {
                title: 'Naruto',
                episodes: intRange(1, 220),
                resolution: '1080p',
                quality: 'HDTV',
                complete: true
            }
        },
        {
            title: '[JySzE] Naruto [v3] [R2J] [VFR] [Dual Audio] [Complete] [Extras] [x264]',
            expected: {
                title: 'Naruto',
                languages: ['dual audio', 'fr'],
                codec: 'x264',
                dubbed: true,
                group: 'JySzE',
                complete: true,
                region: 'R2J'
            }
        },
        {
            title: 'NARUTO CARTOON NETWORK-TOONAMI BROADCAST (2005-2009) [TVRip] [Episodes 001-209 Movies 1 & 3 & OVA)',
            expected: {
                complete: true,
                episodes: intRange(1, 209),
                network: 'Cartoon Network',
                quality: 'TVRip',
                releaseTypes: ['OVA'],
                title: 'NARUTO',
                year: '2005-2009'
            }
        },
        {
            title: 'Naruto Complete [Ep 01 - 220][English][480p]',
            expected: {
                title: 'Naruto',
                episodes: intRange(1, 220),
                languages: ['en'],
                complete: true,
                resolution: '480p'
            }
        },
        {
            title: '[DBD-Raws][火影忍者/Naruto/NARUTO -ナルト-][166-192TV][BOX7][美版/USA.Ver][1080P][BDRip][HEVC-10bit][FLAC][MKV]',
            expected: {
                title: 'Naruto',
                episodes: intRange(166, 192),
                languages: ['ja', 'zh'],
                quality: 'BDRip',
                audio: ['FLAC'],
                resolution: '1080p',
                codec: 'hevc',
                bitDepth: '10bit',
                container: 'mkv',
                group: 'DBD-Raws'
            }
        },
        {
            title: 'Naruto Collection [DB 1080p][ Dual Audio ][ English & Arabic Sub ]',
            expected: {
                title: 'Naruto',
                languages: ['dual audio', 'en', 'ar'],
                resolution: '1080p',
                subbed: true,
                dubbed: true,
                complete: true
            }
        },
        {
            title: 'One Punch Man (2019) - S02 - E01 à E12 - [WEB-DL][1080p][Multiple Subtitle][x264][Intégrale Saison 02]',
            expected: {
                codec: 'x264',
                complete: true,
                episodes: intRange(1, 12),
                languages: ['fr', 'multi subs'],
                quality: 'WEB-DL',
                resolution: '1080p',
                seasons: [2],
                subbed: true,
                title: 'One Punch Man',
                year: '2019'
            }
        },
        {
            title: 'FRASIER 1993-2004 [S01-11] [1080P WEB-DL H265 EAC3-FT] [ENG-LEKTOR PL] [ALUSIA]',
            expected: {
                audio: ['EAC3'],
                codec: 'h265',
                complete: true,
                languages: ['en', 'pl'],
                quality: 'WEB-DL',
                resolution: '1080p',
                seasons: intRange(1, 11),
                title: 'FRASIER',
                year: '1993-2004'
            }
        },
        {
            title: '[Erai-raws] Fumetsu no Anata e Season 3 - 14 [1080p CR WEBRip HEVC AAC][MultiSub][94F6389A]',
            expected: {
                audio: ['AAC'],
                codec: 'hevc',
                episodeCode: '94F6389A',
                episodes: [14],
                group: 'Erai-raws',
                languages: ['multi subs'],
                quality: 'WEBRip',
                resolution: '1080p',
                seasons: [3],
                title: 'Fumetsu no Anata e'
            }
        },
        {
            title: 'Erai-raws-Fumetsu_no_Anata_e_Season_3-01-720p_CR_WEB-DL_AVC_AAC-MultiSub-C3769633.mkv',
            expected: {
                audio: ['AAC'],
                codec: 'avc',
                episodes: [1],
                extension: 'mkv',
                group: 'Erai-raws',
                languages: ['multi subs'],
                quality: 'WEB-DL',
                resolution: '720p',
                seasons: [3],
                title: 'Fumetsu no Anata e'
            }
        }
    ];
    animeCases.forEach(({ title, expected }) => {
        test(title, () => {
            const result = (0, index_1.parseTorrentTitle)(title);
            Object.keys(expected).forEach((key) => {
                const expectedValue = expected[key];
                const actualValue = result[key];
                if (Array.isArray(expectedValue)) {
                    expect(actualValue).toEqual(expectedValue);
                }
                else {
                    expect(actualValue).toBe(expectedValue);
                }
            });
        });
    });
});
