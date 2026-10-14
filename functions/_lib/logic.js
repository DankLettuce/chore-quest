import { addDays, dow, weekStart, weekDays, sqlUtcToNyDate } from './time.js';
import { isRot, turnFor } from './rotation.js';

export const parseKids = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(Number) : []; } catch { return []; } };
export const parseDays = (s) => (s ? String(s).split(',').map(Number).filter((n) => n >= 1 && n <= 7) : []);

/**
 * Weekly chores and the day's total : an open weekly chore (any-day, set-days, or a
 * weekly rotating turn) only counts toward a day's total on the LAST day it's available that week
 * (Sunday for any-day; else the last allowed weekday). On the day it's done it counts as done.
 * Items carry countsOpen=false when they show on the card list but don't count while open.
 * Used by the all-done bonus, the weekly streak and the progress bars alike.
 */
export const lastAvailDay = (ch) => { const d = parseDays(ch.days); return d.length ? Math.max(...d) : 7; };
export const counted = (items) => items.filter((i) => i.done || i.countsOpen !== false);
export const isAllDone = (items) => { const c = counted(items); return c.length > 0 && c.every((i) => i.done); };

/**
 * The chore cards a kid sees on `day`.
 * comps: this kid's completions for the week containing `day` (rows with chore_id, period, day, id).
 * overrides: Map of one-off rotation turn swaps (see rotation.js).
 */
export function itemsFor(kidId, day, chores, comps, overrides) {
  const mon = weekStart(day);
  const today = dow(day);
  const byKey = new Map(comps.map((c) => [`${c.chore_id}|${c.period}`, c]));
  const items = [];
  for (const ch of chores) {
    const created = ch.created_day || (ch.created_at ? sqlUtcToNyDate(ch.created_at) : '');
    // a chore added later doesn't count on earlier days (keeps past progress / streaks as they were)
    if (created && day < created) continue;
    if (isRot(ch)) { rotItem(ch, kidId, day, mon, today, byKey, overrides, items); continue; }
    if (!parseKids(ch.kid_ids).includes(kidId)) continue;
    const base = { choreId: ch.id, emoji: ch.emoji, title: ch.title, minutes: ch.minutes, cents: ch.cents, schedule: ch.schedule };
    const countsOpen = ch.schedule === 'daily' || today === lastAvailDay(ch);
    const push = (period, due, comp) => items.push({
      ...base, period, due, done: !!comp, completionId: comp ? comp.id : null, countsOpen,
      key: `${ch.id}|${period}`,
      // a completion keeps the reward it was worth when checked off
      ...(comp ? { minutes: comp.minutes, cents: comp.cents } : {}),
    });
    if (ch.schedule === 'daily') {
      push(day, 'today', byKey.get(`${ch.id}|${day}`));
      continue;
    }
    const days = parseDays(ch.days);
    if (days.length === 0) {
      // any day this week: open all week until done; shows as done on the day it was done
      const comp = byKey.get(`${ch.id}|${mon}`);
      if (!comp || comp.day > day) push(mon, 'week', null);
      else if (comp.day === day) push(mon, 'week', comp);
      continue;
    }
    for (const d of days.sort()) {
      if (d > today) continue;
      const occ = addDays(mon, d - 1);
      if (occ < created) continue; // chore didn't exist yet
      const comp = byKey.get(`${ch.id}|${occ}`);
      if (!comp || comp.day > day) push(occ, occ === day ? 'today' : 'late', null);
      else if (comp.day === day) push(occ, occ === day ? 'today' : 'late', comp);
    }
  }
  // undone first is the client's job; keep schedule order here
  return items;
}

/** A rotating chore shows only for the kid whose turn it is. */
function rotItem(ch, kidId, day, mon, today, byKey, overrides, items) {
  const period = ch.rotation === 'weekly' ? mon : day;
  if (turnFor(ch, period, overrides) !== kidId) return;
  const comp = byKey.get(`${ch.id}|${period}`);
  const base = { choreId: ch.id, emoji: ch.emoji, title: ch.title, minutes: ch.minutes, cents: ch.cents, schedule: ch.schedule, rot: ch.rotation, period, key: `${ch.id}|${period}` };
  const countsOpen = ch.rotation === 'daily' || today === lastAvailDay(ch);
  const push = (c) => items.push({ ...base, countsOpen, due: ch.rotation === 'weekly' ? 'week' : 'today', done: !!c, completionId: c ? c.id : null, ...(c ? { minutes: c.minutes, cents: c.cents } : {}) });
  if (ch.rotation === 'daily') return push(comp);
  // weekly: open on its available days until done, then gone for the rest of the week
  if (comp && comp.day <= day) { if (comp.day === day) push(comp); return; }
  const days = parseDays(ch.days);
  if (days.length && !days.includes(today)) return;
  push(null);
}

/** Is `period` a valid occurrence key of this chore, near `today`? */
export function validPeriod(ch, period, today) {
  if (period > today || period < addDays(today, -7)) return false;
  if (ch.rotation === 'weekly') return dow(period) === 1;
  if (ch.schedule === 'daily') return true;
  const days = parseDays(ch.days);
  if (days.length === 0) return dow(period) === 1;
  return days.includes(dow(period));
}

export { weekDays, weekStart, addDays, dow };
