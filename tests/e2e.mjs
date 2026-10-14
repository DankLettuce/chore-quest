// End-to-end test against `wrangler pages dev` (local D1, ALLOW_TEST_CLOCK=1).
// Usage: node tests/e2e.mjs   (server must be running on 127.0.0.1:8788)
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resetLocal } from './_db.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = ROOT + 'shots/';
mkdirSync(SHOTS, { recursive: true });
import { sec } from './env.mjs';
const KEY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;

let pass = 0, fail = 0;
const results = [];
function ok(cond, name) {
  if (cond) { pass++; results.push(`PASS ${name}`); console.log(`  ✔ ${name}`); }
  else { fail++; results.push(`FAIL ${name}`); console.log(`  ✘ ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ny = (day, hm = '09:00:00') => Date.parse(`${day}T${hm}-04:00`);

// ---------- reset local D1 ----------
const wr = resetLocal(ROOT, { singleTeeth: true });
console.log('local D1 reset');

async function api(path, { method = 'GET', body, now, token, key = KEY } = {}) {
  const h = { 'x-family-key': key, 'content-type': 'application/json' };
  if (now) h['x-test-now'] = String(now);
  if (token) h['x-parent-token'] = token;
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const IPAD = { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPAD_L = { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const foreign = [];
const errors = [];

async function newPage(ctx, vp) {
  const p = await ctx.newPage();
  await p.setViewport(vp);
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:')) foreign.push(u); });
  return p;
}
async function open(p, now, extra = '') {
  await p.goto(`${BASE}/?k=${KEY}&now=${now}${extra}`, { waitUntil: 'networkidle0' });
  await p.waitForSelector('.chore, .empty', { timeout: 10000 });
}
const shot = (p, name) => p.screenshot({ path: SHOTS + name });
async function closeParty(p) {
  await p.waitForSelector('.cel-done', { timeout: 5000 }).catch(() => {});
  if (await p.$('.cel-done')) { await p.click('.cel-done__btn'); await sleep(400); }
}
const synced = (p) => p.waitForFunction(() => window.__chores.S.queue.length === 0, { timeout: 10000 });
async function tapChore(p, title) {
  const cards = await p.$$('.chore');
  for (const c of cards) if ((await c.$eval('.label', (e) => e.textContent)) === title) { await c.tap(); return true; }
  throw new Error(`no chore ${title}`);
}
async function pickKid(p, name) {
  const btns = await p.$$('.kid-btn');
  for (const b of btns) if ((await b.$eval('.nm', (e) => e.textContent)) === name) { await b.tap(); await sleep(150); return; }
  throw new Error(`no kid ${name}`);
}
const kidView = (p) => p.evaluate(() => ({
  hello: document.querySelector('.hello h1')?.textContent,
  day: (document.querySelector('.hello .sub')?.textContent || '').split(' ·')[0],
  cards: [...document.querySelectorAll('.chore')].map((c) => ({ t: c.querySelector('.label').textContent, done: c.classList.contains('is-done'), tag: c.querySelector('.tag')?.textContent || '' })),
  minutes: document.querySelector('.v-min')?.textContent, money: document.querySelector('.v-money')?.textContent,
  allDone: !!document.querySelector('.alldone'), kids: [...document.querySelectorAll('.kid-btn .nm')].map((e) => e.textContent),
}));
async function pinLogin(p, pin) {
  await p.tap('[data-act="parent"]');
  await p.waitForSelector('[data-pin="1"]');
  for (const d of pin) { await p.tap(`[data-pin="${d}"]`); await sleep(40); }
}

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15';

// ============ 1. iPad portrait: kids, check-off, rewards, all-done ============
console.log('\n1. iPad portrait: kid view, check-offs, rewards, all-done bonus');
const ctxA = await browser.createBrowserContext();
const a = await newPage(ctxA, IPAD);
await open(a, ny(MON));
let v = await kidView(a);
ok(v.hello === 'Hi, Alex!' && v.day === 'Monday', 'opens on Alex, Monday');
ok(v.kids.join(',') === 'Alex,Sam', 'two kids: Alex, Sam');
ok(v.cards.length === 7 && v.cards.some((c) => c.t === 'Take out trash') && v.cards.some((c) => c.t === 'Put away laundry' && c.tag.includes('This week')), 'Alex sees 5 daily + trash (Mon) + weekly laundry');
const small = await a.evaluate(() => [...document.querySelectorAll('#app button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 64 || r.height < 64).length);
ok(small === 0, 'every kid-view button is at least 64x64 px');
await shot(a, '01-ipad-kid1.png');

await pickKid(a, 'Sam');
v = await kidView(a);
ok(v.hello === 'Hi, Sam!' && v.cards.length === 6 && !v.cards.some((c) => c.t === 'Take out trash'), 'switch to Sam: 6 chores, no trash');
await shot(a, '02-ipad-kid2.png');

await tapChore(a, 'Make your bed');
await sleep(250);
await shot(a, '03-checkoff-celebration.png');
await synced(a);
v = await kidView(a);
ok(v.cards.find((c) => c.t === 'Make your bed').done && v.minutes === '5m', 'check-off marks done and adds 5 min');
const lsMute = await a.evaluate(() => localStorage.getItem('chores.mute'));
await a.tap('[data-act="mute"]'); await sleep(100);
ok((await a.evaluate(() => localStorage.getItem('chores.mute'))) === '1' && (await a.$eval('[data-act="mute"]', (e) => e.textContent)) === '🔇', 'mute toggle persists to localStorage');
await a.tap('[data-act="mute"]');

for (const t of ['Brush teeth', 'Get dressed', 'Pack backpack', 'Pick up toys']) { await tapChore(a, t); await sleep(120); }
await synced(a);
await tapChore(a, 'Put away laundry');
await sleep(450);
await shot(a, '04a-checkoff-rocket.png');
await a.waitForSelector('.cel-done', { timeout: 5000 }).then(() => ok(true, 'all-done celebration screen appears')).catch(() => ok(false, 'all-done celebration screen appears'));
await sleep(1200);
await shot(a, '04b-all-done-party.png');
await closeParty(a);
await synced(a);
v = await kidView(a);
ok(v.allDone, 'all-done banner shows');
ok(v.minutes === '45m' && v.money === '$1', 'balance = 25 + 10 laundry + 10 all-done bonus = 45 min, $1');
let st = (await api('state', { now: ny(MON) })).data;
ok(st.kids[1].stars[0] === 'done', 'Monday star earned for Sam');
await shot(a, '05-all-done-after.png');

// ---- kid uncheck (no PIN) ----
console.log('\n1b. Kid uncheck');
const sqlJson = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'chore-quest', '--local', '--json', '--command', q], { cwd: ROOT, stdio: 'pipe' }).toString())[0].results;
const sam = async () => (await api('state', { now: ny(MON) })).data.kids[1];
const celCount = () => a.evaluate(() => window.__celCount || 0);
await a.evaluate(() => { window.__celCount = 0; new MutationObserver((m) => m.forEach((r) => r.addedNodes.forEach((n) => { if (n.classList?.contains('cel-done')) window.__celCount++; }))).observe(document.body, { childList: true }); });
ok((await a.$$('.chore.is-done .undo-hint')).length === 6, 'every done card shows the small ↩ undo hint');
await shot(a, '05a-done-with-undo-hint.png');
await sleep(700);
await tapChore(a, 'Make your bed');
await sleep(120);
await shot(a, '05b-uncheck-animation.png');
await synced(a); await sleep(300);
let e = await sam();
v = await kidView(a);
ok(!v.cards.find((c) => c.t === 'Make your bed').done && !v.allDone, 'tapping a checked chore unchecks it (no PIN)');
ok(e.balance.minutes === 30 && e.balance.cents === 100 && !e.allDone && e.stars[0] === 'today', 'uncheck takes back 5 min and the 10-min all-done bonus (45 → 30)');
ok(v.minutes === '30m', 'kid screen balance updates to 30m');
await sleep(700);
await tapChore(a, 'Make your bed'); await synced(a); await sleep(2000);
e = await sam();
ok(e.balance.minutes === 45 && e.allDone, 're-check restores chore + bonus (back to 45, not more)');
ok((await celCount()) === 0 && !(await a.$('.cel-done')), 're-check does not replay the All done! celebration');
for (let i = 0; i < 4; i++) { await sleep(650); await tapChore(a, 'Make your bed'); await sleep(650); await tapChore(a, 'Make your bed'); }
await synced(a); await sleep(500);
e = await sam();
const bon = sqlJson(`SELECT count(*) AS n FROM bonuses WHERE kid_id = 2 AND period = '${MON}'`)[0].n;
const comps = sqlJson(`SELECT count(*) AS n FROM completions WHERE kid_id = 2 AND chore_id = 1`)[0].n;
ok(e.balance.minutes === 45 && e.balance.cents === 100 && bon === 1 && comps === 1, '4 rapid uncheck/re-check cycles: still 45 min / $1, one bonus row, one completion (no farming)');
ok((await celCount()) === 0, 'no All done! replays during rapid toggling');
// double-tap guard: two taps 80 ms apart count once
await sleep(700);
await tapChore(a, 'Brush teeth'); await sleep(80); await tapChore(a, 'Brush teeth');
await synced(a); await sleep(300);
e = await sam();
ok(!e.items.find((i) => i.title === 'Brush teeth').done && e.balance.minutes === 30, 'double-tap guard: two quick taps = one uncheck, not uncheck + re-check');
await sleep(700);
await tapChore(a, 'Brush teeth'); await synced(a); await sleep(300);
// offline: uncheck then re-check before sync cancels out locally
await a.setOfflineMode(true); await a.evaluate(() => window.dispatchEvent(new Event('offline')));
await sleep(700); await tapChore(a, 'Get dressed'); await sleep(700); await tapChore(a, 'Get dressed');
const qlen = await a.evaluate(() => window.__chores.S.queue.length);
await a.setOfflineMode(false); await a.evaluate(() => window.dispatchEvent(new Event('online')));
await synced(a); await sleep(300);
e = await sam();
ok(qlen === 0 && e.balance.minutes === 45 && e.allDone, 'offline uncheck + re-check cancel out locally (nothing sent, still 45)');
await shot(a, '05c-after-toggles.png');

// ============ 2. parent PIN, undo, add kid, add chore, payouts, history, PIN change ============
console.log('\n2. Parent mode');
const wrong = PIN === '0000' ? '1111' : '0000';
await pinLogin(a, wrong); await sleep(500);
ok((await a.$eval('.pin .err', (e) => e.textContent)) === 'Wrong PIN', 'wrong PIN is rejected');
await shot(a, '06-pin-gate.png');
for (const d of PIN) { await a.tap(`[data-pin="${d}"]`); await sleep(40); }
await a.waitForSelector('.tabs');
ok(true, 'correct PIN opens grown-up mode');
await shot(a, '07-parent-today.png');

// undo Sam's Make bed -> loses 5 + 10 bonus
const undoBtns = await a.$$('[data-undo]');
let undone = false;
for (const b of undoBtns) {
  const title = await b.evaluate((e) => e.closest('.line').querySelector('.t').textContent);
  if (title === 'Make your bed') { await b.tap(); undone = true; break; }
}
await sleep(600);
st = (await api('state', { now: ny(MON) })).data;
ok(undone && st.kids[1].balance.minutes === 30 && !st.kids[1].allDone && st.kids[1].stars[0] === 'today', 'undo removes chore reward and the all-done bonus (45 → 30)');
// re-check from parent "Mark done"
const md = await a.$$('[data-markdone]');
await md[md.length - 1].evaluate((e) => e.scrollIntoView());
for (const b of md) { if ((await b.evaluate((e) => e.dataset.markdone)).startsWith('2|1|')) { await b.tap(); break; } }
await sleep(600);
st = (await api('state', { now: ny(MON) })).data;
ok(st.kids[1].balance.minutes === 45 && st.kids[1].allDone, 'parent "Mark done" re-earns chore + bonus (back to 45)');

// add a third kid, timed
await a.tap('[data-tab="kids"]'); await sleep(200);
const t0 = Date.now();
await a.tap('[data-p="addkid"]'); await sleep(150);
await a.type('[data-field="name"]', 'Kid 3');
ok((await a.$$eval('.pick.avatars [data-set="avatar"] img', (im) => im.filter((i) => i.complete && i.naturalWidth > 0).length)) === 8, 'avatar picker shows all 8 avatars (incl. astronaut-blond, captain-brown) and they load');
await a.tap('[data-set="avatar"][data-v="img:avatars/avatar-alien.svg"]'); await sleep(100);
await a.evaluate(() => [...document.querySelectorAll('[data-set="copyFromKid"]')].find((b) => b.textContent === 'Sam').click()); await sleep(100);
await shot(a, '08-add-kid-form.png');
await a.tap('[data-p="savekid"]'); await sleep(700);
const addSecs = (Date.now() - t0) / 1000;
st = (await api('state', { now: ny(MON) })).data;
const k3 = st.kids.find((k) => k.name === 'Kid 3');
ok(k3 && k3.avatar === 'img:avatars/avatar-alien.svg' && k3.items.length === 6, `third kid added with avatar and Sam's chores (${addSecs.toFixed(1)}s of scripted taps)`);

// add a weekly chore pinned to Wednesday for Alex + Kid 3
await a.tap('[data-tab="chores"]'); await sleep(200);
await a.tap('[data-p="addchore"]'); await sleep(150);
await a.tap('[data-set="emoji"][data-v="img:chores/water-plants.svg"]'); await sleep(80);
await a.type('[data-field="title"]', 'Water plants');
await a.evaluate(() => document.querySelector('[data-togglekid="2"]').click()); await sleep(80); // deselect Sam
await a.tap('[data-set="schedule"][data-v="weekly"]'); await sleep(80);
await a.tap('[data-toggleday="3"]'); await sleep(80);
await a.$eval('[data-field="minutes"]', (e) => { e.value = ''; });
await a.type('[data-field="minutes"]', '5');
await a.$eval('[data-field="dollars"]', (e) => { e.value = ''; });
await a.type('[data-field="dollars"]', '0.25');
await shot(a, '09-chore-form.png');
await a.tap('[data-p="savechore"]'); await sleep(700);
st = (await api('state', { now: ny(MON) })).data;
const wp = st.chores.find((c) => c.title === 'Water plants');
ok(wp && wp.schedule === 'weekly' && wp.days.join() === '3' && wp.cents === 25 && wp.kidIds.sort().join() === `1,${k3.id}`, 'new weekly chore saved (Wed, 5 min, $0.25, Alex + Kid 3)');
await shot(a, '10-parent-chores.png');

// payouts: partial then all
await a.tap('[data-tab="rewards"]'); await sleep(200);
await a.type('#pm-2', '15'); await a.type('#pc-2', '0.50');
await a.tap('[data-paypart="2"]'); await sleep(600);
st = (await api('state', { now: ny(MON) })).data;
ok(st.kids[1].balance.minutes === 30 && st.kids[1].balance.cents === 50, 'partial payout 15 min + $0.50 → 30 min, $0.50 left');
await shot(a, '11-rewards.png');
await a.tap('[data-payall="2"]'); await sleep(600);
st = (await api('state', { now: ny(MON) })).data;
ok(st.kids[1].balance.minutes === 0 && st.kids[1].balance.cents === 0, '"Mark all paid / used" zeroes the balance');

// history
await a.tap('[data-tab="history"]'); await sleep(900);
const hist = await a.evaluate(() => [...document.querySelectorAll('.pcard')].map((c) => c.textContent.replace(/\s+/g, ' ')));
ok(hist.some((h) => h.includes('Sam') && h.includes('paid −15m −$0.50') && h.includes('paid −30m −$0.50')), 'history shows Sam earnings and both payouts');
await shot(a, '12-history.png');

// change PIN and back
const tmp = PIN === '2468' ? '1357' : '2468';
let li = await api('parent/login', { method: 'POST', body: { pin: PIN } });
let r = await api('parent/pin', { method: 'PUT', token: li.data.token, body: { currentPin: PIN, newPin: tmp } });
const oldFails = (await api('parent/login', { method: 'POST', body: { pin: PIN } })).status;
const newOk = (await api('parent/login', { method: 'POST', body: { pin: tmp } })).status;
const unlockNew = await api('unlock', { method: 'POST', key: '', body: { pin: tmp } });
const unlockOld = await api('unlock', { method: 'POST', key: '', body: { pin: PIN } });
ok(unlockNew.data.key === KEY && unlockOld.status === 403, 'PIN change re-seals the family key: device unlock works with the new PIN, not the old');
await api('parent/pin', { method: 'PUT', token: r.data.token, body: { currentPin: tmp, newPin: PIN } });
ok(r.status === 200 && oldFails === 403 && newOk === 200, 'PIN change: old PIN rejected, new PIN works (then restored)');
await a.tap('[data-tab="settings"]'); await sleep(200);
await shot(a, '13-settings.png');
// session from before PIN change was revoked
await a.tap('[data-tab="today"]'); await sleep(200);
await a.tap('[data-p="exit"]'); await sleep(300);

// ============ 3. weekly chores carry over ============
console.log('\n3. Weekly chores');
await open(a, ny(WED));
await pickKid(a, 'Alex');
v = await kidView(a);
ok(v.cards.some((c) => c.t === 'Take out trash' && c.tag.includes('Mon')), 'Wed: Monday trash still open, tagged ⏰ Mon');
ok(v.cards.some((c) => c.t === 'Put away laundry' && c.tag.includes('This week')), 'Wed: "any day" laundry still open for Alex');
ok(v.cards.some((c) => c.t === 'Water plants'), 'Wed: new Wednesday chore shows');
await a.screenshot({ path: SHOTS + '14-weekly-carryover.png', fullPage: true });
await pickKid(a, 'Sam');
v = await kidView(a);
ok(!v.cards.some((c) => c.t === 'Put away laundry'), 'Wed: Sam laundry gone (done Monday)');
await pickKid(a, 'Alex');
await tapChore(a, 'Take out trash'); await synced(a); await sleep(2600);
await open(a, ny(THU));
v = await kidView(a);
const trash = v.cards.filter((c) => c.t === 'Take out trash');
ok(trash.length === 1 && !trash[0].tag.includes('Mon'), 'Thu: Mon trash done Wed, only Thursday trash shows');
ok(v.cards.some((c) => c.t === 'Water plants' && c.tag.includes('Wed')), 'Thu: missed Wednesday chore carries over, tagged ⏰ Wed');

// ============ 4. midnight rollover ============
console.log('\n4. Midnight rollover');
await open(a, ny(TUE, '23:59:52'));
v = await kidView(a);
ok(v.day === 'Tuesday', 'before midnight: Tuesday');
await shot(a, '15-rollover-before.png');
await a.waitForFunction(() => (document.querySelector('.hello .sub')?.textContent || '').startsWith('Wednesday'), { timeout: 20000 }).catch(() => {});
v = await kidView(a);
ok(v.day === 'Wednesday' && v.cards.some((c) => c.t === 'Water plants'), 'app flips to Wednesday by itself at midnight NY (no reload)');
await shot(a, '16-rollover-after.png');

// ============ 5. sync between two devices ============
console.log('\n5. Sync between two browser contexts');
const ctxB = await browser.createBrowserContext();
const b = await newPage(ctxB, IPAD);
await open(a, ny('2026-10-16'), '&poll=3');
await open(b, ny('2026-10-16'), '&poll=3');
await pickKid(a, 'Kid 3'); await pickKid(b, 'Kid 3');
await tapChore(a, 'Brush teeth'); await synced(a);
const t1 = Date.now();
await b.waitForFunction(() => [...document.querySelectorAll('.chore.is-done .label')].some((e) => e.textContent === 'Brush teeth'), { timeout: 10000 }).then(() => ok(true, `device B shows device A's check-off by polling (${((Date.now() - t1) / 1000).toFixed(1)}s)`)).catch(() => ok(false, 'device B shows device A\'s check-off'));
await shot(b, '17-sync-device-b.png');
// visibilitychange-triggered refresh
await tapChore(a, 'Make your bed'); await synced(a);
await b.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(800);
ok((await kidView(b)).cards.find((c) => c.t === 'Make your bed').done, 'refresh on visibilitychange picks up the change');

// ============ 6. offline queue + offline open ============
console.log('\n6. Offline');
await a.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 }).catch(() => {});
await a.setOfflineMode(true);
await a.evaluate(() => window.dispatchEvent(new Event('offline')));
await tapChore(a, 'Get dressed'); await sleep(400);
v = await kidView(a);
const q = await a.evaluate(() => window.__chores.S.queue.length);
ok(q === 1 && v.cards.find((c) => c.t === 'Get dressed').done, 'offline check-off shows done and is queued');
await shot(a, '18-offline-queued.png');
await a.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await a.waitForSelector('.chore', { timeout: 8000 }).then(() => ok(true, 'app shell opens offline from the service worker cache')).catch(() => ok(false, 'app opens offline'));
await sleep(500);
await shot(a, '19-offline-reopen.png');
await a.setOfflineMode(false);
await a.evaluate(() => window.dispatchEvent(new Event('online')));
await synced(a); await sleep(500);
st = (await api('state', { now: ny('2026-10-16') })).data;
ok(st.kids.find((k) => k.name === 'Kid 3').items.find((i) => i.title === 'Get dressed').done, 'queued check-off syncs to the server when back online');

// ============ 7. weekly streak bonus (API) ============
console.log('\n7. Weekly streak bonus');
const before = (await api('state', { now: ny('2026-10-19') })).data.kids[1].balance;
let lastCele = null;
for (let i = 0; i < 7; i++) {
  const day = `2026-10-${19 + i}`;
  const s = (await api('state', { now: ny(day) })).data;
  for (const it of s.kids[1].items.filter((x) => !x.done)) {
    const rr = await api('check', { method: 'POST', now: ny(day), body: { kidId: 2, choreId: it.choreId, period: it.period, day } });
    if (rr.data.celebrate?.weekly) lastCele = { day, ...rr.data.celebrate };
  }
}
const after = (await api('state', { now: ny('2026-10-25') })).data.kids[1];
ok(lastCele && lastCele.day === '2026-10-25' && after.weeklyBonus, 'all-done Mon–Sun awards the weekly streak bonus on Sunday');
ok(after.balance.minutes - before.minutes === 7 * 25 + 10 + 7 * 10 + 30 && after.balance.cents - before.cents === 100 + 200, 'week math: 7×25 daily + 10 laundry + 7×10 daily bonus + 30 streak min; $1 + $2');

console.log('\n7b. Uncheck rules (API)');
const unc = (body, now, key) => api('uncheck', { method: 'POST', now, body, key });
ok((await unc({ kidId: 2, choreId: 1, period: '2026-10-19' }, ny('2026-10-19'), 'x'.repeat(32))).status === 401, 'uncheck needs the family key');
ok((await unc({ kidId: 2, choreId: 1, period: '2026-10-24' }, ny('2026-10-25'))).status === 403, "kids can't uncheck yesterday's daily chore (403, parent mode only)");
ok((await unc({ kidId: 2, choreId: 7, period: '2026-10-12' }, ny('2026-10-19'))).status === 403, "kids can't uncheck last week's weekly chore");
let u = await unc({ kidId: 2, choreId: 1, period: '2026-10-25' }, ny('2026-10-26'));
ok(u.status === 403, 'after midnight, the day before is locked for kids');
const sunBefore = (await api('state', { now: ny('2026-10-25') })).data.kids[1].balance;
u = await unc({ kidId: 2, choreId: 1, period: '2026-10-25' }, ny('2026-10-25'));
const sunAfter = u.data.state.kids[1].balance;
ok(u.status === 200 && u.data.removed && sunBefore.minutes - sunAfter.minutes === 5 + 10 + 30 && sunBefore.cents - sunAfter.cents === 200, "unchecking Sunday's chore takes back 5 min + the day bonus + the week streak bonus (30 min, $2)");
u = await unc({ kidId: 2, choreId: 1, period: '2026-10-25' }, ny('2026-10-25'));
ok(u.status === 200 && u.data.removed === false && u.data.state.kids[1].balance.minutes === sunAfter.minutes, 'unchecking again is a harmless no-op');
let rc = await api('check', { method: 'POST', now: ny('2026-10-25'), body: { kidId: 2, choreId: 1, period: '2026-10-25', day: '2026-10-25' } });
ok(rc.data.state.kids[1].balance.minutes === sunBefore.minutes && rc.data.state.kids[1].balance.cents === sunBefore.cents && rc.data.celebrate.weekly, 're-check restores exactly the same balance (net zero) incl. streak');
u = await unc({ kidId: 2, choreId: 7, period: '2026-10-19' }, ny('2026-10-25'));
ok(u.status === 200 && u.data.removed, 'weekly chore checked earlier this week can be unchecked (API allows the current week)');
await api('check', { method: 'POST', now: ny('2026-10-19'), body: { kidId: 2, choreId: 7, period: '2026-10-19', day: '2026-10-19' } });

// concurrent check/uncheck race on the last chore of a day must not leave a stray bonus
const SAT = '2026-10-17';
const pre = (await api('state', { now: ny(SAT) })).data.kids[1];
for (const it of pre.items.filter((x) => !x.done && x.title !== 'Pick up toys')) await api('check', { method: 'POST', now: ny(SAT), body: { kidId: 2, choreId: it.choreId, period: it.period, day: SAT } });
const toys = pre.items.find((x) => x.title === 'Pick up toys');
const body = { kidId: 2, choreId: toys.choreId, period: toys.period, day: SAT };
await Promise.all(Array.from({ length: 12 }, (_, i) => api(i % 2 ? 'uncheck' : 'check', { method: 'POST', now: ny(SAT), body })));
let mid = (await api('state', { now: ny(SAT) })).data.kids[1];
const sb = sqlJson(`SELECT count(*) AS n FROM bonuses WHERE kid_id = 2 AND kind = 'daily' AND period = '${SAT}'`)[0].n;
ok(sb === (mid.allDone ? 1 : 0), `after 12 concurrent check/uncheck calls the bonus matches the chores (allDone=${mid.allDone}, bonus rows=${sb})`);
for (const it of mid.items.filter((x) => x.done)) await unc({ kidId: 2, choreId: it.choreId, period: it.period }, ny(SAT));
const post = (await api('state', { now: ny(SAT) })).data.kids[1];
ok(post.balance.minutes === pre.balance.minutes && post.balance.cents === pre.balance.cents, 'unchecking everything after the race returns the exact starting balance');

// ============ 8. other layouts ============
console.log('\n8. Landscape iPad and phone');
await a.setViewport(IPAD_L);
await open(a, ny('2026-10-16'));
await pickKid(a, 'Alex');
await shot(a, '20-ipad-landscape.png');
const ph = await newPage(ctxB, PHONE);
await open(ph, ny('2026-10-16'));
await pickKid(ph, 'Kid 3');
await shot(ph, '21-phone-kid.png');
const phSmall = await ph.evaluate(() => [...document.querySelectorAll('#app button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 64 || r.height < 64).length);
ok(phSmall === 0, 'phone: every kid-view button is at least 64x64 px');
await pinLogin(ph, PIN); await ph.waitForSelector('.tabs');
await ph.tap('[data-tab="history"]'); await sleep(900);
await shot(ph, '22-phone-history.png');
await ph.tap('[data-tab="rewards"]'); await sleep(300);
await shot(ph, '23-phone-rewards.png');

// ============ 9. security + PWA ============
console.log('\n9. Security and PWA');
ok((await api('state', { key: 'x'.repeat(32) })).status === 401, 'API rejects a wrong family key');
ok((await api('parent/kids', { method: 'POST', body: { name: 'x', avatar: '🦈' } })).status === 401, 'parent routes need a PIN session');
const man = await (await fetch(`${BASE}/manifest.webmanifest?k=${KEY}`)).json();
ok(man.display === 'standalone' && man.start_url === `/?k=${KEY}` && man.icons.length >= 3, 'manifest: standalone, start_url carries the family key, icons');
const html = await (await fetch(`${BASE}/`)).text();
ok(html.includes('apple-mobile-web-app-capable') && html.includes('apple-touch-icon') && html.includes('theme-color'), 'iOS meta tags present');
ok((await fetch(`${BASE}/theme/icons/apple-touch-icon.png`)).ok && (await fetch(`${BASE}/sw.js`)).ok, 'apple-touch-icon and sw.js served');
ok(foreign.length === 0, `no requests to any other origin (${foreign.length})`);
// ---- device setup with the parent PIN (fresh context, bare URL) ----
const gate = await newPage(await browser.createBrowserContext(), IPAD);
await gate.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await gate.waitForSelector('.pin.setup');
const padSizes = await gate.$$eval('[data-unlock]', (bs) => bs.map((b) => b.getBoundingClientRect()).filter((r) => r.width >= 64 && r.height >= 64).length);
ok(padSizes === 11 && !(await gate.$('.pin.setup input')), 'bare URL: setup screen with big PIN buttons (no keyboard field)');
ok((await gate.$eval('.linkish', (e) => e.textContent)).includes('Paste'), 'paste-the-link option is there as a small secondary link');
await shot(gate, '24-setup-pin.png');
for (const d of wrong) { await gate.tap(`[data-unlock="${d}"]`); await sleep(50); }
await gate.waitForFunction(() => document.querySelector('.pin.setup .err')?.textContent === 'Wrong PIN', { timeout: 5000 }).then(() => ok(true, 'setup: wrong PIN rejected')).catch(() => ok(false, 'setup: wrong PIN rejected'));
for (const d of PIN) { await gate.tap(`[data-unlock="${d}"]`); await sleep(50); }
await gate.waitForSelector('.chore', { timeout: 10000 }).then(() => ok(true, 'setup: correct PIN unlocks the device and loads chores')).catch(() => ok(false, 'setup: correct PIN unlocks'));
const gs = await gate.evaluate(() => ({ ls: localStorage.getItem('chores.key'), url: location.search, man: document.getElementById('manifest-link').getAttribute('href') }));
ok(gs.ls === KEY && gs.url.includes(`k=${KEY}`) && gs.man === `/manifest.webmanifest?k=${KEY}`, 'family key saved to localStorage, put in the address bar and the manifest link');
await shot(gate, '25-setup-unlocked.png');
await gate.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await gate.waitForSelector('.chore', { timeout: 10000 });
ok((await gate.evaluate(() => location.search)).includes(`k=${KEY}`), 'reopening the bare URL restores ?k in the address bar (so Add to Home Screen keeps it)');
const bad = await newPage(await browser.createBrowserContext(), IPAD);
await bad.goto(`${BASE}/?k=${'Z'.repeat(32)}`, { waitUntil: 'networkidle0' });
await bad.waitForSelector('.pin.setup', { timeout: 8000 }).then(() => ok(true, 'a wrong family key falls back to the PIN setup screen')).catch(() => ok(false, 'wrong key -> setup screen'));
let codes = [];
for (let i = 0; i < 6; i++) codes.push((await api('parent/login', { method: 'POST', body: { pin: wrong } })).status);
ok(codes.slice(0, 5).every((c) => c === 403) && codes[5] === 429, 'PIN lockout after 5 wrong tries (5 minutes)');
ok((await api('unlock', { method: 'POST', key: '', body: { pin: PIN } })).status === 429, 'device unlock shares the same lockout (even the right PIN waits)');
wr('--command', "DELETE FROM settings WHERE k IN ('pin_fails','pin_lock_until','pin_fail_total')");
ok(errors.length === 0, `no page JS errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
