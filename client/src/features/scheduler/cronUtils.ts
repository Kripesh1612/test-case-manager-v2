// Pure cron + time helpers used by JobRow + JobForm + HistoryDrawer.
//
// No React, no DOM, no fetch — anything here is trivially unit-testable
// and can be reused by server-side helpers (a future Node-side renderer
// of the scheduler UI could import the same humanizeCron). Kept in its
// own module so the SchedulerPage orchestration file stays focused on
// state + wiring rather than string parsing.

// "in 12 min" / "3 hr ago" — same logic as the old vanilla admin.js but
// with sec/min/hr/day/month granularity and a single Math.round so a
// diff of 11.4 min renders as "11 min ago", not "11.39 min ago".
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const absMs = Math.abs(diffMs);
  const past = diffMs < 0;
  const units: [number, string, number][] = [
    [60_000, 'sec', 1000],
    [60, 'min', 60_000],
    [24, 'hr', 60 * 60_000],
    [30, 'day', 24 * 60 * 60_000],
    [12, 'month', 30 * 24 * 60 * 60_000],
  ];
  let v = absMs;
  let label: string = 'sec';
  for (const [boundary, unit, msPerUnit] of units) {
    if (v < boundary) {
      label = unit;
      break;
    }
    v = v / msPerUnit;
    label = unit;
  }
  const n = Math.round(v);
  return past ? `${n} ${label} ago` : `in ${n} ${label}`;
}

// "9/17/2026, 9:00:00 AM" — browser-locale string for the title tooltip
// on relative-time spans. Empty string for nullish input so callers can
// pass the result straight into `title={}` without a guard.
export function absoluteTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

// 5-field cron → short plain English. We only handle the patterns our
// preset chips produce — every other expression is rendered verbatim as
// a code-formatted raw cron in the UI, which is the safe fallback for
// power users who want to see what they actually scheduled.
export function humanizeCron(expr: string): string {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const m = parts[0] ?? '';
  const h = parts[1] ?? '';
  const dom = parts[2] ?? '';
  const mo = parts[3] ?? '';
  const dow = parts[4] ?? '';
  const isWild = (s: string | undefined) => s === '*';
  const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const h12 = (hh: string) => {
    const n = parseInt(hh, 10);
    if (!Number.isFinite(n)) return hh;
    if (n === 0) return '12am';
    if (n === 12) return '12pm';
    return n < 12 ? `${n}am` : `${n - 12}pm`;
  };
  const min12 = (mm: string, hh: string) => `${hh}:${String(mm).padStart(2, '0')}`;

  if (/^\*\/\d+$/.test(m) && isWild(h) && isWild(dom) && isWild(mo) && isWild(dow)) {
    return `Every ${parseInt(m.slice(2), 10)} minutes`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && /^[1-5]$/.test(dow)) {
    return `Weekdays at ${h12(h)}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && isWild(dow)) {
    return `Every day at ${h12(h)}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && /^\d+$/.test(dow)) {
    const dowIdx = parseInt(dow, 10);
    const dowLabel = dowName[dowIdx] ?? `day ${dow}`;
    return `${dowLabel} at ${min12(m, h12(h))}`;
  }
  if (isWild(m) && isWild(h) && isWild(dom) && isWild(mo) && isWild(dow)) return 'Every minute';
  return expr;
}

// Cheap 5-field cron validation that mirrors the server-side check
// (utils/cron.js). NOT a full RFC 5545 parser — just enough to disable
// the Submit button and colour the preview red. The server still does
// the authoritative validation on submit.
export function isValidCronClient(expr: string): boolean {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return parts.every((p, i) => {
    const range = ranges[i];
    if (!range) return false;
    const [lo, hi] = range;
    for (const tok of p.split(',')) {
      const slashIdx = tok.indexOf('/');
      const base = slashIdx >= 0 ? tok.slice(0, slashIdx) : tok;
      const stepStr = slashIdx >= 0 ? tok.slice(slashIdx + 1) : undefined;
      const stepNum = stepStr === undefined ? 1 : parseInt(stepStr, 10);
      if (!Number.isFinite(stepNum) || stepNum <= 0) return false;
      let from: number;
      let to: number;
      if (base === '*') {
        from = lo;
        to = hi;
      } else if (base.includes('-')) {
        const [a, b] = base.split('-');
        from = parseInt(a ?? '', 10);
        to = parseInt(b ?? '', 10);
      } else {
        from = parseInt(base, 10);
        to = from;
      }
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      if (from < lo || to > hi || from > to) return false;
    }
    return true;
  });
}
