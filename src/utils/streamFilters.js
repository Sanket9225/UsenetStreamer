const { filenameParse } = require('@ctrl/video-filename-parser');

/**
 * Parse release name using video-filename-parser
 * @param {string} title - Release title
 * @returns {object} Parsed data or empty object on error
 */
function parseRelease(title) {
  if (!title) return {};

  try {
    return filenameParse(title);
  } catch (error) {
    console.error(`[PARSE ERROR] Failed to parse: ${title}`, error.message);
    return {};
  }
}

/**
 * Get video quality rank for sorting
 * @param {string} resolution - Resolution from parser (e.g., "2160P", "1080P")
 * @returns {number} Rank (higher is better)
 */
function getVideoQualityRank(resolution) {
  if (!resolution) return 0;

  const normalized = resolution.toUpperCase();
  const ranks = {
    '2160P': 4,
    '4K': 4,
    'UHD': 4,
    '1080P': 3,
    '720P': 2,
    '480P': 1
  };

  return ranks[normalized] || 0;
}

/**
 * Get audio quality rank for sorting
 * Audio quality hierarchy: TrueHD Atmos = DTS-HD MA > DTS-HD > EAC3 > AC3 = DTS > AAC
 * @param {string} audioCodec - Audio codec from parser
 * @returns {number} Rank (higher is better)
 */
function getAudioQualityRank(audioCodec) {
  if (!audioCodec) return 0;

  const codec = audioCodec.toUpperCase();

  // TrueHD Atmos / DTS-HD MA (highest quality)
  if (codec.includes('TRUEHD') && codec.includes('ATMOS')) return 6;
  if (codec.includes('DTS-HD') && codec.includes('MA')) return 6;
  if (codec.includes('DTS-HD.MA')) return 6;

  // DTS-HD (without MA)
  if (codec.includes('DTS-HD')) return 5;

  // EAC3 / DD+ / DDP
  if (codec.includes('EAC3') || codec.includes('E-AC-3') || codec.includes('DD+') || codec.includes('DDP')) return 4;

  // AC3 / DTS (standard quality)
  if (codec.includes('AC3') || codec.includes('DD ') || codec === 'DD') return 3;
  if (codec.includes('DTS') && !codec.includes('DTS-HD')) return 3;

  // AAC (lowest)
  if (codec.includes('AAC')) return 2;

  // TrueHD (without Atmos info)
  if (codec.includes('TRUEHD')) return 6;

  return 1;
}

/**
 * Extract quality string from parsed data
 * @param {object} parsed - Parsed release data
 * @returns {string} Quality string (e.g., "4K", "1080p", "720p")
 */
function extractQuality(parsed) {
  if (!parsed || !parsed.resolution) return null;

  const res = parsed.resolution.toUpperCase();
  if (res === '2160P' || res === 'UHD') return '4K';
  if (res === '1080P') return '1080p';
  if (res === '720P') return '720p';
  if (res === '480P') return '480p';

  return parsed.resolution;
}

/**
 * Check if quality matches filter
 * @param {string} quality - Detected quality (4K, 1080p, etc.)
 * @param {string} filter - Quality filter setting
 * @returns {boolean} True if quality matches filter
 */
function matchesQualityFilter(quality, filter) {
  if (!filter || filter === 'All') return true;
  if (!quality) return false;

  const filterMap = {
    '4K/2160p': ['4K'],
    '1080p': ['1080p'],
    '720p': ['720p'],
    '480p': ['480p'],
    '4K + 1080p': ['4K', '1080p'],
    '1080p + 720p': ['1080p', '720p'],
    '720p + 480p': ['720p', '480p']
  };

  const allowedQualities = filterMap[filter] || [];
  return allowedQualities.includes(quality);
}

/**
 * Detect language group for release
 * Returns: 'preferred', 'english', or 'other'
 * @param {object} parsed - Parsed release data
 * @param {string} preferredLanguage - User's preferred language
 * @returns {string} Language group ('preferred', 'english', 'other')
 */
function detectLanguageGroup(parsed, preferredLanguage) {
  if (!parsed || !preferredLanguage || preferredLanguage === 'No Preference') {
    return 'english'; // Default group when no preference
  }

  // Check if it's a MULTi release
  if (parsed.multi === true) {
    return 'preferred'; // MULTi releases contain preferred language
  }

  // Get languages from parser
  const languages = parsed.languages || [];

  // If no languages detected, assume English
  if (languages.length === 0) {
    return 'english';
  }

  // Check if preferred language is in the languages array
  const hasPreferredLanguage = languages.some(lang =>
    lang.toLowerCase() === preferredLanguage.toLowerCase()
  );

  if (hasPreferredLanguage) {
    return 'preferred';
  }

  // Check if English is in the languages
  const hasEnglish = languages.some(lang =>
    lang.toLowerCase() === 'english'
  );

  if (hasEnglish) {
    return 'english';
  }

  // Everything else goes to "other" group
  return 'other';
}

/**
 * Sort items within a single group
 * @param {Array} items - Items to sort (array of {result, parsed} objects)
 * @param {string} sortMethod - Sorting method
 * @returns {Array} Sorted items
 */
function sortWithinGroup(items, sortMethod) {
  const sorted = [...items];

  sorted.sort((a, b) => {
    const parsedA = a.parsed;
    const parsedB = b.parsed;

    // Primary sort based on method
    let primaryComparison = 0;

    switch (sortMethod) {
      case 'Quality First':
        const videoRankA = getVideoQualityRank(parsedA.resolution);
        const videoRankB = getVideoQualityRank(parsedB.resolution);
        primaryComparison = videoRankB - videoRankA; // Higher quality first
        break;

      case 'Size First':
        primaryComparison = (b.result.size || 0) - (a.result.size || 0); // Larger first
        break;

      case 'Date First':
        const ageA = a.result.age || 0;
        const ageB = b.result.age || 0;
        primaryComparison = ageA - ageB; // Lower age = newer = first
        break;

      default:
        // Default to Quality First
        const defaultVideoRankA = getVideoQualityRank(parsedA.resolution);
        const defaultVideoRankB = getVideoQualityRank(parsedB.resolution);
        primaryComparison = defaultVideoRankB - defaultVideoRankA;
    }

    if (primaryComparison !== 0) return primaryComparison;

    // Tiebreaker 1: Video quality (if not already sorting by quality)
    if (sortMethod !== 'Quality First') {
      const videoRankA = getVideoQualityRank(parsedA.resolution);
      const videoRankB = getVideoQualityRank(parsedB.resolution);
      const videoComparison = videoRankB - videoRankA;

      if (videoComparison !== 0) return videoComparison;
    }

    // Tiebreaker 2: Audio quality
    const audioRankA = getAudioQualityRank(parsedA.audioCodec);
    const audioRankB = getAudioQualityRank(parsedB.audioCodec);
    const audioComparison = audioRankB - audioRankA;

    if (audioComparison !== 0) return audioComparison;

    // Tiebreaker 3: Size
    return (b.result.size || 0) - (a.result.size || 0);
  });

  return sorted;
}

/**
 * Filter and sort streams with 3-group language grouping
 * @param {Array} results - Array of Prowlarr results
 * @param {string} sortMethod - Sorting method
 * @param {string} preferredLanguage - Preferred language for grouping
 * @param {string} qualityFilter - Quality filter (e.g., "All", "1080p", "4K + 1080p")
 * @returns {object} Object with sortedResults array and groupInfo
 */
function filterAndSortStreams(results, sortMethod, preferredLanguage, qualityFilter) {
  // Parse all releases and pair with original results
  const parsedItems = results.map(result => ({
    result,
    parsed: parseRelease(result.title)
  }));

  // Filter by quality
  let filteredItems = parsedItems;
  if (qualityFilter && qualityFilter !== 'All') {
    filteredItems = parsedItems.filter(item => {
      const quality = extractQuality(item.parsed);
      return matchesQualityFilter(quality, qualityFilter);
    });
  }

  // If no preferred language, just sort everything as one group
  if (!preferredLanguage || preferredLanguage === 'No Preference') {
    const sorted = sortWithinGroup(filteredItems, sortMethod);
    return {
      sortedResults: sorted.map(item => ({ ...item.result, parsed: item.parsed })),
      groupInfo: null
    };
  }

  // Split into THREE groups
  const preferredGroup = [];
  const englishGroup = [];
  const otherGroup = [];

  for (const item of filteredItems) {
    const langGroup = detectLanguageGroup(item.parsed, preferredLanguage);

    if (langGroup === 'preferred') {
      preferredGroup.push(item);
    } else if (langGroup === 'english') {
      englishGroup.push(item);
    } else {
      otherGroup.push(item);
    }
  }

  // Sort each group independently
  const sortedPreferred = sortWithinGroup(preferredGroup, sortMethod);
  const sortedEnglish = sortWithinGroup(englishGroup, sortMethod);
  const sortedOther = sortWithinGroup(otherGroup, sortMethod);

  // Combine groups: preferred first, then english, then other
  const allSorted = [...sortedPreferred, ...sortedEnglish, ...sortedOther];

  // Calculate separator indices for visual grouping
  const group1End = sortedPreferred.length;
  const group2End = group1End + sortedEnglish.length;

  // Return sorted results with parsed data included
  return {
    sortedResults: allSorted.map(item => ({ ...item.result, parsed: item.parsed })),
    groupInfo: {
      preferredLanguage,
      preferredCount: sortedPreferred.length,
      englishCount: sortedEnglish.length,
      otherCount: sortedOther.length,
      group1End,       // Index where English group starts
      group2End        // Index where Other Languages group starts
    }
  };
}

/**
 * Format title for Stremio display
 * Clean, readable format: "{Resolution} | {Audio Codec} | {Release Group}"
 * @param {object} parsed - Parsed release data
 * @returns {string} Formatted title
 */
function formatStremioTitle(parsed) {
  if (!parsed) return 'Unknown';

  const parts = [];

  // Resolution
  const resolution = extractQuality(parsed) || parsed.resolution;
  if (resolution) {
    // Add REMUX tag if present
    const remux = parsed.edition?.remux ? ' REMUX' : '';
    parts.push(resolution + remux);
  }

  // Audio codec with channels
  if (parsed.audioCodec) {
    let audio = parsed.audioCodec;

    // Simplify codec names
    if (audio.includes('Dolby TrueHD') || audio.includes('TrueHD')) {
      audio = 'TrueHD';
    } else if (audio.includes('DTS-HD')) {
      audio = 'DTS-HD MA';
    } else if (audio.includes('Dolby Digital Plus') || audio.includes('EAC3') || audio.includes('E-AC-3') || audio.includes('DD+') || audio.includes('DDP')) {
      audio = 'EAC3';
    } else if (audio.includes('Dolby Digital') || audio.includes('AC3') || audio.includes(' DD')) {
      audio = 'AC3';
    } else if (audio.includes('DTS')) {
      audio = 'DTS';
    } else if (audio.includes('AAC')) {
      audio = 'AAC';
    }

    if (parsed.audioChannels) {
      audio += ' ' + parsed.audioChannels;
    }

    parts.push(audio);
  }

  // Release group
  if (parsed.group) {
    parts.push(parsed.group);
  }

  // Add special flags (HDR, DV, source)
  const flags = [];
  if (parsed.edition?.hdr) flags.push('HDR');
  if (parsed.edition?.dolbyVision) flags.push('DV');

  // Source info (WEB-DL, BluRay, etc.)
  if (parsed.sources && parsed.sources.length > 0) {
    const source = parsed.sources[0];
    if (source === 'WEBDL') flags.push('WEB-DL');
    else if (source === 'BLURAY') flags.push('BluRay');
    else flags.push(source);
  }

  if (flags.length > 0) {
    parts.push(flags.join(' '));
  }

  return parts.join(' | ');
}

module.exports = {
  parseRelease,
  extractQuality,
  matchesQualityFilter,
  filterAndSortStreams,
  formatStremioTitle,
  getVideoQualityRank,
  getAudioQualityRank,
  detectLanguageGroup
};
