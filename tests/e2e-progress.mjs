// E2E for daily + weekly progress bars: server progress agrees with the all-done bonus (stars + bonus rows)
// across a simulated week with rotation, repeats, weekly chores, uncheck; plus the placeholder UI.
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { resetLocal } from './_db.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = ROOT + 'shots/progress/';
mkdirSync(SHOTS, { recursive: true });
import { sec } from './env.mjs';
const KEY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ny = (day, hm = '09:00:00') => Date.parse(`${day}T${hm}-04:00`);
async function api(path, { method = 'GET', body, now, token } = {}) {
  const h = { 'x-family-key': KEY, 'content-type': 'application/json', 'x-test-now': String(now) };
  if (token) h['x-parent-token'] = token;
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const D = (i) => { const d = new Date(Date.UTC(2026, 9, 12 + i)); return d.toISOString().slice(0, 10); };
const MON = D(0), TUE = D(1), WED = D(2), THU = D(3);
resetLocal(ROOT); console.log('local D1 reset');
const tok = (await api('parent/login', { method: 'POST', body: { pin: PIN }, now: ny(MON) })).data.token;
const state = async (d) => (await api('state', { now: ny(d) })).data;
let st = await state(MON);
const kidOf = (s, n) => s.kids.find((k) => k.name === n);
const W = kidOf(st, 'Alex').id, E = kidOf(st, 'Sam').id;
await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: 'img:chores/dog.svg', title: 'Feed the dog', rotation: 'daily', rotKids: [W, E], minutes: 5 } });

const doItem = async (kid, it, day) => {
  if (it.slots) { for (const s of it.slots) if (!s.done) await api('check', { method: 'POST', now: ny(day), body: { kidId: kid, choreId: it.choreId, period: it.period, slot: s.slot, day } }); }
  else if (!it.done) await api('check', { method: 'POST', now: ny(day), body: { kidId: kid, choreId: it.choreId, period: it.period, day } });
};
const doAll = async (kid, day, skip = () => false) => { const k = (await state(day)).kids.find((x) => x.id === kid); for (const it of k.items) if (!skip(it)) await doItem(kid, it, day); };
// progress and the all-done bonus must agree on every day so far
const agree = (s, label) => {
  for (const k of s.kids) {
    const bad = k.progress.week.filter((w, i) => w.state !== 'upcoming' && w.state !== 'none' && (w.state === 'done') !== (k.stars[i] === 'done'));
    ok(!bad.length, `${label}: ${k.name} weekly slots agree with all-done bonus stars (${k.progress.week.map((w) => w.state[0]).join('')} vs ${k.stars.map((x) => x[0]).join('')})`);
  }
};

console.log('\nP1. Monday');
st = await state(MON);
let w = kidOf(st, 'Alex');
const cnt = w.items.filter((i) => i.countsOpen !== false);
ok(w.progress.day.of === cnt.reduce((a, i) => a + (i.times || 1), 0) && w.progress.day.n === 0, `daily bar starts empty: 0/${w.progress.day.of} (repeats counted)`);
ok(w.items.some((i) => i.title === 'Put away laundry' && i.countsOpen === false) && w.items.some((i) => i.title === 'Take out trash' && i.countsOpen === false), 'Monday: open any-day laundry and Mon/Thu trash are shown but not counted');
ok(w.progress.week.slice(1).every((x) => x.state === 'upcoming') && w.progress.week[0].state === 'today', 'Mon = today, Tue..Sun upcoming');
ok(w.items.some((i) => i.title === 'Feed the dog') && !kidOf(st, 'Sam').items.some((i) => i.title === 'Feed the dog'), 'Monday dog turn is Alex’s only');
const wk1 = (it) => it.schedule === 'weekly';
await doAll(W, MON, wk1);
st = await state(MON); w = kidOf(st, 'Alex');
ok(w.allDone && w.stars[0] === 'done' && w.progress.week[0].state === 'done' && w.balance.minutes > 0, `bonus: Alex all done Monday without the open weekly chores (${w.balance.minutes} min incl. bonus)`);
const before = w.balance.minutes;
await doAll(W, MON);
st = await state(MON); w = kidOf(st, 'Alex');
ok(w.allDone && w.progress.week[0].state === 'done' && w.progress.day.of > cnt.reduce((a, i) => a + (i.times || 1), 0), 'doing the weekly chores Monday adds them to Monday’s total as done');
ok(w.balance.minutes === before + 10 + 10, `no second daily bonus, just the chore rewards (${before} → ${w.balance.minutes})`);
await doAll(E, MON, (it) => it.title === 'Brush teeth');
const ellT = kidOf(await state(MON), 'Sam').items.find((i) => i.title === 'Brush teeth');
await api('check', { method: 'POST', now: ny(MON), body: { kidId: E, choreId: ellT.choreId, period: ellT.period, slot: 1, day: MON } });
st = await state(MON); w = kidOf(st, 'Alex'); let e = kidOf(st, 'Sam');
ok(w.progress.day.allDone && w.progress.week[0].state === 'done' && w.progress.weekDone === 1 && w.stars[0] === 'done', 'Alex all done: daily full, Monday slot filled, bonus star');
ok(!e.progress.day.allDone && e.progress.week[0].state === 'today' && e.progress.day.n === e.progress.day.of - 1, `Sam teeth AM only: ${e.progress.day.n}/${e.progress.day.of}, slot not filled`);
agree(st, 'Mon');

console.log('\nP2. Uncheck regressions');
const bed = w.items.find((i) => i.title === 'Make your bed');
await api('uncheck', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: bed.choreId, period: bed.period } });
st = await state(MON); w = kidOf(st, 'Alex');
ok(!w.progress.day.allDone && w.progress.week[0].state === 'today' && w.stars[0] !== 'done', 'uncheck: daily bar drops, Monday slot empties, bonus star gone');
await doItem(W, w.items.find((i) => i.title === 'Make your bed'), MON);
const tw = kidOf(await state(MON), 'Alex').items.find((i) => i.title === 'Brush teeth');
await api('uncheck', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: tw.choreId, period: tw.period, slot: 2 } });
st = await state(MON); w = kidOf(st, 'Alex');
ok(w.progress.week[0].state === 'today' && w.progress.day.n === w.progress.day.of - 1, 'un-tick one repeat (PM): not all done, bar one short');
await doItem(W, w.items.find((i) => i.title === 'Brush teeth'), MON);
st = await state(MON); ok(kidOf(st, 'Alex').progress.week[0].state === 'done', 're-tick: Monday slot full again');
agree(st, 'Mon after uncheck/recheck');

console.log('\nP3. Tuesday (rotation flips; weekly laundry already done Monday)');
st = await state(TUE); w = kidOf(st, 'Alex'); e = kidOf(st, 'Sam');
ok(e.progress.week[0].state === 'missed' && w.progress.week[0].state === 'done' && w.progress.week[1].state === 'today', 'Sam Monday shows missed; Alex Monday stays done; Tuesday in progress');
ok(!w.items.some((i) => i.title === 'Feed the dog') && e.items.some((i) => i.title === 'Feed the dog'), 'Tuesday dog turn is Sam’s');
ok(!w.items.some((i) => i.title === 'Put away laundry'), 'weekly any-day laundry done Monday: not counted Tuesday');
await doAll(W, TUE); await doAll(E, TUE);
st = await state(TUE); agree(st, 'Tue');
ok(kidOf(st, 'Sam').progress.week[1].state === 'done' && kidOf(st, 'Sam').progress.week[1].of > kidOf(st, 'Alex').progress.week[1].of - 1, 'Sam Tuesday full incl. his dog turn');

console.log('\nP4. Wednesday: Alex skips one; Thursday: history endpoint');
await doAll(W, WED, (it) => it.title === 'Pick up toys'); await doAll(E, WED);
const pr = (await api(`progress?week=${MON}`, { now: ny(THU) })).data;
const pw = pr.kids.find((k) => k.kidId === W).week, pe = pr.kids.find((k) => k.kidId === E).week;
ok(pw.map((x) => x.state).join() === 'done,done,missed,today,upcoming,upcoming,upcoming', `Alex week: ${pw.map((x) => x.state).join()}`);
ok(pe.map((x) => x.state).slice(0, 3).join() === 'missed,done,done', `Sam week: ${pe.map((x) => x.state).join()}`);
agree(await state(THU), 'Thu');
const lastWeek = (await api(`progress?week=2026-10-05`, { now: ny(THU) })).data;
ok(lastWeek.weekStart === '2026-10-05' && lastWeek.kids.every((k) => k.week.every((x) => x.state === 'missed')), 'last week (chores existed, nothing checked) reads as missed, never done');

console.log('\nP4b. Last available day (Sunday) for an any-day chore');
const SUN2 = '2026-10-25';
await doAll(E, SUN2, (it) => it.title === 'Put away laundry');
st = await state(SUN2); e = kidOf(st, 'Sam');
ok(!e.allDone && e.progress.week[6].state === 'today' && e.stars[6] !== 'done' && e.items.find((i) => i.title === 'Put away laundry').countsOpen === true, 'Sunday: open laundry counts and blocks all-done + bonus');
const eb = e.balance.minutes;
await doAll(E, SUN2);
st = await state(SUN2); e = kidOf(st, 'Sam');
ok(e.allDone && e.progress.week[6].state === 'done' && e.stars[6] === 'done' && e.balance.minutes === eb + 10 + 10, `laundry done Sunday: all done, bonus (${eb} → ${e.balance.minutes})`);
agree(st, 'Sun next week');
ok(e.progress.week.slice(0, 6).every((x) => x.state === 'missed'), 'rest of that week (nothing done) is missed, not blocked by laundry rules');

console.log('\nP5. UI');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [n, vp] of [['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }]]) {
  const p = await browser.newPage(); await p.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(`${BASE}/?k=${KEY}&now=${ny(THU)}`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.pb-week');
  const ui = await p.evaluate(() => ({ slots: [...document.querySelectorAll('.pb-slot')].map((s) => s.dataset.state), cur: document.querySelector('.pb-slot[aria-current="date"]')?.dataset.day, now: +document.querySelector('.pb-daily').dataset.done, max: +document.querySelector('.pb-daily').dataset.total, pct: document.querySelector('.pb-daily').style.getPropertyValue('--pct'), label: document.querySelector('.pb-week__title small').textContent, sw: document.documentElement.scrollWidth, vw: innerWidth }));
  const exp = pw.map((x) => ({ upcoming: 'empty', none: 'rest' }[x.state] || x.state));
  ok(ui.slots.join() === exp.join(), `${n}: UI slots match server (${ui.slots.join()})`);
  ok(ui.cur === THU && ui.label === '2 of 7 stars' && ui.pct === String(Math.round(ui.now / ui.max * 100)), `${n}: today marked, "${ui.label}", --pct ${ui.pct}`);
  ok(ui.sw <= ui.vw, `${n}: no horizontal overflow`);
  await p.screenshot({ path: `${SHOTS}${n}-thu-before.png` });
  await p.tap('.chore:not(.is-done):not(.multi)'); await sleep(500);
  const now2 = await p.$eval('.pb-daily', (x) => +x.dataset.done);
  ok(now2 === ui.now + 1, `${n}: tapping a chore moves the daily bar ${ui.now} → ${now2} of ${ui.max}`);
  await p.screenshot({ path: `${SHOTS}${n}-thu-after-tap.png` });
  // put it back
  await p.tap('.chore.is-done:not(.multi)'); await sleep(900);
  await p.close();
}
await doAll(W, THU);
{ const p = await browser.newPage(); await p.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(`${BASE}/?k=${KEY}&now=${ny(THU)}`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.pb-week');
  await p.waitForSelector('.cel-done', { timeout: 2500 }).catch(() => {}); if (await p.$('.cel-done')) { await p.click('.cel-done__btn').catch(() => {}); await sleep(700); }
  const f = await p.evaluate(() => ({ st: document.querySelector('.pb-daily').dataset.state, today: document.querySelector('.pb-slot[aria-current]').dataset.state, label: document.querySelector('.pb-week__title small').textContent }));
  ok(f.st === 'full' && f.today === 'today-done' && f.label === '3 of 7 stars', `all done Thursday: daily full, today-done slot, ${f.label}`);
  await p.screenshot({ path: `${SHOTS}ipad-thu-full.png` });
  // a day with nothing scheduled: rest panel
  // a kid with nothing scheduled: rest panel + rest slots for the past days and today
  await api('parent/kids', { method: 'POST', token: tok, now: ny(THU), body: { name: 'Kid 3', avatar: 'img:avatars/avatar-alien.svg', color: '#6BDB4B' } });
  await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  for (const b of await p.$$('.kid-btn')) if ((await b.$eval('.nm', (e) => e.textContent)) === 'Kid 3') await b.tap();
  await sleep(400);
  const r = await p.evaluate(() => ({ st: document.querySelector('.pb-daily').dataset.state, rest: !!document.querySelector('.pb-daily__rest'), slots: [...document.querySelectorAll('.pb-slot')].map((x) => x.dataset.state).join(), label: document.querySelector('.pb-week__title small').textContent }));
  ok(r.st === 'rest' && r.rest && r.slots === 'rest,rest,rest,rest,empty,empty,empty' && r.label === '0 of 7 stars', `no chores: Day off! panel, slots ${r.slots}`);
  await p.screenshot({ path: `${SHOTS}ipad-rest-day.png` });
  await p.close(); }
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
