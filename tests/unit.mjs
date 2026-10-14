// Unit tests for rotation + item logic: node --test tests/unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsFor } from '../functions/_lib/logic.js';
import { planTurn, turnFor, replan, planStartingWith, rotKidsNow, rotPeriod } from '../functions/_lib/rotation.js';
import { addDays, weekDays } from '../functions/_lib/time.js';

const MON = '2026-10-12'; // a Monday
const W = 1, E = 2, T = 3;
const daily = (kids, from = MON, idx = 0) => ({ id: 50, emoji: '🐶', title: 'Feed dog', kid_ids: JSON.stringify(kids), schedule: 'daily', days: '', minutes: 5, cents: 25, rotation: 'daily', rot_plan: JSON.stringify([{ from, kids, idx }]) });
const weekly = (kids, days = '1,3,5', from = MON) => ({ id: 60, emoji: '🗑️', title: 'Trash', kid_ids: JSON.stringify(kids), schedule: 'weekly', days, minutes: 10, cents: 50, rotation: 'weekly', rot_plan: JSON.stringify([{ from, kids, idx: 0 }]) });
const normal = { id: 1, emoji: '🛏️', title: 'Bed', kid_ids: '[1,2]', schedule: 'daily', days: '', minutes: 5, cents: 0, created_at: '2026-01-01 16:00:00', rotation: '' };

test('daily rotation alternates W,E over a simulated week, deterministic', () => {
  const ch = daily([W, E]);
  const turns = weekDays(MON).map((d) => planTurn(ch, d));
  assert.deepEqual(turns, [W, E, W, E, W, E, W]);
  // next week continues the alternation (7 days -> odd shift)
  assert.equal(planTurn(ch, addDays(MON, 7)), E);
  // same answer from any "device" and before the start date too
  assert.equal(planTurn(ch, addDays(MON, -1)), E);
});

test('daily rotation: each kid sees it only on his day', () => {
  const ch = daily([W, E]);
  for (const [i, d] of weekDays(MON).entries()) {
    const w = itemsFor(W, d, [ch, normal], []), e = itemsFor(E, d, [ch, normal], []);
    assert.equal(w.some((x) => x.rot), i % 2 === 0, `W on ${d}`);
    assert.equal(e.some((x) => x.rot), i % 2 === 1, `E on ${d}`);
    assert.equal(w.length + e.length, 3); // the normal chore for both + the rotation for one
  }
});

test('weekly rotation: shows on available days, drops off once done, advances next week', () => {
  const ch = weekly([W, E], '1,3,5');
  assert.equal(planTurn(ch, MON), W);
  assert.equal(planTurn(ch, addDays(MON, 7)), E);
  assert.equal(planTurn(ch, addDays(MON, 14)), W);
  const show = (kid, d, comps = []) => itemsFor(kid, d, [ch], comps).map((x) => `${x.done ? 'done' : 'open'}`);
  assert.deepEqual(show(W, MON), ['open']);
  assert.deepEqual(show(W, addDays(MON, 1)), []); // Tue isn't an available day
  assert.deepEqual(show(E, MON), []); // not E's week
  const comp = [{ id: 9, chore_id: 60, kid_id: W, period: MON, day: addDays(MON, 2), minutes: 10, cents: 50 }];
  assert.deepEqual(show(W, addDays(MON, 2), comp), ['done']); // done Wed: shows done that day
  assert.deepEqual(show(W, addDays(MON, 4), comp), []); // gone Fri
  assert.deepEqual(show(E, addDays(MON, 7)), ['open']); // next week: Sam
  // "any day" weekly rotation
  const any = weekly([W, E], '');
  assert.equal(itemsFor(W, addDays(MON, 1), [any], []).length, 1);
});

test('weekly rotation not done still advances (no catch-up)', () => {
  const ch = weekly([W, E], '');
  // W never did week 1; week 2 is still E's
  assert.equal(planTurn(ch, addDays(MON, 7)), E);
});

test('override: swap is one-off, skip shifts the rest', () => {
  const ch = daily([W, E]);
  const ovr = new Map([[`50|${MON}`, E]]);
  assert.equal(turnFor(ch, MON, ovr), E);
  assert.equal(turnFor(ch, addDays(MON, 1), ovr), E); // order unchanged after the swap
  assert.equal(itemsFor(W, MON, [ch], [], ovr).length, 0);
  assert.equal(itemsFor(E, MON, [ch], [], ovr).length, 1);
  const skipped = { ...ch, rot_plan: JSON.stringify(planStartingWith(ch, E, MON)) };
  assert.deepEqual([MON, addDays(MON, 1), addDays(MON, 2)].map((d) => planTurn(skipped, d)), [E, W, E]);
  // skipping later keeps earlier turns
  const later = { ...ch, rot_plan: JSON.stringify(planStartingWith(ch, W, addDays(MON, 3))) };
  assert.deepEqual(weekDays(MON).map((d) => planTurn(later, d)), [W, E, W, W, E, W, E]);
});

test('third kid joins a rotation without rewriting past turns', () => {
  const ch = daily([W, E]);
  const wed = addDays(MON, 2); // W's turn
  const ch3 = { ...ch, rot_plan: JSON.stringify(replan(ch, [W, E, T], wed)) };
  assert.deepEqual(weekDays(MON).map((d) => planTurn(ch3, d)), [W, E, W, E, T, W, E]);
  assert.deepEqual(rotKidsNow(ch3, MON), [W, E]);
  assert.deepEqual(rotKidsNow(ch3, wed), [W, E, T]);
  const wk = weekly([W, E]);
  const wk3 = { ...wk, rot_plan: JSON.stringify(replan(wk, [W, E, T], addDays(MON, 7))) };
  assert.deepEqual([0, 7, 14, 21].map((n) => planTurn(wk3, addDays(MON, n))), [W, E, T, W]);
});

test('kid removed: current turn passes to the next kid, history unchanged', () => {
  const ch = daily([W, E, T]);
  const tue = addDays(MON, 1); // E's turn
  const ch2 = { ...ch, rot_plan: JSON.stringify(replan(ch, [W, T], tue)) };
  assert.equal(planTurn(ch2, MON), W);
  assert.equal(planTurn(ch2, tue), T); // E removed -> next after E in old order
  assert.equal(planTurn(ch2, addDays(MON, 2)), W);
});

test('rotPeriod: day for daily, Monday for weekly', () => {
  assert.equal(rotPeriod({ rotation: 'daily' }, '2026-10-15'), '2026-10-15');
  assert.equal(rotPeriod({ rotation: 'weekly' }, '2026-10-18'), MON);
});

// ---- multi-times chores ----
import { _test } from '../functions/api/[[path]].js';
test('withSlots: progress, labels, legacy check-offs', () => {
  const ch = { id: 2, times: 2, labels: '["AM","PM"]', reward_mode: 'all', minutes: 5, cents: 0 };
  const it = { choreId: 2, period: MON, done: false, minutes: 5, cents: 0 };
  let [x] = _test.withSlots([it], [ch], [{ chore_id: 2, period: MON, slot: 1 }]);
  assert.deepEqual(x.slots.map((s) => [s.label, s.done]), [['AM', true], ['PM', false]]);
  assert.deepEqual(x.progress, { n: 1, of: 2 });
  assert.equal(x.rewardMode, 'all');
  [x] = _test.withSlots([{ ...it, done: true, minutes: 5 }], [ch], []);
  assert.deepEqual(x.progress, { n: 2, of: 2 }, 'checked off before it became 2x: counts as both');
  [x] = _test.withSlots([{ ...it, choreId: 9 }], [{ ...ch, id: 9, times: 1 }], []);
  assert.equal(x.slots, undefined, 'single chores unchanged');
});
test('multi chore counts as done for the all-done bonus only via its completion', () => {
  const ch = { id: 7, emoji: '🪥', title: 'Teeth', kid_ids: '[1]', schedule: 'daily', days: '', minutes: 5, cents: 0, created_at: '2026-01-01 16:00:00', rotation: '', times: 2 };
  assert.equal(itemsFor(1, MON, [ch], [])[0].done, false);
  assert.equal(itemsFor(1, MON, [ch], [{ id: 1, chore_id: 7, period: MON, day: MON, minutes: 5, cents: 0 }])[0].done, true);
});
