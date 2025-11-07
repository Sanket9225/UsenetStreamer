/**
 * Detect language from title
 * @param {string} title - Release title
 * @returns {string|null} Detected language or null
 */
function detectLanguage(title) {
  if (!title) return null;

  const languagePatterns = {
    'Spanish': /\b(spanish|español|castellano|lat|latino)\b/i,
    'French': /\b(french|français|vf|vff)\b/i,
    'German': /\b(german|deutsch)\b/i,
    'Italian': /\b(italian|italiano)\b/i,
    'Portuguese': /\b(portuguese|português|pt-br)\b/i,
    'Russian': /\b(russian|русский)\b/i,
    'Japanese': /\b(japanese|日本語)\b/i,
    'Korean': /\b(korean|한국어)\b/i,
    'Chinese': /\b(chinese|中文|mandarin)\b/i,
    'Arabic': /\b(arabic|العربية)\b/i,
    'Hindi': /\b(hindi|हिन्दी)\b/i,
    'Dutch': /\b(dutch|nederlands)\b/i,
    'Polish': /\b(polish|polski)\b/i,
    'Turkish': /\b(turkish|türkçe)\b/i
  };

  for (const [language, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(title)) {
      return language;
    }
  }

  // Default to English if no other language detected
  return 'English';
}

/**
 * Extract quality from title
 * @param {string} title - Release title
 * @returns {string|null} Quality (4K, 1080p, 720p, 480p) or null
 */
function extractQuality(title) {
  if (!title) return null;

  const qualityMatch = title.match(/(2160p|4K|UHD|1080p|720p|480p)/i);
  if (!qualityMatch) return null;

  const quality = qualityMatch[0].toUpperCase();
  if (quality === '2160P' || quality === 'UHD') return '4K';
  if (quality === '1080P') return '1080p';
  if (quality === '720P') return '720p';
  if (quality === '480P') return '480p';

  return quality;
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
 * Get quality rank for sorting (video quality)
 * @param {string} quality - Quality string
 * @returns {number} Rank (higher is better)
 */
function getQualityRank(quality) {
  const ranks = {
    '4K': 4,
    '1080p': 3,
    '720p': 2,
    '480p': 1
  };
  return ranks[quality] || 0;
}

/**
 * Extract audio quality from title
 * @param {string} title - Release title
 * @returns {string|null} Audio quality or null
 */
function extractAudioQuality(title) {
  if (!title) return null;

  // Check for high-quality audio formats (TrueHD, DTS-HD, Atmos)
  if (/TrueHD|DTS-HD|Atmos|DTS\.HD/i.test(title)) {
    return 'HD';
  }

  // Check for enhanced audio (EAC3, DD+, E-AC-3)
  if (/EAC3|E-AC-3|DD\+|DDP/i.test(title)) {
    return 'Enhanced';
  }

  // Check for standard audio (AC3, DTS, DD)
  if (/\bAC3\b|\bDTS\b|\bDD\b/i.test(title)) {
    return 'Standard';
  }

  return null;
}

/**
 * Get audio quality rank for sorting
 * @param {string} audioQuality - Audio quality string
 * @returns {number} Rank (higher is better)
 */
function getAudioQualityRank(audioQuality) {
  const ranks = {
    'HD': 3,        // TrueHD, DTS-HD, Atmos
    'Enhanced': 2,  // EAC3, DD+
    'Standard': 1   // AC3, DTS, DD
  };
  return ranks[audioQuality] || 0;
}

/**
 * Sort items within a single group using the specified method
 * @param {Array} items - Items to sort
 * @param {string} sortMethod - Sorting method
 * @returns {Array} Sorted items
 */
function sortWithinGroup(items, sortMethod) {
  const sorted = [...items];

  sorted.sort((a, b) => {
    // Primary sort based on method
    let primaryComparison = 0;

    switch (sortMethod) {
      case 'Quality First':
        const qualityA = extractQuality(a.title);
        const qualityB = extractQuality(b.title);
        const videoRankA = getQualityRank(qualityA);
        const videoRankB = getQualityRank(qualityB);
        primaryComparison = videoRankB - videoRankA;
        break;

      case 'Size First':
        primaryComparison = (b.size || 0) - (a.size || 0);
        break;

      case 'Date First':
        const ageA = a.age || 0;
        const ageB = b.age || 0;
        primaryComparison = ageA - ageB; // Lower age = newer
        break;

      default:
        // Default to Quality First
        const defaultQualityA = extractQuality(a.title);
        const defaultQualityB = extractQuality(b.title);
        const defaultRankA = getQualityRank(defaultQualityA);
        const defaultRankB = getQualityRank(defaultQualityB);
        primaryComparison = defaultRankB - defaultRankA;
    }

    if (primaryComparison !== 0) return primaryComparison;

    // If primary sort is equal, sort by video quality (if not already sorting by quality)
    if (sortMethod !== 'Quality First') {
      const qualityA = extractQuality(a.title);
      const qualityB = extractQuality(b.title);
      const videoRankA = getQualityRank(qualityA);
      const videoRankB = getQualityRank(qualityB);
      const videoComparison = videoRankB - videoRankA;

      if (videoComparison !== 0) return videoComparison;
    }

    // If video quality is equal, sort by audio quality
    const audioA = extractAudioQuality(a.title);
    const audioB = extractAudioQuality(b.title);
    const audioRankA = getAudioQualityRank(audioA);
    const audioRankB = getAudioQualityRank(audioB);
    const audioComparison = audioRankB - audioRankA;

    if (audioComparison !== 0) return audioComparison;

    // Final tiebreaker - sort by size
    return (b.size || 0) - (a.size || 0);
  });

  return sorted;
}

/**
 * Sort streams with proper language grouping
 * @param {Array} results - Array of Prowlarr results
 * @param {string} sortMethod - Sorting method
 * @param {string} preferredLanguage - Preferred language for grouping
 * @returns {object} Object with sortedResults array and groupInfo
 */
function sortStreams(results, sortMethod, preferredLanguage) {
  // If no preferred language, just sort everything as one group
  if (!preferredLanguage || preferredLanguage === 'No Preference') {
    const sorted = sortWithinGroup(results, sortMethod);
    return {
      sortedResults: sorted,
      groupInfo: null
    };
  }

  // Split into two groups: preferred language and others
  const preferredGroup = [];
  const otherGroup = [];

  for (const item of results) {
    const detectedLang = detectLanguage(item.title);
    if (detectedLang === preferredLanguage) {
      preferredGroup.push(item);
    } else {
      otherGroup.push(item);
    }
  }

  // Sort each group independently
  const sortedPreferred = sortWithinGroup(preferredGroup, sortMethod);
  const sortedOthers = sortWithinGroup(otherGroup, sortMethod);

  // Combine groups: preferred first, then others
  const sortedResults = [...sortedPreferred, ...sortedOthers];

  // Return sorted results with group boundary information
  return {
    sortedResults,
    groupInfo: {
      preferredLanguage,
      preferredCount: sortedPreferred.length,
      otherCount: sortedOthers.length,
      separatorIndex: sortedPreferred.length // Index where "Other Languages" group starts
    }
  };
}

module.exports = {
  detectLanguage,
  extractQuality,
  extractAudioQuality,
  matchesQualityFilter,
  sortStreams
};
