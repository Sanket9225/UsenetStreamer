"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Language Detection Tests', () => {
    // Test cases ported from languages_test.go
    const testCases = [
        // Named tests from first block
        ['Deadpool 2016 1080p BluRay DTS Rus Ukr 3xEng HDCL', ['ru', 'uk']],
        ['VAIANA: MOANA (2017) NL-Retail [2D] EAGLE', ['nl']],
        ['De Noodcentrale S02E05 FLEMISH 540p WEBRip AAC H 264', ['nl']],
        ['The Intern 2015 TRUEFRENCH 720p BluRay x264-PiNKPANTERS', ['fr']],
        ['After Earth 2013 VFF BDrip x264 YJ', ['fr']],
        ['127.Heures.FRENCH.DVDRip.AC3.XViD-DVDFR', ['fr']],
        ['Color.Of.Night.Unrated.DC.VostFR.BRrip.x264', ['fr']],
        [
            'Le Labyrinthe 2014 Multi-VF2 1080p BluRay x264-PopHD',
            ['multi audio', 'fr']
        ],
        ["Maman, j'ai raté l'avion 1990 VFI 1080p BluRay DTS x265-HTG", ['fr']],
        ['South.Park.S21E10.iTALiAN.FiNAL.AHDTV.x264-NTROPiC', ['it']],
        // Second block - unnamed tests
        ['2- English- {SDH}.srt', ['en']],
        ['1_ English-Subs.srt', ['en']],
        [
            'House S 1 CD 1-6 svensk, danska, norsk, finsk sub',
            ['da', 'fi', 'sv', 'no']
        ],
        ['Svein.Og.Rotta.NORSK.Nordic.Subs.2006', ['da', 'fi', 'sv', 'no']],
        ['Borat med Norsk Undertekst', ['no']],
        ['Subs/21_Bokmal.srt', ['no']],
        ['Subs/nob.srt', ['no']],
        ['Subs/5_nor.srt', ['no']],
        [
            'Curious.George.2.Follow.That.Monkey.2009.DK.SWE.UK.PAL.DVDR-CATC',
            ['da', 'sv']
        ],
        ['Yes.Man.Dk-Subs.2009.dingel', ['da']],
        ['Dan-SDH.srt', ['da']],
        ['dan.srt', ['da']],
        ['Red Riding 1974 [2009 PAL DVD][En Subs[Sv.No.Fi]', ['en', 'fi', 'sv']],
        [
            'Comme une Image (Look at Me) [2004 PAL DVD][Fr Subs[Sv.Da.No]',
            ['fr', 'sv']
        ],
        [
            'A.Good.Day.To.Die.Hard.2013.SWESUB.DANSUB.FiNSUB.720p.WEB-DL.-Ro',
            ['da', 'fi', 'sv']
        ],
        [
            'The.Prisoner.1967-1968.Complete.Series.Subs.English+Nordic',
            ['en', 'da', 'fi', 'sv', 'no']
        ],
        ['Royal.Pains.S05E02.HDTV.subtitulado.esp.sc.avi', ['es']],
        ['Desmembrados (2006) [HDrip-XviD-AC3][Castellano]', ['es']],
        ['10_Spanish-Subs.srt', ['es']],
        [
            'Patriot Games [1992] Eng, Ger, Cze, Hun, Pol + multisub  DVDrip',
            ['multi subs', 'en', 'de', 'pl', 'cs', 'hu']
        ],
        [
            'Elvis Presley - La via del Male (King creole) - IT EN FR DE ES',
            ['en', 'fr', 'es', 'it', 'de']
        ],
        [
            'FernGully [H264 - Ita Dut Fre Ger Eng Spa Aac - MultiSub]',
            ['multi subs', 'en', 'fr', 'es', 'it', 'de', 'nl']
        ],
        ['Jesus de Montreal / Jesus of Montreal - subtitulos espanol', ['es']],
        ['Los.Vengadores.DVDR español ingles clon', ['en', 'es']],
        [
            'EMPIRE STATE 2013 DVDRip TRNC English and Española Latin',
            ['en', 'es-419']
        ],
        ['Mary Poppins Returns 2019 DVDRip LATINO-1XBET', ['es-419']],
        ['Los Simpsons S18 E01 Latino', ['es-419']],
        [
            'Spider-Man (2002) Blu-Ray [720p] Dual Ingles-Español',
            ['dual audio', 'en', 'es']
        ],
        [
            'Abuela (2015) 1080p BluRay x264 AC3 Dual Latino-Inglés',
            ['dual audio', 'en', 'es-419']
        ],
        ['Dumbo.2019.1080p.Dual.Lat', ['dual audio', 'es-419']],
        ['A.Score.to.Settle.2019.lati.mp4', ['es-419']],
        [
            '[S0.E04] Gambit królowej - Gra środkowa.Spanish Latin America.srt',
            ['es-419']
        ],
        ['Latin American.spa.srt', ['es-419']],
        ['Men in Black International 2019 (inglês português)', ['en', 'pt']],
        [
            'Assassins (1995) Sylvester Stallone.DVDrip.XviD - Italian Englis',
            ['en', 'it']
        ],
        ['El Club de la Lucha[dvdrip][spanish]', ['es']],
        [
            'The Curse Of The Weeping Woman 2019 BluRay 1080p Tel+Tam+hin+eng',
            ['en', 'hi', 'te', 'ta']
        ],
        [
            'Inception 2010 1080p BRRIP[dual-audio][eng-hindi]',
            ['dual audio', 'en', 'hi']
        ],
        [
            'Inception (2010) 720p BDRip Tamil+Telugu+Hindi+Eng',
            ['en', 'hi', 'te', 'ta']
        ],
        ['Subs/Dear.S01E02.WEBRip.x265-ION265/34_tam.srt', ['ta']],
        ['Subs/Dear.S01E02.WEBRip.x265-ION265/35_tel.srt', ['te']],
        ['Dabangg 3 2019 AMZN WebRip Hindi 720p x264', ['hi']],
        ['Quarantine [2008] [DVDRiP.XviD-M14CH0] [Lektor PL] [Arx]', ['pl']],
        ['The Mandalorian S01E06 POLISH WEBRip x264-FLAME', ['pl']],
        ['Na Wspólnej (2024) [E3951-3954][1080p][WEB-DL][PL][x264-GhN]', ['pl']],
        ['Kulej.2024.PL.1080p.AMZN.WEB-DL.x264-KiT', ['pl']],
        [
            'Star.Wars.Skeleton.Crew.Sezon01.PLDUB.480p.DSNP.WEB-DL.H264.DDP5.1-K83',
            ['pl']
        ],
        [
            'Bukmacher / Bookie [E02E07] [MULTi] [1080p] [AMZN] [WEB-DL] [H264] [DDP5.1.Atmos-K83] [Lektor PL]',
            ['multi audio', 'pl']
        ],
        [
            'Gra 1968 [REKONSTRUKCJA] [1080p.WEB-DL.H264.AC3-FT] [Film Polski]',
            ['pl']
        ],
        ['Evil.Dead.Rise.2023.PLSUB.720p.MA.WEB-DL.H264.E-AC3-CMRG', ['pl']],
        [
            'Wallace i Gromit: Zemsta pingwina / Wallace & Gromit: Vengeance Most Fowl (2024) [480] [WEB-DL] [XviD] [DD5.1-K83] [Dubbing PL]',
            ['pl']
        ],
        [
            'Strażniczka smoków / Dragonkeeper (2024) [1080p] [H264] [Napisy PL]',
            ['pl']
        ],
        ['Carros 2 Dublado - Portugues BR (2011)', ['pt']],
        [
            'A.Simples.Plan.1998.720p.BDRIP.X264.dublado.portugues.BR.gmenezes',
            ['pt']
        ],
        ['American.Horror.Story.S01E01.720p. PORTUGUÊS BR', ['pt']],
        ['Angel.S05E19.legendado.br.rmvb', ['pt']],
        ['Grimm S01E11 Dublado BR [ kickUploader ]', ['pt']],
        ['InuYasha.EP161.ptBR.subtitles.[inuplace.com.br].avi', ['pt']],
        ['Ghost.Rider.DivX_Gamonet(Ingles-Port.BR)-AC3.avi', ['en', 'pt']],
        ['I Am David  legendado pt/br', ['pt']],
        ['Lone Wolf and Cub 6 movies - legendas BR', ['pt']],
        [
            'Wonder Woman Season 3 (H.264 1080p; English/Portuguese-BR)',
            ['en', 'pt']
        ],
        [
            'MIB 3 - Homens de Preto 2012 ( Audio EN-BR - Leg BR  Mkv 1280x69',
            ['en', 'pt']
        ],
        ['my wife is a gangster 3 legendado em PT(BR)', ['pt']],
        [
            'A.Clockwork.Orange.1971.BRDRIP.1080p.DUAL.PORT-BR.ENG.gmenezes.m',
            ['dual audio', 'en', 'pt']
        ],
        ['Superman I - O Filme 1978 Leg. BR - Mkv 1280x528', ['pt']],
        ['Subs/Brazilian.por.srt', ['pt']],
        ['Brazilian Portuguese.por.srt', ['pt']],
        ['[S0.E07] Gambit królowej - Gra koncowa.Portuguese Brazil.srt', ['pt']],
        [
            'The Hit List (2011) DVD NTSC WS (eng-fre-pt-spa) [Sk]',
            ['en', 'fr', 'es', 'pt']
        ],
        [
            '[POPAS] Neon Genesis Evangelion: The End of Evangelion [jp_PT-pt',
            ['ja', 'pt']
        ],
        ['Zola Maseko - Drum (2004) PT subs', ['pt']],
        ['Idrissa Ouedraogo - Yaaba (1989) EN ES FR PT', ['en', 'fr', 'es', 'pt']],
        ['Metallica.Through.The.Never.2013 O Filme(leg.pt-pt)', ['pt']],
        ['Dinossauro (2000) --[ Ing / Pt / Esp ]', ['en', 'es', 'pt']],
        ['Mulan 1 (1998) Versao Portuguesa', ['pt']],
        [
            'The Guard 2011.DK.EN.ES.HR.NL.PT.RO.Subtitles',
            ['en', 'es', 'pt', 'ro', 'hr', 'nl', 'da']
        ],
        [
            'Titan.A.E.2000 720p  HDTV DTS Eng Fra Hun Rom Rus multisub',
            ['multi subs', 'en', 'fr', 'ru', 'hu', 'ro']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.Latin American es.ass",
            ['es-419']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.Brazilian pt.ass",
            ['pt']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.pt.ass",
            ['pt']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.es.ass",
            ['es']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.de.ass",
            ['de']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.it.ass",
            ['it']
        ],
        [
            "Frieren - Beyond Journey's End - S01E01 - TBA WEBDL-1080p.ar.ass",
            ['ar']
        ],
        ['Subs(ara,fre,ger).srt', ['fr', 'de', 'ar']],
        [
            'Subs(chi,eng,ind,kor,may,tha,vie).srt',
            ['en', 'ko', 'zh', 'vi', 'id', 'th', 'ms']
        ],
        [
            'Miami.Bici.2020.1080p.NETFLIX.WEB-DL.DDP5.1.H.264.EN-ROSub-ExtremlymTorrents',
            ['en', 'ro']
        ],
        ['26_Romanian.srt', ['ro']],
        ['4_Bulgarian.srt', ['bg']],
        ['18_srp.srt', ['sr']],
        ['Aranyelet.S01.HUNGARIAN.1080p.WEBRip.DDP5.1.x264-SbR[rartv]', ['hu']],
        [
            'Ponyo[2008]DvDrip-H264 Quad Audio[Eng Jap Fre Spa]AC3 5.1[DXO]',
            ['en', 'ja', 'fr', 'es']
        ],
        [
            'The Mechanic [1972] Eng,Deu,Fra,Esp,Rus + multisub DVDrip',
            ['multi subs', 'en', 'fr', 'es', 'de', 'ru']
        ],
        [
            'Mommie Dearest [1981 PAL DVD][En.De.Fr.It.Es Multisubs[18]',
            ['multi subs', 'en', 'fr', 'es', 'it', 'de']
        ],
        ['Pasienio sargyba S01E03 (2016 WEBRip LT)', ['lt']],
        ['24_Lithuanian.srt', ['lt']],
        ['25_Latvian.srt', ['lv']],
        ['13_Estonian.srt', ['et']],
        [
            'Ip.Man.4.The.Finale.2019.CHINESE.1080p.BluRay.x264.TrueHD.7.1.Atmos-HDC',
            ['zh']
        ],
        // Third block - CHT test
        [
            '[NC-Raws] 叫我對大哥 (WEB版) / Ore, Tsushima - 10 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
            ['zh']
        ],
        // Fourth block - additional tests
        [
            'Inuyasha_TV+Finale+OVA+Film+CD+Manga+Other; dub jpn,chn,eng sub chs (2019-09-21)',
            ['en', 'ja', 'zh']
        ],
        ['Initial D Live Action 2005 ENG/CHI', ['en', 'zh']],
        ['Wolf.Warrior.2015.720p.BluRay.x264.Mandarin.AAC-ETRG', ['zh']],
        ['9_zh-Hans.srt', ['zh']],
        ['Traditional Chinese.chi.srt', ['zh-tw']],
        ['Subs/Promare - Chinese (Traditional).ass', ['zh-tw']],
        ['10_zh-Hant.srt', ['zh-tw']],
        ['Berserk 01-25 [dual audio JP,EN] MKV', ['dual audio', 'en', 'ja']],
        [
            'FLCL S05.1080p HMAX WEB-DL DD2.0 H 264-VARYG (FLCL: Shoegaze Dual-Audio Multi-Subs)',
            ['multi subs', 'dual audio']
        ],
        ['Shinjuku Swan 2015 JAP 1080p BluRay x264 DTS-JYK', ['ja']],
        ['Wet.Woman.in.the.Wind.2016.JAPANESE.1080p.BluRay.x264-iKiW', ['ja']],
        ['All.Love.E146.KOR.HDTV.XViD-DeBTV', ['ko']],
        ['The.Nun.2018.KORSUB.HDRip.XviD.MP3-STUTTERSHIT', ['ko']],
        ['Burning.2018.KOREAN.720p.BluRay.H264.AAC-VXT', ['ko']],
        ['Atonement.2017.KOREAN.ENSUBBED.1080p.WEBRip.x264-VXT', ['en', 'ko']],
        ['A Freira (2018) Dublado HD-TS 720p', ['pt']],
        [
            'Escobar El Patron Del Mal Capitulo 91 SD (2012-10-10) [SiRaDuDe]',
            ['pt']
        ],
        ['Bleach - 215 ao 220 - [DB-BR]', ['pt']],
        [
            'Joker.2019.MULTi.Bluray.1080p.Atmos.7.1.En.Fr.Sp.Pt-DDR[EtHD]',
            ['multi audio', 'en', 'fr', 'es', 'pt']
        ],
        ['Dilbert complete series + en subs', ['en']],
        [
            'The Next Karate Kid (1994) NTSC WS -Eng/Fre/Spa/Por- [ctang]',
            ['en', 'fr', 'es', 'pt']
        ],
        [
            'Un.Homme.Et.Une.Femme.1966.DVDRip.XviD.AR [PT ENG ESP]',
            ['en', 'es', 'pt']
        ],
        ['Geminis.2005.Argentina.ESP.ENG.PT.SUBS', ['en', 'es', 'pt']],
        ['1917 2019 1080p Bluray x264-Sexmeup [Greek Subs] [Braveheart]', ['el']],
        ['The Lion King 1,2,3 Greek Language', ['el']],
        ['The Adams Family (1991) (Greek Subs integratet)', ['el']],
        ['6_Greek.srt', ['el']],
        ['The Insult (2017) [BluRay] [720p] Arabic', ['ar']],
        ['The.Mexican.2001 - Arabic Subs Hardcoded', ['ar']],
        [
            'Much Loved (2015) - DVDRip x265 HEVC - ARAB-ITA-FRE AUDIO (ENG S',
            ['en', 'fr', 'it', 'ar']
        ],
        ['42.2013.720p.BluRay.x264.HD4Ar Arab subtitle', ['ar']],
        ['Fauda.S01.HEBREW.1080p.NF.WEBRip.DD5.1.x264-TrollHD[rartv]', ['he']],
        ['madagascar 720p hebrew dubbed.mkv', ['he']],
        [
            'Into.the.Night.S01E04.Ayaz.1080p.NF.WEB-DL.DDP5.1.x264-NTG_track17_[heb].srt',
            ['he']
        ],
        ['The.Protector.2018.S03.TURKISH.WEBRip.x264-ION10', ['tr']],
        [
            'Recep Ivedik 6 (2020) NETFLIX 720p WEBDL (Turkish) - ExtremlymTorrents',
            ['tr']
        ],
        [
            'The Insider*1999*[DVD5][PAL][ENG, POL, sub. ROM, TUR]',
            ['en', 'pl', 'ro', 'tr']
        ],
        [
            'Divorzio allitaliana [XviD - Ita Mp3 - Sub Eng Esp Tur]',
            ['en', 'es', 'it', 'tr']
        ],
        [
            '2007 Saturno Contro [Saturn In Opposition] (ITA-FRA-TUR) [EngSub',
            ['en', 'fr', 'it', 'tr']
        ],
        [
            'Cowboy Bebop - 1080p BDrip Audio+sub MULTI (VF / VOSTFR)',
            ['multi audio', 'fr']
        ],
        [
            'Casablanca 1942 BDRip 1080p [multi language,multi subs].mkv',
            ['multi subs', 'multi audio']
        ],
        [
            'Avengers.Endgame.2019.4K.UHD.ITUNES.DL.H265.Dolby.ATMOS.MSUBS-Deflate.Telly',
            ['multi subs']
        ],
        [
            'Dawn of the Planet of the Apes (2014) 720p BluRay x264 - MULTI S',
            ['multi subs']
        ],
        [
            'Pirates of the Caribbean On Stranger Tides (2011) DVD5 (Multi Su',
            ['multi subs']
        ],
        [
            'Jumanji The Next Level (2019) 720p HDCAM Ads Blurred x264 Dual A',
            ['dual audio']
        ],
        [
            'Men in Black International (2019) 720p Korsub HDRip x264 ESub [Dual Line Audio] [Hindi English]',
            ['dual audio', 'en', 'ko', 'hi']
        ],
        ['Fame (1980) [DVDRip][Dual][Ac3][Eng-Spa]', ['dual audio', 'en', 'es']],
        ['O Rei do Show 2018 Dual Áudio 4K UtraHD By.Luan.Harper', ['dual audio']],
        [
            'Cowboy Bebop The Movie (2001) BD 1080p.x265.Tri-Audio.Ita.Eng.Jap [Rady]',
            ['multi audio', 'en', 'ja', 'it']
        ],
        [
            '[IceBlue] Naruto (Season 01) - [Multi-Dub][Multi-Sub][Dublado][HEVC 10Bits] 800p BD',
            ['multi subs', 'multi audio', 'pt']
        ],
        [
            'Blue Seed - 01 (BDRip 720x480p x265 HEVC FLAC, AC3x2 2.0x3)(Triple Audio)[sxales].mkv',
            ['multi audio']
        ],
        ['Ministri S01E02 SLOVAK 480p x264-mSD', ['sk']],
        ['Subs/35_slo.srt', ['sk']],
        ['Seinfeld.COMPLETE.SLOSUBS.DVDRip.XviD', ['sk']],
        ['Subs/36_Slovenian.srt', ['sl']],
        [
            'The House Bunny (2008) BDRemux 1080p MediaClub [RUS, UKR, ENG]',
            ['en', 'ru', 'uk']
        ],
        ["L'immortel (2010) DVDRip AVC (Russian,Ukrainian)", ['ru', 'uk']],
        [
            'Into.the.Night.S01E03.Mathieu.1080p.NF.WEB-DL.DDP5.1.x264-NTG_track33_[vie].srt',
            ['vi']
        ],
        ['Subs/vie.srt', ['vi']],
        ['Subs/Vietnamese.srt', ['vi']],
        ['Subs/Dear.S01E05.WEBRip.x265-ION265/25_may.srt', ['ms']],
        [
            'Midnight.Diner.Tokyo.Stories.S02E10.WEBRip.x264-ION10/14_Indonesian.srt',
            ['id']
        ],
        [
            'Inglês,Português,Italiano,Francês,Polonês,Russo,Norueguês,Dinamarquês,Alemão,Espanhol,Chinês,Japonês,Coreano,Persa,Hebraico,Sueco,Árabe,Holandês,Tâmil,Tailandês',
            [
                'en',
                'ja',
                'ko',
                'zh',
                'fr',
                'es',
                'pt',
                'it',
                'de',
                'ru',
                'ta',
                'pl',
                'nl',
                'da',
                'sv',
                'no',
                'th',
                'he',
                'fa'
            ]
        ],
        ['russian,english,ukrainian', ['en', 'ru', 'uk']],
        ['Subs/Thai.srt', ['th']],
        ['Food Choices (2016) WEB.1080p.H264_tha.srt', ['th']],
        ['Ekk Deewana Tha (2012) DVDRip 720p x264 AAC TaRa.mkv', undefined],
        ['My Big Fat Greek Wedding (2002) 720p BrRip x264 - YIFY', undefined],
        ['Get Him to the Greek 2010 720p BluRay', undefined],
        [
            '[Hakata Ramen] Hoshiai No Sora (Stars Align) 01 [1080p][HEVC][x265][10bit][Dual-Subs] HR-DR',
            undefined
        ],
        // Fifth block - negative tests
        ['Do.Or.Die.1991.1080p.BluRay.x264-[YTS.LT].mp4', undefined],
        ['Castlevania 2017 1º temporada completa 1080p', ['es']],
        ['City on a Hill - Temporada 1 [HDTV][Cap.110].avi', ['es']],
        ['La inocencia [720][wWw.EliteTorrent.NL].mkv', undefined],
        ['Reasonable Doubt - Temporada 1 [HDTV][Cap.101][www.AtomoHD.FI]', ['es']],
        [
            '1883 - Temporada 1 [HDTV 720p][Cap.103][AC3 5.1][www.AtomoHD.fi]',
            ['es']
        ],
        ['Los Winchester - Temporada 1 [HDTV][Cap.103][www.atomoHD.tw]', ['es']],
        [
            'El Inmortal- Temporada 1 [HDTV 720p][Cap.104][AC3 5.1][www.AtomoHD.ch]]',
            ['es']
        ],
        ['Black Friday (2021) [BluRay Rip][AC3 5.1][www.atomixHQ.TEL]', undefined],
        ['Deep Blue Sea 3 [HDR][wWw.EliteTorrent.SE]', undefined],
        ['The.Italian.Job.1969.1080p.BluRay.x265-RARBG.mp4', undefined],
        ['Chinese Zodiac (2012) 1080p BrRip x264 - YIFY', undefined],
        ['The German Doctor 2013 1080p WEBRip', undefined],
        ['Johnny English 2003 1080p BluRay', undefined],
        ['Polish Wedding (1998) 1080p (moviesbyrizzo upl).mp4', undefined],
        [
            'Russian.Doll.S02E02.2160p.NF.WEB-DL.DDP5.1.HDR.DV.HEVC-PEXA.mkv',
            undefined
        ],
        ['The.Spanish.Prisoner.1997.1080p.BluRay.x265-RARBG', undefined],
        ['Japanese.Story.2003.1080p.WEBRip.x264-RARBG', undefined],
        [
            '[ Torrent9.cz ] The.InBetween.S01E10.FiNAL.HDTV.XviD-EXTREME.avi',
            undefined
        ],
        ['Thai Massage (2022) 720p PDVDRip x264 AAC.mkv', undefined],
        ['Carson Daly 2017 09 13 Dan Harmon 720p HDTV x264-CROOKS', undefined],
        ['Dan Browns The Lost Symbol S01E03 1080p WEB H264-GLHF', undefined],
        ['Ben.Ara.2015.1080p.WEBRip.x265-RARBG.mp4', undefined],
        ['Ara.(A.Break).2008.DVDRip', undefined],
        // PY tests
        [
            'www.1TamilMV.cz - Mirzapur (2020) S02 EP (01-10) - HQ HDRip - [Tam+ Tel] - x264 - AAC - 1GB - ESub',
            ['en', 'te', 'ta']
        ],
        [
            'www.1TamilMV.cz - The Game of Chathurangam (2023) WEB-DL - 1080p - AVC - (AAC 2.0) [Tamil + Malayalam] - 1.2GB.mkv',
            ['ta', 'ml']
        ],
        [
            'www.1TamilMV.yt - Anchakkallakokkan (2024) Malayalam HQ HDRip - 720p - HEVC - (DD+5.1 - 192Kbps & AAC) - 750MB - ESub.mkv',
            ['en', 'ml']
        ],
        [
            'Anatomia De Grey - Temporada 19 [HDTV][Cap.1905][Castellano][www.AtomoHD.nu].avi',
            ['es']
        ],
        [
            'Godzilla.x.Kong.The.New.Empire.2024.2160p.BluRay.REMUX.DV.P7.HDR.ENG.LATINO.GER.ITA.FRE.HINDI.CHINESE.TrueHD.Atmos.7.1.H265-BEN.THE.MEN',
            ['en', 'zh', 'fr', 'es-419', 'it', 'de', 'hi']
        ],
        [
            'Sampurna.2023.Bengali.S02.1080p.AMZN.WEB-DL.DD+2.0.H.265-TheBiscuitMan',
            ['bn']
        ],
        [
            'Kingdom.of.the.Planet.of.the.Apes.2024.HDRIP.1080P.[xDark [SaveHD] Latin + English + Hindi.mp4',
            ['en', 'es-419', 'hi']
        ],
        [
            'The Karate Kid Part III 1989 1080p DUAL TİVİBU WEB-DL x264 AAC - HdT',
            ['dual audio', 'tr']
        ],
        [
            'The French Connection 1971 Remastered BluRay 1080p REMUX AVC DTS-HD MA 5 1-LEGi0N',
            undefined
        ],
        [
            'The.Gorge.2025.PLSUB.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-APEX.mkv',
            ['pl']
        ],
        [
            'Tron.Ares.2025.2160p.iT.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-BYNDR.mkv',
            undefined
        ],
        // Go tests
        [
            '[Ex-torrenty.org]iCarly.S04.PLDUB.1080p.AMZN.WEB-DL.DDP2.0.H264-Ralf',
            ['pl']
        ],
        [
            'BLACK PANTHER - Wakanda Forever (2022) 10bit.m1080p.BRRip.H265.MKV.AC3-5.1 DUBPL-ENG-NapisyPL [StarLord]',
            ['en', 'pl']
        ],
        ['Shrek_Forever_After_(2010)__3D_HSBS_(DubbingPL).mkv', ['pl']],
        ['Star Trek [2009] [RmvB] [LekPL].rmvb', ['pl']],
        [
            '[FileTracker] Breaking Bad S02E08 [lektorPL][480p.WEB-DL.XviD][avi]',
            ['pl']
        ],
        [
            'Game of Thrones - Sezon 4 Odcinek 10 [480p.720p.WEB-DL.H264-NitroTeam] [Lektor PL].mkv',
            ['pl']
        ],
        ['Everest.2015.FRENCH.VFQ.BDRiP.x264-CNF30', ['fr']],
        [
            'Showdown.In.Little.Tokyo.1991.MULTI.VFQ.VFF.DTSHD-MASTER.1080p.BluRay.x264-ZombiE',
            ['multi audio', 'fr']
        ],
        [
            'Nocturnal Animals (2016) MULTi VFQ [1080p] BluRay x264-PopHD',
            ['multi audio', 'fr']
        ],
        ['Nocturnal Animals 2016 VFQ 1080p BluRay DTS x265-HDHEVC', ['fr']]
    ];
    testCases.forEach(([title, expected], index) => {
        test(`test ${index + 1} (${title})`, () => {
            const result = (0, index_1.parseTorrentTitle)(title);
            if (expected === undefined) {
                expect(result.languages).toBeUndefined();
            }
            else {
                expect(result.languages).toEqual(expected);
            }
        });
    });
    // Special test for title preservation
    test('not remove english from title', () => {
        const result = (0, index_1.parseTorrentTitle)('The English Patient (1996) 720p BrRip x264 - YIFY');
        expect(result.languages).toBeUndefined();
        expect(result.title).toBe('The English Patient');
    });
});
