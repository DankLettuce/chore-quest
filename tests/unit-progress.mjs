// Unit tests for daily/weekly progress: node --test tests/unit-progress.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekProgress, summarize } from '../functions/_lib/progress.js';
import { itemsFor } from '../functions/_lib/logic.js';
import { _test } from '../functions/api/[[path]].js';
import { addDays } from '../functions/_lib/time.js';

const { withSlots } = _test;
const MON = '2026-10-12', TUE = addDays(MON, 1), WED = addDays(MON, 2), THU = addDays(MON, 3), SUN = addDays(MON, 6);
const W = 1, E = 2;
const base = { emoji: 'img:chores/x.svg', minutes: 5, cents: 0, days: '', rotation: '', rot_plan: '[]', times: 1, labels: '[]', reward_mode: 'each', created_at: '2026-01-01 16:00:00' };
const bed = { ...base, id: 1, title: 'Bed', kid_ids: '[1,2]', schedule: 'daily' };
const teeth = { ...base, id: 2, title: 'Teeth', kid_ids: '[1,2]', schedule: 'daily', times: 2, labels: '["AM","PM"]', reward_mode: 'all' };
const dog = { ...base, id: 3, title: 'Dog', kid_ids: '[1,2]', schedule: 'daily', rotation: 'daily', rot_plan: JSON.stringify([{ from: MON, kids: [W, E], idx: 0 }]) };
const laundry = { ...base, id: 4, title: 'Laundry', kid_ids: '[1]', schedule: 'weekly', days: '' };
const trash = { ...base, id: 5, title: 'Trash', kid_ids: '[1]', schedule: 'weekly', days: '1' };
let cid = 1;
const comp = (chore, kid, period, day = period) => ({ id: cid++, chore_id: chore.id, kid_id: kid, period, day, minutes: 0, cents: 0 });
const tick = (chore, kid, period, slot, day = period) => ({ id: cid++, chore_id: chore.id, kid_id: kid, period, slot, day });
const wk = (kid, today, chores, comps, ticks = [], ovr = new Map()) => weekProgress(kid, today, today, chores, comps, ovr, (x) => withSlots(x, chores, ticks));
const states = (w) => w.map((d) => d.state).join(',');

test('daily: partial today, full day, missed past, upcoming future', () => {
  const w = wk(W, WED, [bed], [comp(bed, W, MON)]);
  assert.equal(states(w), 'done,missed,today,upcoming,upcoming,upcoming,upcoming');
  assert.deepEqual([w[2].n, w[2].of], [0, 1]);
  assert.equal(wk(W, WED, [bed], [comp(bed, W, MON), comp(bed, W, WED)])[2].state, 'done');
});

test('weekly bar is all-or-nothing per day, not a sum of dailies', () => {
  const chores = [bed, { ...bed, id: 9, title: 'Dressed' }];
  const w = wk(W, TUE, chores, [comp(bed, W, MON), comp(bed, W, TUE), comp(chores[1], W, TUE)]);
  assert.equal(w[0].state, 'missed'); // 1 of 2 on Monday is not a filled slot
  assert.deepEqual([w[0].n, w[0].of], [1, 2]);
  assert.equal(w[1].state, 'done');
});

test('no chores that day = neutral', () => {
  assert.equal(states(wk(W, SUN, [trash], [comp(trash, W, MON)])), 'done,none,none,none,none,none,none');
});

test('rotation: only the kid whose turn it is counts the chore', () => {
  const c = [comp(bed, W, MON), comp(bed, E, MON), comp(bed, E, TUE)];
  const w = wk(W, TUE, [bed, dog], [...c, comp(dog, W, MON)].filter((x) => x.kid_id === W));
  const e = wk(E, TUE, [bed, dog], c.filter((x) => x.kid_id === E));
  assert.equal(w[0].state, 'done'); assert.equal(w[0].of, 2);   // Alex: bed + dog on Monday
  assert.equal(e[0].state, 'done'); assert.equal(e[0].of, 1);   // Sam: just bed (not his turn)
  assert.equal(e[1].state, 'today'); assert.equal(e[1].of, 2);  // Tuesday is Sam's dog turn, not done
  const swapped = wk(E, TUE, [bed, dog], c.filter((x) => x.kid_id === E), [], new Map([[`${dog.id}|${TUE}`, W]]));
  assert.equal(swapped[1].state, 'done'); // swapped to Alex: Sam's Tuesday is just bed
});

test('repeat chores: every repeat must be done; bar counts repeats', () => {
  const t1 = [tick(teeth, W, MON, 1)];
  let w = wk(W, MON, [bed, teeth], [comp(bed, W, MON)], t1);
  assert.equal(w[0].state, 'today'); assert.deepEqual([w[0].n, w[0].of, w[0].choresDone, w[0].chores], [2, 3, 1, 2]);
  w = wk(W, MON, [bed, teeth], [comp(bed, W, MON), comp(teeth, W, MON)], [...t1, tick(teeth, W, MON, 2)]);
  assert.equal(w[0].state, 'done'); assert.deepEqual([w[0].n, w[0].of], [3, 3]);
  // un-tick PM: completion row goes away (server) -> not done again
  w = wk(W, MON, [bed, teeth], [comp(bed, W, MON)], t1);
  assert.equal(w[0].state, 'today');
});

test('weekly "any day": open does not count before Sunday; counts as done on the day done; gone after', () => {
  const c = [MON, TUE, WED, THU].map((d) => comp(bed, W, d));
  const w = wk(W, THU, [bed, laundry], [...c, comp(laundry, W, MON, WED)]);
  assert.equal(states(w).split(',').slice(0, 4).join(), 'done,done,done,done');
  assert.deepEqual(w.slice(0, 4).map((d) => d.of), [1, 1, 2, 1]);
});

test('weekly "any day" still open on Sunday counts (and blocks the day)', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(MON, i));
  const w = wk(W, SUN, [bed, laundry], days.map((d) => comp(bed, W, d)));
  assert.equal(states(w), 'done,done,done,done,done,done,today');
  assert.equal(w[6].of, 2);
});

test('weekly set days (Mon+Wed): open Monday occurrence counts only on Wednesday, the last allowed day', () => {
  const mw = { ...base, id: 6, title: 'Recycling', kid_ids: '[1]', schedule: 'weekly', days: '1,3' };
  const c = [MON, TUE, WED].map((d) => comp(bed, W, d));
  const w = wk(W, WED, [bed, mw], c);
  assert.deepEqual(w.slice(0, 3).map((d) => d.state), ['done', 'done', 'today']);
  assert.equal(w[2].of, 3); // bed + Monday's (late) + Wednesday's recycling
  const w2 = wk(W, WED, [bed, mw], [...c, comp(mw, W, MON, TUE)]);
  assert.deepEqual([w2[1].state, w2[1].of], ['done', 2]); // done Tuesday: counts as done there
});

test('weekly rotating turn: counts only on its last available day (or the day done)', () => {
  const bins = { ...base, id: 7, title: 'Bins', kid_ids: '[1,2]', schedule: 'weekly', rotation: 'weekly', days: '1,5', rot_plan: JSON.stringify([{ from: MON, kids: [W, E], idx: 0 }]) };
  const fri = addDays(MON, 4);
  const days = [0, 1, 2, 3, 4].map((i) => addDays(MON, i));
  const w = wk(W, fri, [bed, bins], days.map((d) => comp(bed, W, d)));
  assert.equal(states(w).split(',').slice(0, 5).join(), 'done,done,done,done,today'); // Mon open: not counted; Fri (last day) counts
  assert.equal(w[4].of, 2);
  const e = wk(E, fri, [bed, bins], days.map((d) => comp(bed, E, d)));
  assert.equal(e[4].of, 1); // not Sam's turn
});

test('weekly pinned day: due Monday, still open (late) Tuesday until done', () => {
  const w = wk(W, WED, [bed, trash], [MON, TUE, WED].map((d) => comp(bed, W, d)).concat(comp(trash, W, MON, TUE)));
  assert.equal(states(w).split(',').slice(0, 3).join(), 'missed,done,done');
});

test('a chore added mid-week does not change earlier days', () => {
  const late = { ...bed, id: 11, created_at: '2026-10-14 16:00:00' }; // Wed (NY noon)
  const w = wk(W, WED, [bed, late], [comp(bed, W, MON), comp(bed, W, TUE)]);
  assert.equal(states(w).split(',').slice(0, 3).join(), 'done,done,today');
});

test('summarize: empty list is not all done', () => {
  assert.deepEqual(summarize([]), { n: 0, of: 0, chores: 0, choresDone: 0, allDone: false });
  assert.equal(itemsFor(W, MON, [], [], new Map()).length, 0);
});
