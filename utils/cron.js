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
const nextFire = (parsed, after) => {
  // Track whether DOM / DOW are '*'. We can't recover that from the Set
  // alone (an empty Set would be wrong; '*' just produces the full range).
  // Re-parse the raw expression to detect 'star' fields.
  const rawParts = parsed._raw.split(/\s+/);
  parsed._domIsStar = rawParts[2] === '*';
  parsed._dowIsStar = rawParts[4] === '*';

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

module.exports = { parseCron, nextFire, nextFireFromExpr, isValid };
