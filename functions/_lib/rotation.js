// Rotating chores ("take turns"). Pure functions: whose turn it is is computed from the
// chore's plan + optional one-off overrides, so every device agrees without a cron job.
//
// plan (chores.rot_plan): JSON list of anchors, sorted by `from`:
//   [{ from: 'YYYY-MM-DD', kids: [ids in turn order], idx: <index of the kid whose turn `from` is> }]
// The newest anchor with from <= period applies. Each later period (day for 'daily',
// Mon-Sun week for 'weekly') moves one step along `kids`. Editing the order, removing a
// kid, or "skip to next kid" appends an anchor starting at the current period, so past
// periods keep the turns they had (history stays right).
// overrides (rotation_overrides): a one-off "swap turn" for a single period.
import { addDays, weekStart } from './time.js';

const dayNum = (d) => Math.round(Date.parse(`${d}T12:00:00Z`) / 864e5);

export const isRot = (ch) => ch.rotation === 'daily' || ch.rotation === 'weekly';
/** The period key a rotation turn (and its completion) uses on `day`. */
export const rotPeriod = (ch, day) => (ch.rotation === 'weekly' ? weekStart(day) : day);
export const nextPeriod = (ch, period) => addDays(period, ch.rotation === 'weekly' ? 7 : 1);

export function parsePlan(s) {
  try {
    const a = typeof s === 'string' ? JSON.parse(s) : s;
    return Array.isArray(a) ? a.filter((x) => x && typeof x.from === 'string' && Array.isArray(x.kids)).sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0)) : [];
  } catch { return []; }
}

/** The anchor in force for `period` (the first one if period is before every anchor). */
export function anchorFor(ch, period) {
  const plan = parsePlan(ch.rot_plan);
  if (!plan.length) return null;
  let a = plan[0];
  for (const x of plan) if (x.from <= period) a = x;
  return a;
}

const steps = (ch, from, period) => (ch.rotation === 'weekly'
  ? Math.round((dayNum(weekStart(period)) - dayNum(weekStart(from))) / 7)
  : dayNum(period) - dayNum(from));

/** Whose turn `period` is by the plan alone (no overrides). */
export function planTurn(ch, period) {
  const a = anchorFor(ch, period);
  if (!a || !a.kids.length) return null;
  const n = a.kids.length;
  return a.kids[((((a.idx || 0) + steps(ch, a.from, period)) % n) + n) % n];
}

/** overrides: Map `${choreId}|${period}` -> kidId */
export function turnFor(ch, period, overrides) {
  const o = overrides && overrides.get(`${ch.id}|${period}`);
  return o != null ? o : planTurn(ch, period);
}

/** Did the rotation exist yet in `period`? (no "missed" before it started) */
export const startedBy = (ch, period) => { const p = parsePlan(ch.rot_plan); return p.length > 0 && rotPeriod(ch, p[0].from) <= period; };

/**
 * New plan after the turn order changes at `period` (current day / week). The kid whose turn
 * it is keeps it if still in the list; otherwise the next kid (in the old order) who is.
 */
export function replan(ch, kids, period) {
  const plan = parsePlan(ch.rot_plan).filter((x) => x.from < period);
  if (!kids.length) return plan;
  const cur = anchorFor(ch, period);
  let idx = 0;
  if (cur && cur.kids.length) {
    const who = planTurn(ch, period);
    if (kids.includes(who)) idx = kids.indexOf(who);
    else {
      const i = cur.kids.indexOf(who);
      for (let s = 1; s <= cur.kids.length; s++) {
        const k = cur.kids[(i + s) % cur.kids.length];
        if (kids.includes(k)) { idx = kids.indexOf(k); break; }
      }
    }
  }
  return [...plan, { from: period, kids, idx }];
}

/** New plan where `period` goes to `kidId` and the turns carry on from there. */
export function planStartingWith(ch, kidId, period) {
  const cur = anchorFor(ch, period);
  const kids = cur ? cur.kids : [kidId];
  return [...parsePlan(ch.rot_plan).filter((x) => x.from < period), { from: period, kids, idx: Math.max(0, kids.indexOf(kidId)) }];
}

export const rotKidsNow = (ch, period) => anchorFor(ch, period)?.kids || [];
