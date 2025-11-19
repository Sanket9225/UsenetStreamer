const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizePublishDate(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Treat values >= 1e12 as milliseconds, otherwise seconds
    return value >= 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric >= 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    const maybeValue = value.valueOf ? value.valueOf() : null;
    if (maybeValue !== value) {
      return normalizePublishDate(maybeValue);
    }
  }
  return null;
}

function computeAgeDays(ageValue, publishDateMs, now = Date.now()) {
  if (Number.isFinite(ageValue) && ageValue >= 0) {
    return ageValue;
  }
  if (Number.isFinite(publishDateMs) && publishDateMs > 0) {
    return Math.max(0, (now - publishDateMs) / MS_PER_DAY);
  }
  return null;
}

function convertHoursMinutesSecondsToDays(value, unit) {
  if (!Number.isFinite(value)) return null;
  switch (unit) {
    case 'hours':
      return value / 24;
    case 'minutes':
      return value / (24 * 60);
    case 'seconds':
      return value / (24 * 60 * 60);
    default:
      return value;
  }
}

function getPublishMetadataFromResult(result = {}, now = Date.now()) {
  const publishCandidates = [
    result.publishDateMs,
    result.publishDate,
    result.publish_date,
    result.publishdate,
    result.published,
    result.publishDateUTC,
    result.pubDate,
    result.pubdate,
    result.usenetdate,
    result['usenet-date'],
  ];

  let publishDateMs = null;
  for (const candidate of publishCandidates) {
    publishDateMs = normalizePublishDate(candidate);
    if (publishDateMs) break;
  }

  const ageCandidates = [
    { value: result.age, unit: 'days' },
    { value: result.ageDays, unit: 'days' },
    { value: result.age_days, unit: 'days' },
    { value: result.ageDaysFloat, unit: 'days' },
    { value: result.age_days_float, unit: 'days' },
    { value: result.ageHours, unit: 'hours' },
    { value: result.age_hours, unit: 'hours' },
    { value: result.ageMinutes, unit: 'minutes' },
    { value: result.age_minutes, unit: 'minutes' },
    { value: result.ageSeconds, unit: 'seconds' },
    { value: result.age_seconds, unit: 'seconds' },
  ];

  let ageDays = null;
  for (const candidate of ageCandidates) {
    if (candidate.value === undefined || candidate.value === null) continue;
    const numeric = Number(candidate.value);
    if (!Number.isFinite(numeric)) continue;
    ageDays = convertHoursMinutesSecondsToDays(numeric, candidate.unit);
    if (ageDays !== null) break;
  }

  const finalAgeDays = computeAgeDays(ageDays, publishDateMs, now);

  return {
    publishDateMs: publishDateMs || null,
    publishDateIso: publishDateMs ? new Date(publishDateMs).toISOString() : (result.publishDate || null),
    ageDays: finalAgeDays,
  };
}

function areReleasesWithinDays(referenceMs, candidateMs, days) {
  if (!Number.isFinite(days) || days <= 0) return true;
  if (!Number.isFinite(referenceMs) || !Number.isFinite(candidateMs)) return true;
  return Math.abs(referenceMs - candidateMs) <= days * MS_PER_DAY;
}

module.exports = {
  MS_PER_DAY,
  normalizePublishDate,
  computeAgeDays,
  getPublishMetadataFromResult,
  areReleasesWithinDays,
};
