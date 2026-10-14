// Day math in America/New_York. All "days" are YYYY-MM-DD strings.
export const TZ = 'America/New_York';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function nyParts(ms) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, s: +p.second };
}

export function nyDate(ms) { return nyParts(ms).date; }

/** ms until the next local midnight in New York (DST-safe). */
export function msToMidnight(ms) {
  const p = nyParts(ms);
  const elapsed = (p.h * 3600 + p.m * 60 + p.s) * 1000 + (ms % 1000);
  let cand = ms + 86400000 - elapsed;
  const q = nyParts(cand);
  if (q.date === p.date) cand += 3600000;          // 25-hour day (fall back)
  else if (q.h === 1) cand -= 3600000;              // 23-hour day (spring forward)
  return cand - ms;
}

const toUTC = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);

export function addDays(d, n) { return fromUTC(toUTC(d) + n * 86400000); }
/** ISO weekday 1=Mon .. 7=Sun */
export function dow(d) { return ((new Date(toUTC(d)).getUTCDay() + 6) % 7) + 1; }
export function weekStart(d) { return addDays(d, 1 - dow(d)); }
export function weekDays(monday) { return Array.from({ length: 7 }, (_, i) => addDays(monday, i)); }
export function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s; }
/** D1 datetime('now') string (UTC) -> NY date */
export function sqlUtcToNyDate(s) { return nyDate(Date.parse(s.replace(' ', 'T') + 'Z')); }
