// Daily + weekly progress per kid. Pure: built on itemsFor(), the same function the all-done
// bonus uses (awardBonuses -> dayAllDone), so a full day here == a day that earns the bonus.
//
// Rules (documented in README "Progress bars"):
// - The day's chores are exactly the cards the kid sees that day: daily chores, rotating turns that are
//   his that day/week, pinned weekly chores, and "any day this week" chores. An OPEN weekly chore
//   (any-day, set-days, weekly turn) only counts on the last day it's available that week (Sunday for
//   any-day, else its last allowed weekday); on the day it's done it counts as done (logic.js counted()).
//   Repeat chores (2x a day...) are done only when every repeat is ticked.
// - Daily bar: units = repeats (a 2x chore is 2 units) so it fills tick by tick; done = all chores done.
// - Weekly bar: 7 slots Mon-Sun. A slot is 'done' only if ALL of that day's chores were done (not a sum).
//   'today' (in progress), 'missed' (past, not all done), 'upcoming' (future), 'none' (no chores that day).
import { itemsFor, counted } from './logic.js';
import { weekStart, weekDays } from './time.js';

/** items: itemsFor(...) decorated by withSlots (multi items carry progress {n, of}). */
export function summarize(all) {
  const items = counted(all);
  let n = 0, of = 0, done = 0;
  for (const it of items) {
    const u = it.progress ? it.progress.of : 1;
    of += u; n += it.progress ? Math.min(it.progress.n, u) : it.done ? 1 : 0;
    if (it.done) done++;
  }
  return { n, of, chores: items.length, choresDone: done, allDone: items.length > 0 && done === items.length };
}

/**
 * Week of progress for one kid.
 * comps / ticks: the kid's completions and repeat ticks for that week. decorate(items) = withSlots.
 * Future days are never evaluated (they'd look like 'missed').
 */
export function weekProgress(kidId, anyDay, today, chores, comps, overrides, decorate = (x) => x) {
  return weekDays(weekStart(anyDay)).map((day) => {
    if (day > today) return { day, state: 'upcoming', n: 0, of: 0, chores: 0, choresDone: 0, allDone: false };
    const s = summarize(decorate(itemsFor(kidId, day, chores, comps, overrides)));
    const state = s.chores === 0 ? 'none' : s.allDone ? 'done' : day === today ? 'today' : 'missed';
    return { day, state, ...s };
  });
}
