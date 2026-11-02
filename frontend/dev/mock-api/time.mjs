/**
 * Timezone-aware date helpers built on Intl only, so the mock API needs no
 * dependencies. Instants are plain epoch milliseconds; "local" values are
 * wall-clock parts in an IANA timezone.
 */

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in `timeZone`. Weekday is 0 = Monday (Python style). */
export function localParts(ms, timeZone) {
  const parts = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday,
  };
}

function offsetMinutes(ms, timeZone) {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
export function zonedInstant(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(guess, timeZone) * MINUTE;
  const second = guess - offsetMinutes(first, timeZone) * MINUTE;
  return second;
}

/** A local calendar date shifted by whole days, normalised through UTC arithmetic. */
export function addLocalDays(date, days) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

/** Today's local date (plus an optional offset in days). */
export function localDate(ms, timeZone, offsetDays = 0) {
  const p = localParts(ms, timeZone);
  return addLocalDays(p, offsetDays);
}

/** "HH:MM" or "HH:MM:SS" → minutes after midnight. */
export function clockMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Instant for a local date and an "HH:MM" clock time (minutes may exceed one day). */
export function atLocal(date, clock, timeZone) {
  const total = typeof clock === "number" ? clock : clockMinutes(clock);
  const target = addLocalDays(date, Math.floor(total / (24 * 60)));
  const rest = total % (24 * 60);
  return zonedInstant(target.year, target.month, target.day, Math.floor(rest / 60), rest % 60, timeZone);
}

/** RFC 3339 UTC text without milliseconds, the way Pydantic serialises datetimes. */
export function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function ceilTo(ms, minutes) {
  const step = minutes * MINUTE;
  return Math.ceil(ms / step) * step;
}

/** RFC 3339 with an explicit offset (`Z` or `±HH:MM`); bare local datetimes are rejected. */
export function parseAbsolute(value) {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return typeof value === "string" && value.length > 0;
  } catch {
    return false;
  }
}

/** Every concrete interval a set of weekly windows covers between `fromMs` and `toMs`. */
export function windowIntervals(windows, fromMs, toMs, timeZone) {
  const intervals = [];
  if (toMs <= fromMs) return intervals;
  const first = localDate(fromMs, timeZone, -1);
  const spanDays = Math.ceil((toMs - fromMs) / DAY) + 2;
  for (let offset = 0; offset <= spanDays; offset += 1) {
    const date = addLocalDays(first, offset);
    for (const window of windows) {
      if (window.weekday !== date.weekday) continue;
      const start = clockMinutes(window.start);
      let end = clockMinutes(window.end);
      if (end <= start) end += 24 * 60;
      const startsAt = atLocal(date, start, timeZone);
      const endsAt = atLocal(date, end, timeZone);
      const s = Math.max(startsAt, fromMs);
      const e = Math.min(endsAt, toMs);
      if (e > s) intervals.push({ start: s, end: e });
    }
  }
  return mergeIntervals(intervals);
}

export function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((item) => item.end > item.start)
    .map((item) => ({ ...item }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push(item);
  }
  return merged;
}

/** `intervals` with every `blocked` range removed. */
export function subtractIntervals(intervals, blocked) {
  let result = mergeIntervals(intervals);
  for (const block of blocked) {
    const next = [];
    for (const item of result) {
      if (block.end <= item.start || block.start >= item.end) {
        next.push(item);
        continue;
      }
      if (block.start > item.start) next.push({ start: item.start, end: block.start });
      if (block.end < item.end) next.push({ start: block.end, end: item.end });
    }
    result = next;
  }
  return result;
}

export function totalMinutes(intervals) {
  return Math.round(intervals.reduce((sum, item) => sum + (item.end - item.start), 0) / MINUTE);
}

export function clip(intervals, fromMs, toMs) {
  return intervals
    .map((item) => ({ start: Math.max(item.start, fromMs), end: Math.min(item.end, toMs) }))
    .filter((item) => item.end > item.start);
}
