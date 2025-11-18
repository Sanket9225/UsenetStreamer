const { parseStringPromise } = require('xml2js');
const crypto = require('crypto');

async function computeSegmentHashFromNzb(nzbString) {
  if (typeof nzbString !== 'string' || nzbString.trim() === '') return null;
  let parsed;
  try {
    parsed = await parseStringPromise(nzbString, { explicitArray: false, trim: true });
  } catch (_) {
    return null;
  }
  const filesNode = parsed?.nzb?.file;
  const files = Array.isArray(filesNode) ? filesNode : filesNode ? [filesNode] : [];
  const set = new Set();
  for (const file of files) {
    const segNode = file?.segments?.segment;
    const segments = Array.isArray(segNode) ? segNode : segNode ? [segNode] : [];
    for (const seg of segments) {
      const raw = typeof seg?._ === 'string' ? seg._.trim() : '';
      if (!raw) continue;
      const id = raw.replace(/^<|>$/g, '');
      if (id) set.add(id);
    }
  }
  if (set.size === 0) return null;
  const list = Array.from(set);
  list.sort();
  const joined = list.join('|');
  return crypto.createHash('sha256').update(joined).digest('hex');
}

module.exports = {
  computeSegmentHashFromNzb,
};
