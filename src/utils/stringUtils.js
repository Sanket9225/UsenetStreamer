const TITLE_SIMILARITY_THRESHOLD = 0.85;

// German letters expand to their ASCII digraphs the way release names spell them
// (ä→ae, ü→ue, ß→ss), applied BEFORE NFD so they aren't reduced to bare vowels.
const UMLAUT_MAP = { 'Ä': 'Ae', 'ä': 'ae', 'Ö': 'Oe', 'ö': 'oe', 'Ü': 'Ue', 'ü': 'ue', 'ß': 'ss' };

// The word "&" expands to depends on the title's language, the way release names
// spell it out (Dutch "en", German "und", French "et", …). Mirrors UMLAUT_MAP:
// an existing language-aware normalization pattern. Falls back to English "and"
// when the language is unknown, preserving the previous behaviour.
const AMPERSAND_MAP = { nl: 'en', de: 'und', fr: 'et', es: 'y', it: 'e', pt: 'e', en: 'and' };

function ampersandWord(lang) {
  const code = String(lang || '').slice(0, 2).toLowerCase();
  return AMPERSAND_MAP[code] || 'and';
}

// Fold accents to ASCII so a metadata title ("Café", "Über") compares equal to
// the ASCII form release names use ("Cafe", "Ueber"). Mirrors the query-side
// ASCII folding (tmdb.normalizeToAscii) so both sides of a match normalize the
// same way. Umlaut digraphs first, then strip remaining combining diacritics.
function foldAccents(text) {
  return String(text || '')
    .replace(/[ÄäÖöÜüß]/g, (c) => UMLAUT_MAP[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function sanitizeStrictSearchPhrase(text, lang) {
  if (!text) return '';
  return foldAccents(text)
    .replace(/&/g, ` ${ampersandWord(lang)} `)
    // Treat separators — including slash/backslash — as a single space so a
    // title like "A/B" tokenizes as ["a","b"] (matching dotted release names
    // "A.B...") instead of collapsing into "ab".
    .replace(/[\.\-_:/\\\s]+/g, ' ')
    // Accents are already folded above, so drop the À-ÿ allowance — any leftover
    // non-ASCII letter is removed, matching the ASCII query sent to indexers.
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .trim();
}

// Turn a human/metadata title (e.g. a TMDb title) into the token string we send
// to indexers/Easynews for a TEXT search. Release names are whitespace/dot
// separated alphanumerics, so a punctuated title like
//   "A Title, Part 1 & 2 (Director's Cut)"
// must become
//   "A Title Part 1 and 2 Directors Cut"
// or the indexer returns nothing. Rules:
//   - fold accents/umlauts to ASCII (matches how releases spell them)
//   - apostrophes are REMOVED, not spaced ("Director's" → "Directors", not "Director s")
//   - "&" → language-specific word ("and"/"en"/"und"/… via ampersandWord)
//   - every other punctuation/symbol → space ("A/B" → "A B",
//     commas, parens, colons, dots, hyphens, music glyphs, …)
//   - collapse whitespace; case is preserved (indexer text search is
//     case-insensitive). The result lines up with sanitizeStrictSearchPhrase so
//     the query we send and the phrase we match on stay consistent.
function cleanSearchTitle(title, lang) {
  if (!title) return '';
  return foldAccents(String(title))
    .replace(/['‘’ʼ]/g, '') // straight/curly/modifier apostrophes → removed
    .replace(/&/g, ` ${ampersandWord(lang)} `)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')          // any other punctuation/symbol → space
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesStrictSearch(title, strictPhrase) {
  if (!strictPhrase) return true;
  const candidate = sanitizeStrictSearchPhrase(title);
  if (!candidate) return false;
  if (candidate === strictPhrase) return true;
  const candidateTokens = candidate.split(' ').filter(Boolean);
  const phraseTokens = strictPhrase.split(' ').filter(Boolean);
  if (phraseTokens.length === 0) return true;

  // Nothing before first query token, nothing after last query token, gaps allowed in between
  if (candidateTokens[0] !== phraseTokens[0]) return false;
  if (candidateTokens[candidateTokens.length - 1] !== phraseTokens[phraseTokens.length - 1]) return false;
  // Remaining tokens must appear in order, gaps allowed
  let candidateIdx = 1;
  for (let i = 1; i < phraseTokens.length; i += 1) {
    const token = phraseTokens[i];
    let found = false;
    while (candidateIdx < candidateTokens.length) {
      if (candidateTokens[candidateIdx] === token) {
        found = true;
        candidateIdx += 1;
        break;
      }
      candidateIdx += 1;
    }
    if (!found) return false;
  }
  return true;
}

function normaliseTitle(text, lang) {
  if (!text) return '';
  return foldAccents(String(text).replace(/&/g, ampersandWord(lang)))
    .replace(/[^\p{L}\p{N}]/gu, '')   // strip ALL non-alphanumeric
    .toLowerCase();
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function titleSimilarityCheck(candidateParsedTitle, queryParsedTitle) {
  if (!candidateParsedTitle || !queryParsedTitle) return true;
  const normCandidate = normaliseTitle(candidateParsedTitle);
  const normQuery = normaliseTitle(queryParsedTitle);
  if (!normCandidate || !normQuery) return true;
  if (normCandidate === normQuery) return true;
  return levenshteinRatio(normCandidate, normQuery) >= TITLE_SIMILARITY_THRESHOLD;
}

module.exports = {
  TITLE_SIMILARITY_THRESHOLD,
  foldAccents,
  ampersandWord,
  sanitizeStrictSearchPhrase,
  cleanSearchTitle,
  matchesStrictSearch,
  normaliseTitle,
  levenshteinDistance,
  levenshteinRatio,
  titleSimilarityCheck,
};
