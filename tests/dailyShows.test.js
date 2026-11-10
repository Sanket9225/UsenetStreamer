// Automated test suite for Daily & Late-Night Shows air-date support
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const dailyShows = require('../src/services/dailyShows');
const { parseReleaseMetadata } = require('../src/services/metadata/releaseParser');
const { fileMatchesEpisode } = require('../src/utils/parsers');
const { buildEasynewsSearchParams } = require('../src/services/easynews/queryBuilder');
const tmdbService = require('../src/services/tmdb');

describe('Daily Shows Support', () => {
  describe('Show Classification & Identification', () => {
    it('should classify shows with Talk-Show genre as daily shows', () => {
      const mockCinemeta = {
        name: 'The Daily Show',
        genres: ['Comedy', 'News', 'Talk-Show'],
        videos: [
          { season: 31, number: 1, released: '2026-01-01T00:00:00.000Z' }
        ]
      };
      assert.strictEqual(dailyShows.isDailyShow({ cinemetaMeta: mockCinemeta }), true);
    });

    it('should classify shows with Soap genre as daily shows', () => {
      const mockCinemeta = {
        name: 'Days of Our Lives',
        genres: ['Soap', 'Drama'],
        videos: []
      };
      assert.strictEqual(dailyShows.isDailyShow({ cinemetaMeta: mockCinemeta }), true);
    });

    it('should NOT classify standard drama series as daily shows', () => {
      const mockCinemeta = {
        name: 'Breaking Bad',
        genres: ['Crime', 'Drama', 'Thriller'],
        videos: [
          { season: 1, number: 1, released: '2008-01-20T00:00:00.000Z' }
        ]
      };
      assert.strictEqual(dailyShows.isDailyShow({ cinemetaMeta: mockCinemeta }), false);
    });

    it('should classify shows matching custom IDs even without genres', () => {
      process.env.DAILY_SHOWS_CUSTOM_IDS = 'tt0115147, 71256, customshow';
      dailyShows.reloadConfig();

      assert.strictEqual(dailyShows.isDailyShow({ imdbId: 'tt0115147' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ tvdbId: '71256' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ title: 'customshow' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ imdbId: 'tt9999999' }), false);

      delete process.env.DAILY_SHOWS_CUSTOM_IDS;
      dailyShows.reloadConfig();
    });

    it('should identify well-known daily show titles via regex', () => {
      assert.strictEqual(dailyShows.isDailyShow({ title: 'The Tonight Show Starring Jimmy Fallon' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ title: 'The Late Show with Stephen Colbert' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ title: 'Jimmy Kimmel Live!' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ title: 'Late Night with Seth Meyers' }), true);
      assert.strictEqual(dailyShows.isDailyShow({ title: 'WWE Monday Night RAW' }), true);
    });

    it('should respect DAILY_SHOWS_ENABLED=false', () => {
      process.env.DAILY_SHOWS_ENABLED = 'false';
      dailyShows.reloadConfig();

      assert.strictEqual(dailyShows.isDailyShow({ title: 'The Daily Show' }), false);

      process.env.DAILY_SHOWS_ENABLED = 'true';
      dailyShows.reloadConfig();
    });
  });

  describe('Air-Date Formatting & Resolution', () => {
    it('should parse ISO date strings into dotted and hyphenated formats', () => {
      const formatted = dailyShows.formatAirDate('2024-11-04T07:00:00.000Z');
      assert.ok(formatted);
      assert.strictEqual(formatted.year, '2024');
      assert.strictEqual(formatted.month, '11');
      assert.strictEqual(formatted.day, '04');
      assert.strictEqual(formatted.airDate, '2024-11-04');
      assert.strictEqual(formatted.airDateDotted, '2024.11.04');
      assert.strictEqual(formatted.airDateHyphenated, '2024-11-04');
      assert.strictEqual(formatted.airDateSpaced, '2024 11 04');
    });

    it('should resolve air date from Cinemeta video array', async () => {
      const mockCinemeta = {
        name: 'The Daily Show',
        genres: ['Talk-Show'],
        videos: [
          {
            season: 29,
            number: 100,
            firstAired: '2024-09-27T07:00:00.000Z',
            name: 'Susanna Fogel',
          },
        ],
      };

      const resolved = await dailyShows.resolveAirDate({
        seasonNum: 29,
        episodeNum: 100,
        cinemetaMeta: mockCinemeta,
      });

      assert.ok(resolved);
      assert.strictEqual(resolved.airDateDotted, '2024.09.27');
      assert.strictEqual(resolved.airDateHyphenated, '2024-09-27');
    });

    it('should fallback to TMDb service if Cinemeta lacks episode', async () => {
      const mockTmdbService = {
        getEpisodeAirDate: async (tmdbId, season, episode) => {
          if (tmdbId === '2224' && season === 29 && episode === 100) {
            return '2024-09-26';
          }
          return null;
        },
      };

      const resolved = await dailyShows.resolveAirDate({
        seasonNum: 29,
        episodeNum: 100,
        cinemetaMeta: { videos: [] },
        tmdbId: '2224',
        tmdbService: mockTmdbService,
      });

      assert.ok(resolved);
      assert.strictEqual(resolved.airDate, '2024-09-26');
      assert.strictEqual(resolved.airDateDotted, '2024.09.26');
    });
  });

  describe('Release Parsing (releaseParser.js)', () => {
    it('should expose parsed date on release metadata', () => {
      const parsed = parseReleaseMetadata('The.Daily.Show.2024.11.04.720p.HDTV.x264-XYZ');
      assert.strictEqual(parsed.date, '2024-11-04');
      assert.strictEqual(parsed.resolution, '720p');
    });

    it('should parse dates with hyphens', () => {
      const parsed = parseReleaseMetadata('The.Daily.Show.2024-11-04.720p.HDTV.x264-XYZ');
      assert.strictEqual(parsed.date, '2024-11-04');
    });
  });

  describe('File Matching (parsers.js)', () => {
    it('should match files with air date when requestedEpisode carries airDate', () => {
      const reqEp = {
        season: 31,
        episode: 126,
        airDate: '2024-11-04',
        airDateDotted: '2024.11.04',
      };

      assert.strictEqual(
        fileMatchesEpisode('The.Daily.Show.2024.11.04.720p.HDTV.x264-XYZ.mkv', reqEp),
        true
      );
      assert.strictEqual(
        fileMatchesEpisode('The.Daily.Show.2024-11-04.720p.HDTV.x264-XYZ.mkv', reqEp),
        true
      );
    });

    it('should still match standard SxxExx files for daily shows', () => {
      const reqEp = {
        season: 31,
        episode: 126,
        airDate: '2024-11-04',
      };

      assert.strictEqual(
        fileMatchesEpisode('The.Daily.Show.S31E126.720p.HDTV.x264-XYZ.mkv', reqEp),
        true
      );
    });

    it('should reject files with a different air date', () => {
      const reqEp = {
        season: 31,
        episode: 126,
        airDate: '2024-11-04',
      };

      assert.strictEqual(
        fileMatchesEpisode('The.Daily.Show.2024.11.05.720p.HDTV.x264-XYZ.mkv', reqEp),
        false
      );
    });
  });

  describe('Daily Air-Date Matching (matchesDailyAirDate)', () => {
    it('should match releases where parsed date equals airDate', () => {
      const airDateInfo = {
        airDate: '2024-11-04',
        airDateDotted: '2024.11.04',
        airDateHyphenated: '2024-11-04',
        airDateSpaced: '2024 11 04',
        airDateCompact: '20241104',
      };

      const release = {
        title: 'The.Daily.Show.2024.11.04.720p.HDTV.x264-XYZ',
        date: '2024-11-04',
      };

      assert.strictEqual(dailyShows.matchesDailyAirDate(release, airDateInfo), true);
    });

    it('should match releases where title contains airDateDotted even if date field is missing', () => {
      const airDateInfo = {
        airDate: '2024-11-04',
        airDateDotted: '2024.11.04',
        airDateHyphenated: '2024-11-04',
        airDateSpaced: '2024 11 04',
        airDateCompact: '20241104',
      };

      const release = {
        title: 'The.Daily.Show.2024.11.04.720p.HDTV.x264-XYZ',
      };

      assert.strictEqual(dailyShows.matchesDailyAirDate(release, airDateInfo), true);
    });

    it('should reject releases for a different date', () => {
      const airDateInfo = {
        airDate: '2024-11-04',
        airDateDotted: '2024.11.04',
        airDateHyphenated: '2024-11-04',
        airDateSpaced: '2024 11 04',
        airDateCompact: '20241104',
      };

      const release = {
        title: 'The.Daily.Show.2024.11.05.720p.HDTV.x264-XYZ',
        date: '2024-11-05',
      };

      assert.strictEqual(dailyShows.matchesDailyAirDate(release, airDateInfo), false);
    });
  });

  describe('EasyNews Query Builder with Daily Air-Dates', () => {
    it('should append air-date dotted to EasyNews search query', () => {
      const dailyAirDate = {
        airDate: '2024-11-04',
        airDateDotted: '2024.11.04',
        airDateHyphenated: '2024-11-04',
      };

      const params = buildEasynewsSearchParams({
        type: 'series',
        movieTitle: 'The Daily Show',
        seasonNum: 31,
        episodeNum: 126,
        dailyAirDate,
        normalizeToAscii: tmdbService.normalizeToAscii,
      });

      assert.ok(params);
      assert.ok(params.queries.some(q => q.includes('2024.11.04')));
      assert.strictEqual(params.airDate, '2024-11-04');
    });
  });
});
