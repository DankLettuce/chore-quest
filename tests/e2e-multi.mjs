// E2E for multi-times-per-day chores (AM / PM ...), against `wrangler pages dev` (local D1, test clock).
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { resetLocal } from './_db.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = ROOT + 'shots/';
mkdirSync(SHOTS, { recursive: true });
import { sec } from './env.mjs';
const KEY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ny = (day, hm = '09:00:00') => Date.parse(`${day}T${hm}-04:00`);
resetLocal(ROOT); // starter data: Brush teeth 2x (AM/PM), reward when both done
console.log('local D1 reset');

async function api(path, { method = 'GET', body, now, token } = {}) {
  const h = { 'x-family-key': KEY, 'content-type': 'application/json' };
  if (now) h['x-test-now'] = String(now);
  if (token) h['x-parent-token'] = token;
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14';
const state = async (d = MON) => (await api('state', { now: ny(d) })).data;
const kidOf = (st, n) => st.kids.find((k) => k.name === n);
const item = (st, n, t) => kidOf(st, n).items.find((i) => i.title === t);
const check = (kidId, it, slot, d = MON) => api('check', { method: 'POST', now: ny(d), body: { kidId, choreId: it.choreId, period: it.period, slot, day: d } });
const uncheck = (kidId, it, slot, d = MON) => api('uncheck', { method: 'POST', now: ny(d), body: { kidId, choreId: it.choreId, period: it.period, slot } });

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 30000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const IPAD = { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPAD_L = { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
async function newPage(vp) { const p = await (await browser.createBrowserContext()).newPage(); await p.setViewport(vp); p.on('dialog', (d) => d.accept()); p.on('pageerror', (e) => errors.push(e.message)); return p; }
async function open(p, d) { await p.bringToFront(); await p.goto(`${BASE}/?k=${KEY}&now=${ny(d)}`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.chore'); }
async function pickKid(p, n) { for (const b of await p.$$('.kid-btn')) if ((await b.$eval('.nm', (e) => e.textContent)) === n) { await b.tap(); await sleep(200); return; } }
const synced = (p) => p.waitForFunction(() => window.__chores.S.queue.length === 0, { timeout: 10000 });
const teethView = (p) => p.evaluate(() => { const c = [...document.querySelectorAll('.chore.multi')].find((x) => x.querySelector('.label').textContent === 'Brush teeth');
  return c && { slots: [...c.querySelectorAll('.slot')].map((s) => [s.querySelector('.sl').textContent, s.classList.contains('on')]), prog: c.querySelector('.prog').textContent, done: c.classList.contains('is-done') }; });
const minutes = (p) => p.$eval('.v-min', (e) => e.textContent);
async function closeParty(p) { await p.waitForSelector('.cel-done', { timeout: 4000 }).catch(() => {}); if (await p.$('.cel-done')) { await p.click('.cel-done__btn').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.cel-done'), { timeout: 5000 }).catch(() => {}); } }

let st = await state();
const W = kidOf(st, 'Alex').id, E = kidOf(st, 'Sam').id;
const tok = (await api('parent/login', { method: 'POST', body: { pin: PIN }, now: ny(MON) })).data.token;

console.log('\nM1. Starter chore + kid view');
const teethChore = st.chores.find((c) => c.title === 'Brush teeth');
ok(st.chores.filter((c) => /teeth/i.test(c.title)).length === 1 && teethChore.times === 2 && teethChore.labels.join() === 'AM,PM' && teethChore.rewardMode === 'all' && teethChore.minutes === 5 && teethChore.kidIds.length === 2, 'one Brush teeth chore: 2x, AM/PM, 5 min when both are done, both kids');
const a = await newPage(IPAD);
await open(a, MON);
let tv = await teethView(a);
ok(tv && tv.slots.map((x) => x[0]).join() === 'AM,PM' && tv.prog === '0/2' && !tv.done, 'Alex’s card has AM and PM checks, 0/2');
const small = await a.evaluate(() => [...document.querySelectorAll('#app button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 64 || r.height < 64).length);
ok(small === 0, 'every kid-view button (incl. AM/PM) is at least 64×64');
const toGo0 = await a.$eval('.hello .sub', (e) => e.textContent);
await a.screenshot({ path: SHOTS + 'M01-ipad-teeth-am-pm.png' });
await a.tap('.slot[data-slot="1"]'); await synced(a); await sleep(300);
tv = await teethView(a);
ok(tv.slots[0][1] && !tv.slots[1][1] && tv.prog === '1/2' && !tv.done && (await minutes(a)) === '0m', 'tap AM → 1/2, not done, no reward yet (reward only when both)');
ok((await a.$eval('.hello .sub', (e) => e.textContent)) !== toGo0, '“to go” counts each repeat');
await sleep(900);
await a.screenshot({ path: SHOTS + 'M02-ipad-teeth-partial.png' });
await a.tap('.slot[data-slot="2"]'); await synced(a); await sleep(300);
tv = await teethView(a);
ok(tv.done && tv.prog === '2/2' && (await minutes(a)) === '5m', 'tap PM → 2/2, done, +5 min');
await sleep(700); // past the double-tap guard
await a.tap('.slot[data-slot="2"]'); await synced(a); await sleep(300);
tv = await teethView(a);
ok(!tv.done && tv.prog === '1/2' && (await minutes(a)) === '0m', 'kid unchecks PM → back to 1/2, the 5 min comes back off');
await sleep(700);
await a.tap('.slot[data-slot="1"]'); await sleep(60); await a.tap('.slot[data-slot="1"]'); await synced(a); await sleep(300);
ok((await teethView(a)).prog === '0/2', 'double-tap guard: two quick taps on AM = one uncheck');

console.log('\nM2. All-done bonus and farming');
const ell0 = kidOf(await state(), 'Sam');
for (const it of ell0.items) if (it.title !== 'Brush teeth') await check(E, it);
let t = item(await state(), 'Sam', 'Brush teeth');
await check(E, t, 1);
let ell = kidOf(await state(), 'Sam');
ok(!ell.allDone && ell.stars[0] !== 'done', 'everything else + AM only: not all done, no bonus');
await check(E, t, 2);
ell = kidOf(await state(), 'Sam');
const full = ell.balance.minutes;
ok(ell.allDone && ell.stars[0] === 'done', 'PM too: all done, star + bonus');
await uncheck(E, t, 1);
ell = kidOf(await state(), 'Sam');
ok(!ell.allDone && ell.stars[0] !== 'done' && ell.balance.minutes === full - 5 - 10, 'uncheck AM: chore reward (5) and all-done bonus (10) come back off');
for (let i = 0; i < 4; i++) { await check(E, t, 1); await uncheck(E, t, 1); }
await check(E, t, 1);
ell = kidOf(await state(), 'Sam');
ok(ell.balance.minutes === full, `rapid check/uncheck cycles net to the same balance (${ell.balance.minutes} min)`);
const [r1, r2] = await Promise.all([check(E, t, 2), uncheck(E, t, 2)]);
const after = kidOf(await state(), 'Sam');
const bt = after.items.find((i) => i.title === 'Brush teeth');
ok((bt.done && after.balance.minutes === full) || (!bt.done && after.balance.minutes === full - 15), `concurrent check/uncheck of PM leaves a consistent state (done=${bt.done}, ${after.balance.minutes} min)`);

console.log('\nM3. Older app (no slot) + day limits');
let w = item(await state(), 'Alex', 'Brush teeth');
await api('check', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: w.choreId, period: w.period, day: MON } });
w = item(await state(), 'Alex', 'Brush teeth');
ok(w.progress.n === 1 && w.slots[0].done, 'a check without a slot (older cached app) ticks the next open repeat');
await api('uncheck', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: w.choreId, period: w.period } });
ok(item(await state(), 'Alex', 'Brush teeth').progress.n === 0, 'an uncheck without a slot removes the last one');
await check(W, w, 1);
let r = await uncheck(W, w, 1, TUE);
ok(r.status === 403, 'kid can’t uncheck yesterday’s AM (403)');
r = await api('parent/untick', { method: 'POST', token: tok, now: ny(TUE), body: { kidId: W, choreId: w.choreId, period: MON, slot: 1 } });
ok(r.status === 200, 'parent can un-tick an earlier day');
await check(W, w, 1);
r = await check(W, w, 3);
ok(r.status === 400, 'slot 3 of a 2x chore is refused');

console.log('\nM4. “Each check” rewards, parent form');
const pg = await newPage(IPAD);
await open(pg, MON);
await pg.tap('[data-act="parent"]'); await pg.waitForSelector('[data-pin="1"]');
for (const d of PIN) { await pg.tap(`[data-pin="${d}"]`); await sleep(40); }
await pg.waitForSelector('.tabs');
await pg.tap('[data-tab="chores"]'); await sleep(200);
await pg.tap('[data-p="addchore"]'); await pg.waitForSelector('[data-field="title"]');
await pg.type('[data-field="title"]', 'Feed the fish');
await pg.$eval('[data-field="emoji"]', (e) => { e.value = ''; }); await pg.type('[data-field="emoji"]', '🐟');
await pg.tap('[data-set="times"][data-v="3"]'); await sleep(150);
for (const [i, l] of ['Morning', 'Noon', 'Night'].entries()) await pg.type(`[data-label="${i}"]`, l);
await pg.$eval('[data-field="minutes"]', (e) => { e.value = ''; }); await pg.type('[data-field="minutes"]', '2');
await pg.evaluate(() => document.querySelector('.seg.times').scrollIntoView({ block: 'start' }));
await pg.screenshot({ path: SHOTS + 'M03-parent-chore-form-3x-each.png' });
await pg.tap('[data-set="rewardMode"][data-v="all"]'); await sleep(150);
await pg.tap('[data-set="rewardMode"][data-v="each"]'); await sleep(150);
await pg.tap('[data-p="savechore"]'); await sleep(700);
st = await state();
const fish = st.chores.find((c) => c.title === 'Feed the fish');
ok(fish && fish.times === 3 && fish.labels.join() === 'Morning,Noon,Night' && fish.rewardMode === 'each' && fish.minutes === 2, 'saved from the form: 3x, Morning/Noon/Night, 2 min per check');
await pg.tap(`[data-editchore="${teethChore.id}"]`); await sleep(300);
await pg.evaluate(() => document.querySelector('.seg.times').scrollIntoView({ block: 'start' }));
await pg.screenshot({ path: SHOTS + 'M04-parent-chore-form-teeth-2x-all.png' });
await pg.tap('[data-p="cancel"]'); await sleep(200);
const wb = kidOf(await state(), 'Alex').balance.minutes;
let f = item(await state(), 'Alex', 'Feed the fish');
await check(W, f, 1); await check(W, f, 3);
ok(kidOf(await state(), 'Alex').balance.minutes === wb + 4, 'each-check mode: 2 of 3 checks = +4 min');
await uncheck(W, f, 3);
ok(kidOf(await state(), 'Alex').balance.minutes === wb + 2, 'uncheck one → +2');
await pg.evaluate(() => window.__chores.refresh()); await sleep(300);
await pg.tap('[data-tab="today"]'); await sleep(300);
const ptxt = await pg.$eval('.sheet', (e) => e.textContent);
ok(ptxt.includes('1/3') && ptxt.includes('1/2'), 'parent Today shows progress 1/3 (fish) and 1/2 (teeth)');
await pg.screenshot({ path: SHOTS + 'M05-parent-today-progress.png' });
await pg.tap(`[data-marktick="${W}|${f.choreId}|${MON}|2"]`); await sleep(600);
ok(item(await state(), 'Alex', 'Feed the fish').progress.n === 2, 'parent ✓ Noon button ticks that repeat');

console.log('\nM5. History');
const h = (await api(`parent/history?week=${MON}`, { token: tok, now: ny(TUE) })).data;
const hm = h.kids.find((k) => k.name === 'Alex').days.find((x) => x.day === MON);
ok(hm.partial.some((x) => x.title === 'Feed the fish' && x.progress.n === 2 && x.progress.of === 3) && hm.partial.some((x) => x.title === 'Brush teeth' && x.progress.n === 1), 'history: unfinished repeats show as 2/3 and 1/2');
ok(hm.earned.minutes >= 4, 'history: per-check rewards count in the day’s earnings');
const he = h.kids.find((k) => k.name === 'Sam').days.find((x) => x.day === MON);
ok(he.done.some((x) => x.title === 'Brush teeth' && x.progress?.n === 2) || he.partial.some((x) => x.title === 'Brush teeth'), 'history: Sam’s teeth shows 2/2 (or partial)');
await pg.tap('[data-tab="history"]'); await sleep(900);
await pg.screenshot({ path: SHOTS + 'M06-parent-history-progress.png' });
await pg.tap('[data-p="exit"]'); await sleep(400);

console.log('\nM6. Rotations');
r = await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: '🐶', title: 'Walk the dog', rotation: 'daily', rotKids: [W, E], times: 2, labels: ['AM', 'PM'], rewardMode: 'all', minutes: 10 } });
const dog = r.data.chores.find((c) => c.title === 'Walk the dog');
let dw = item(r.data, 'Alex', 'Walk the dog');
ok(dw && dw.slots.length === 2 && !item(r.data, 'Sam', 'Walk the dog'), 'daily turn: both AM and PM are Alex’s today');
r = await check(E, dw, 1);
ok(r.status === 400, 'Sam can’t tick Alex’s turn');
await check(W, dw, 1);
r = await api('parent/turn', { method: 'POST', token: tok, now: ny(MON), body: { choreId: dog.id, action: 'swap', kidId: E } });
ok(r.status === 409, 'swap refused once a repeat of the turn is ticked');
ok(item(await state(TUE), 'Sam', 'Walk the dog')?.slots.length === 2, 'next day both repeats are Sam’s');
r = await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: '🗑️', title: 'Bins', rotation: 'weekly', rotKids: [E, W], days: [], times: 2, labels: ['Out', 'Back'], rewardMode: 'all', minutes: 10 } });
let bins = item(r.data, 'Sam', 'Bins');
await check(E, bins, 1, MON);
let bt2 = item(await state(TUE), 'Sam', 'Bins');
ok(bt2 && bt2.progress.n === 1 && !bt2.done, 'weekly turn: “Out” Monday still shows Tuesday as 1/2 (repeats can be spread over the week)');
await check(E, bt2, 2, WED);
ok(item(await state(WED), 'Sam', 'Bins')?.done && !item(await state('2026-10-15'), 'Sam', 'Bins'), 'done Wednesday → drops off for the rest of the week');
ok(item(await state('2026-10-19'), 'Alex', 'Bins')?.progress.n === 0, 'next week: Alex’s, fresh 0/2');

console.log('\nM7. Landscape + Sam');
const L = await newPage(IPAD_L);
await open(L, MON);
await pickKid(L, 'Alex');
await L.screenshot({ path: SHOTS + 'M07-ipad-landscape-alex-partial.png', fullPage: true });
await pickKid(L, 'Sam');
await closeParty(L);
await L.screenshot({ path: SHOTS + 'M08-ipad-landscape-sam.png', fullPage: true });
await open(a, MON); await pickKid(a, 'Alex');
await a.screenshot({ path: SHOTS + 'M09-ipad-alex-multi-full.png', fullPage: true });

ok(errors.length === 0, `no page JS errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
