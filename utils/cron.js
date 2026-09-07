// =============================================================================
// utils/cron.js — minimal cron expression parser + next-fire-time.
//
// Supports the standard 5-field Vixie-cron format:
//
//     minute  hour  day-of-month  month  day-of-week
//      0-59   0-23      1-31      1-12     0-6   (0 = Sunday)
//
// Each field accepts:
//   *        every value in range
//   N        just this value
//   */N      every N (e.g. */15 -> 0,15,30,45)
//   A-B      inclusive range
//   A,B,C    union (mixable with ranges, e.g. "1-5,10,20-25")
//
// Day-of-week vs day-of-month semantics: per Vixie cron, if BOTH fields are
// restricted (neither is "*"), the trigger fires when EITHER matches. This is
// the historical Unix behaviour; it's surprising but it's the standard, and
// what users expect from a Unix-like scheduler.
//
// No dependencies — ~100 lines. The whole algorithm in defense terms:
//   parse(expr)    -> O(F * K) where F = 5 fields, K = tokens per field
//   nextFire(expr) -> O(R * P) worst-case; in practice O(1) because we never
//                    search more than a few minutes past `after` for typical
//                    expressions. Bounded by 366 days of searching (366 * 24
//                    * 60 = ~530k minute-steps) which is fine for a once-per-
//                    minute background tick.
// =============================================================================

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour',   min: 0, max: 23 },
  { name: 'dom',    min: 1, max: 31 },
  { name: 'month',  min: 1, max: 12 },
  { name: 'dow',    min: 0, max: 6 },
];

// Parse a single field into a Set of allowed integer values.
const parseField = (raw, min, max) => {
  const out = new Set();
  for (const part of String(raw).split(',')) {
    let range = part;
    let step = 1;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      step = parseInt(part.slice(slash + 1), 10);
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`bad step in "${part}"`);
      }
      range = part.slice(0, slash);
    }
    let lo, hi;
    if (range === '*') {
      lo = min; hi = max;
    } else {
      const dash = range.indexOf('-');
      if (dash === -1) {
        lo = hi = parseInt(range, 10);
      } else {
        lo = parseInt(range.slice(0, dash), 10);
        hi = parseInt(range.slice(dash + 1), 10);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`field out of range: "${part}" (expected ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
};

// Parse a 5-field cron expression into a structured form.
// Throws on malformed input — caller is responsible for surfacing 400s.
//
// We also stamp the two `_isStar` flags here (rather than re-deriving
// them in nextFire) because they're parser-time facts about the
// expression, not properties of the query time `after`.
const parseCron = (expr) => {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`expected 5 fields, got ${parts.length}`);
  }
  const parsed = {};
  FIELDS.forEach((f, i) => {
    parsed[f.name] = parseField(parts[i], f.min, f.max);
  });
  parsed._raw = parts.join(' ');
  parsed._domIsStar = parts[2] === '*';
  parsed._dowIsStar = parts[4] === '*';
  return parsed;
};

// True if `date` (a Date, considered in UTC) matches the parsed schedule.
//
// DOM/DOW semantics per Vixie cron (man 5 crontab):
//   - both '*'        -> any day matches (always true)
//   - one restricted  -> the restricted field alone decides (AND)
//   - both restricted -> either field matching fires (OR — "the surprising one")
const matches = (parsed, date) => {
  const minute = date.getUTCMinutes();
  const hour   = date.getUTCHours();
  const dom    = date.getUTCDate();
  const month  = date.getUTCMonth() + 1;
  const dow    = date.getUTCDay();

  let dayOk;
  if (parsed._domIsStar && parsed._dowIsStar) {
    dayOk = true;
  } else if (parsed._domIsStar) {
    dayOk = parsed.dow.has(dow);
  } else if (parsed._dowIsStar) {
    dayOk = parsed.dom.has(dom);
  } else {
    dayOk = parsed.dom.has(dom) || parsed.dow.has(dow);
  }

  return (
    parsed.minute.has(minute) &&
    parsed.hour.has(hour) &&
    parsed.month.has(month) &&
    dayOk
  );
};

// Compute the next Date strictly after `after` that matches the cron.
// Returns null if no match found within ~1 year (shouldn't happen for
// valid expressions; if it does, the caller treats it as a bug).
//
// The DOM/DOW '*'-tracking lives on the parsed object (set in
// parseCron), so nextFire doesn't need to re-parse anything.
const nextFire = (parsed, after) => {
  // Round up to the next whole minute, then walk forward one minute at a
  // time until we find a match. Walking is fine because:
  //   - typical schedules match within minutes
  //   - worst case is bounded to ~1 year of minute steps (~530k) which
  //     completes in single-digit ms
  const d = new Date(after.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const deadline = after.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (d.getTime() < deadline) {
    if (matches(parsed, d)) return new Date(d.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
};

// Convenience wrapper: parse + compute next fire from a raw expression.
const nextFireFromExpr = (expr, after = new Date()) => {
  const parsed = parseCron(expr);
  return nextFire(parsed, after);
};

// Validate without throwing away the error — returns null on bad input.
const isValid = (expr) => {
  try { parseCron(expr); return true; } catch (_) { return false; }
};

// ---- Timezone support (IANA tz via Intl.DateTimeFormat) -----------------
//
// Cron's classical behavior is "fire when the wall clock in some zone
// matches the expression". We default to UTC; callers can pass any
// IANA timezone string (e.g. 'America/New_York', 'Asia/Kathmandu').
// `Intl.DateTimeFormat` knows every IANA zone the host's ICU data
// ships with, so this works on Node + browser without a tz database.
//
// We compute next-fire-in-zone by:
//   1. Convert the candidate UTC Date to its wall-clock components
//      IN THE REQUESTED TIMEZONE (minute, hour, dom, month, dow).
//   2. Match against the parsed Set fields using those wall-clock values.
//
// Algorithm is the same walk-forward-in-UTC used by nextFire; only the
// match function changes.
//
// Implementation note: we build a tiny Intl.DateTimeFormat once per
// (timezone, field-set) and reuse it across the walk. Intl's
// `formatToParts` is the most portable way to get individual fields
// out of a timezone-aware Date.

const cachedFormats = new Map();

const getZoneFormatter = (timezone) => {
  // Memoize per-timezone — Intl construction is non-trivial.
  if (cachedFormats.has(timezone)) return cachedFormats.get(timezone);
  if (!timezone) return null; // null/undefined → fall through to UTC path
  try {
    // Use `en-US` so the output is reliably structured. The locale
    // doesn't affect the *values*, only their textual representation.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    cachedFormats.set(timezone, fmt);
    return fmt;
  } catch (_) {
    // Unknown tz (e.g. typo like 'America/Nwe_York') — throw so the
    // caller surfaces a 400 rather than silently falling back to UTC.
    throw new Error(`unknown timezone: "${timezone}"`);
  }
};

// Convert a UTC Date into the wall-clock components in `timezone`.
// Returns { year, month, day, hour, minute, second, weekday (0=Sun..6=Sat) }.
const partsInZone = (date, timezone) => {
  const fmt = getZoneFormatter(timezone);
  const parts = fmt.formatToParts(date);
  const out = {};
  for (const p of parts) {
    if (p.type === 'year')   out.year   = parseInt(p.value, 10);
    if (p.type === 'month')  out.month  = parseInt(p.value, 10);
    if (p.type === 'day')    out.day    = parseInt(p.value, 10);
    if (p.type === 'hour')   out.hour   = (parseInt(p.value, 10) || 0) % 24; // '24' bug in some ICU versions
    if (p.type === 'minute') out.minute = parseInt(p.value, 10);
    if (p.type === 'second') out.second = parseInt(p.value, 10);
    if (p.type === 'weekday') {
      // 'Sun' 'Mon' ... 'Sat' → 0..6 matching Date.getUTCDay().
      const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      out.weekday = map[p.value] ?? 0;
    }
  }
  return out;
};

// Same DOM/DOW semantics as `matches` but using the wall-clock parts
// inside `timezone` rather than UTC getters.
const matchesInZone = (parsed, date, timezone) => {
  const p = partsInZone(date, timezone);
  let dayOk;
  if (parsed._domIsStar && parsed._dowIsStar) {
    dayOk = true;
  } else if (parsed._domIsStar) {
    dayOk = parsed.dow.has(p.weekday);
  } else if (parsed._dowIsStar) {
    dayOk = parsed.dom.has(p.day);
  } else {
    dayOk = parsed.dom.has(p.day) || parsed.dow.has(p.weekday);
  }
  return (
    parsed.minute.has(p.minute) &&
    parsed.hour.has(p.hour) &&
    parsed.month.has(p.month) &&
    dayOk
  );
};

// Compute next-fire Date strictly after `after`, matching the cron in
// the given IANA timezone. Returns null if no match within ~1 year.
const nextFireInZone = (parsed, after, timezone) => {
  if (!timezone) return nextFire(parsed, after);
  const d = new Date(after.getTime());
  // Round up to next whole UTC minute.
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const deadline = after.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (d.getTime() < deadline) {
    if (matchesInZone(parsed, d, timezone)) return new Date(d.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
};

// Convenience wrapper: parse + compute next fire from a raw expression
// in the given timezone. `timezone` is optional and defaults to UTC.
const nextFireFromExprInZone = (expr, timezone, after = new Date()) => {
  const parsed = parseCron(expr);
  return nextFireInZone(parsed, after, timezone);
};

module.exports = {
  parseCron,
  nextFire,
  nextFireFromExpr,
  isValid,
  nextFireInZone,
  nextFireFromExprInZone,
  // Exposed for tests
  _internal: { matchesInZone, partsInZone, getZoneFormatter },
};
