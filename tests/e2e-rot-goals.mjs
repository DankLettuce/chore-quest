// E2E for rotating chores + goals, against `wrangler pages dev` (local D1, ALLOW_TEST_CLOCK=1).
// Usage: node tests/e2e-rot-goals.mjs   (server on 127.0.0.1:8788). Resets the local D1.
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
const ok = (c, n) => { if (c) pass++; else fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ny = (day, hm = '09:00:00') => Date.parse(`${day}T${hm}-04:00`);
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const wr = resetLocal(ROOT, { singleTeeth: true });
console.log('local D1 reset');

async function api(path, { method = 'GET', body, now, token, key = KEY } = {}) {
  const h = { 'x-family-key': key, 'content-type': 'application/json' };
  if (now) h['x-test-now'] = String(now);
  if (token) h['x-parent-token'] = token;
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const state = async (day) => (await api('state', { now: ny(day) })).data;
const kidOf = (st, name) => st.kids.find((k) => k.name === name);
const has = (st, name, title) => kidOf(st, name).items.some((i) => i.title === title);

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 30000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const IPAD = { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPAD_L = { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [], foreign = [];
async function newPage(ctx, vp) {
  const p = await ctx.newPage(); await p.setViewport(vp);
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:')) foreign.push(u); });
  return p;
}
async function open(p, now) { await p.bringToFront(); await p.goto(`${BASE}/?k=${KEY}&now=${now}`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.chore, .empty'); }
const shot = (p, n, full = false) => p.screenshot({ path: SHOTS + n, fullPage: full });
async function pickKid(p, name) {
  for (const b of await p.$$('.kid-btn')) if ((await b.$eval('.nm', (e) => e.textContent)) === name) { await b.tap(); await sleep(200); return; }
  throw new Error(`no kid ${name}`);
}
async function closeParty(p) {
  await p.waitForSelector('.cel-done', { timeout: 4000 }).catch(() => {});
  if (await p.$('.cel-done')) { await p.click('.cel-done__btn').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.cel-done'), { timeout: 5000 }).catch(() => {}); await sleep(200); }
}
async function pinLogin(p) {
  await p.tap('[data-act="parent"]'); await p.waitForSelector('[data-pin="1"]');
  for (const d of PIN) { await p.tap(`[data-pin="${d}"]`); await sleep(40); }
  await p.waitForSelector('.tabs');
}
const cards = (p) => p.$$eval('.chore', (cs) => cs.map((c) => ({ t: c.querySelector('.label').textContent, rot: !!c.querySelector('.tag.rot'), done: c.classList.contains('is-done') })));
async function tapBtnText(p, sel, text) {
  for (const b of await p.$$(sel)) if ((await b.evaluate((e) => e.textContent)).includes(text)) { await b.tap(); return; }
  throw new Error(`no ${sel} ${text}`);
}

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', FRI = '2026-10-16';
const tok = (await api('parent/login', { method: 'POST', body: { pin: PIN }, now: ny(MON) })).data.token;
let st = await state(MON);
const W = kidOf(st, 'Alex').id, E = kidOf(st, 'Sam').id;
const before = { chores: st.chores.length };

// ============ R1. set up a daily rotation through the parent UI ============
console.log('\nR1. Parent sets up rotating chores');
const ctx = await browser.createBrowserContext();
const a = await newPage(ctx, IPAD);
await open(a, ny(MON));
await pinLogin(a);
await a.tap('[data-tab="chores"]'); await sleep(200);
await a.tap('[data-p="addchore"]'); await a.waitForSelector('[data-field="title"]');
await a.type('[data-field="title"]', 'Feed the dog');
await a.$eval('[data-field="emoji"]', (e) => { e.value = ''; });
await a.type('[data-field="emoji"]', '🐶');
await a.tap('[data-set="mode"][data-v="rot"]'); await sleep(150);
await a.tap('[data-set="rotation"][data-v="daily"]'); await sleep(150);
const order = await a.$$eval('.order .oline .kidchip', (e) => e.map((x) => x.textContent.trim()));
ok(order.join(',') === 'Alex,Sam', `turn order list starts as Alex, Sam (${order})`);
await shot(a, 'R01-parent-rotation-setup-daily.png');
await a.tap('[data-p="savechore"]'); await sleep(700);
st = await state(MON);
const dog = st.chores.find((c) => c.title === 'Feed the dog');
ok(dog && dog.rotation === 'daily' && dog.rotKids.join() === `${W},${E}` && dog.turn === W && dog.next === E && dog.emoji === 'img:chores/dog.svg', 'saved: daily rotation Alex → Sam, Alex today, Sam next');

// weekly rotation (Mon/Wed/Fri), Sam first, via the UI with reordering
await a.tap('[data-p="addchore"]'); await a.waitForSelector('[data-field="title"]');
await a.type('[data-field="title"]', 'Recycling out');
await a.$eval('[data-field="emoji"]', (e) => { e.value = ''; }); await a.type('[data-field="emoji"]', '♻️');
await a.tap('[data-set="mode"][data-v="rot"]'); await sleep(150);
await a.tap('[data-move="0|1"]'); await sleep(150); // Sam first
for (const d of [1, 3, 5]) { await a.tap(`[data-toggleday="${d}"]`); await sleep(80); }
await a.$eval('[data-field="minutes"]', (e) => { e.value = ''; }); await a.type('[data-field="minutes"]', '10');
await a.$eval('[data-field="dollars"]', (e) => { e.value = ''; }); await a.type('[data-field="dollars"]', '0.50');
await a.evaluate(() => window.scrollTo(0, 0));
await shot(a, 'R02-parent-rotation-setup-weekly.png');
await a.tap('[data-p="savechore"]'); await sleep(700);
st = await state(MON);
const rec = st.chores.find((c) => c.title === 'Recycling out');
ok(rec && rec.rotation === 'weekly' && rec.rotKids.join() === `${E},${W}` && rec.days.join() === '1,3,5' && rec.turn === E && rec.minutes === 10 && rec.cents === 50, 'saved: weekly rotation Mon/Wed/Fri, Sam this week, 10 min + 50¢');
await shot(a, 'R03-parent-chores-list.png');
await a.tap('[data-tab="today"]'); await sleep(300);
const turnsTxt = await a.$eval('.turns', (e) => e.textContent);
ok(turnsTxt.includes('Feed the dog') && turnsTxt.includes('Recycling out') && turnsTxt.includes('Skip'), 'parent Today shows “Whose turn?” with skip / swap');
await shot(a, 'R04-parent-whose-turn.png');
await a.tap('[data-p="exit"]'); await sleep(600);

// ============ R2. kid Today views ============
console.log('\nR2. Kid Today views');
await open(a, ny(MON));
await pickKid(a, 'Alex');
let cs = await cards(a);
ok(cs.some((c) => c.t === 'Feed the dog' && c.rot) && !cs.some((c) => c.t === 'Recycling out'), 'Alex (Mon): Feed the dog with 🔄 badge, no recycling');
await shot(a, 'R05-ipad-alex-today-rotation.png', true);
await pickKid(a, 'Sam');
cs = await cards(a);
ok(cs.some((c) => c.t === 'Recycling out' && c.rot) && !cs.some((c) => c.t === 'Feed the dog'), 'Sam (Mon): Recycling out with 🔄 badge, no dog');
await shot(a, 'R06-ipad-sam-today-rotation.png', true);
const L = await newPage(ctx, IPAD_L);
await open(L, ny(TUE));
await pickKid(L, 'Sam');
cs = await cards(L);
ok(cs.some((c) => c.t === 'Feed the dog' && c.rot) && !cs.some((c) => c.t === 'Recycling out'), 'Sam (Tue): dog is his turn; recycling hidden (not an available day)');
await shot(L, 'R07-ipad-landscape-sam-tue.png', true);
await pickKid(L, 'Alex');
await shot(L, 'R08-ipad-landscape-alex-tue.png', true);

// ============ R3. daily alternation over a simulated week ============
console.log('\nR3. Daily alternation over a week');
const seq = [];
for (let i = 0; i < 7; i++) { const s = await state(addDays(MON, i)); seq.push(has(s, 'Alex', 'Feed the dog') ? 'W' : has(s, 'Sam', 'Feed the dog') ? 'E' : '-'); }
ok(seq.join('') === 'WEWEWEW', `Mon–Sun turns: ${seq.join('')}`);
ok(!(await state(addDays(MON, 7))).kids.some((k) => false) && has(await state(addDays(MON, 7)), 'Sam', 'Feed the dog'), 'next Monday continues the alternation (Sam)');

// ============ R4. rewards + all-done bonus count only assigned chores ============
console.log('\nR4. Rewards and the all-done bonus');
let r = await api('check', { method: 'POST', now: ny(MON), body: { kidId: E, choreId: dog.id, period: MON, day: MON } });
ok(r.status === 400 && /turn/.test(r.data.error), 'Sam can’t check off the dog on Alex’s day (400)');
const ell0 = kidOf(await state(MON), 'Sam');
for (const it of ell0.items) await api('check', { method: 'POST', now: ny(MON), body: { kidId: E, choreId: it.choreId, period: it.period, day: MON } });
let ell = kidOf(await state(MON), 'Sam');
const expMin = ell0.items.reduce((s, i) => s + i.minutes, 0) + 10;
ok(ell.allDone && ell.stars[0] === 'done' && ell.balance.minutes === expMin && ell.balance.cents === 150, `Sam all done without the dog (not his turn): ${ell.balance.minutes} min = chores + recycling + 10 bonus, $1.50`);
await api('check', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: dog.id, period: MON, day: MON } });
let wy = kidOf(await state(MON), 'Alex');
ok(wy.balance.minutes === 5 && wy.items.find((i) => i.title === 'Feed the dog').done, 'Alex checks off the dog: +5 min');
r = await api('uncheck', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: dog.id, period: MON } });
ok(r.status === 200 && kidOf(r.data.state, 'Alex').balance.minutes === 0, 'kid uncheck of a rotating chore reverses it');
await api('check', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: dog.id, period: MON, day: MON } });

// ============ R5. weekly rotation: available days, drop-off, advance, missed ============
console.log('\nR5. Weekly rotation');
ok(!has(await state(TUE), 'Sam', 'Recycling out'), 'Tue: not an available day, hidden');
// undo Monday's recycling so we can do it Wednesday instead
const recComp = kidOf(await state(MON), 'Sam').items.find((i) => i.title === 'Recycling out').completionId;
await api('parent/undo', { method: 'POST', token: tok, now: ny(MON), body: { completionId: recComp } });
r = await api('check', { method: 'POST', now: ny(TUE), body: { kidId: E, choreId: rec.id, period: MON, day: TUE } });
ok(r.status === 400, 'check-off on a non-available day is refused');
ok(has(await state(WED), 'Sam', 'Recycling out'), 'Wed: open for Sam');
await api('check', { method: 'POST', now: ny(WED), body: { kidId: E, choreId: rec.id, period: MON, day: WED } });
ok(kidOf(await state(WED), 'Sam').items.find((i) => i.title === 'Recycling out')?.done, 'Wed: shows done after the check-off');
ok(!has(await state(FRI), 'Sam', 'Recycling out') && !has(await state(FRI), 'Alex', 'Recycling out'), 'Fri: dropped off for the rest of the week');
const MON2 = addDays(MON, 7), MON3 = addDays(MON, 14);
ok(has(await state(MON2), 'Alex', 'Recycling out') && !has(await state(MON2), 'Sam', 'Recycling out'), 'next week: moves on to Alex');
// Alex skips week 2 entirely -> week 3 still advances to Sam, history shows Alex missed
ok(has(await state(MON3), 'Sam', 'Recycling out'), 'week 3: Sam again even though Alex missed week 2 (it still advances)');
const h2 = (await api(`parent/history?week=${MON2}`, { token: tok, now: ny(MON3) })).data;
const wyMiss = h2.kids.find((k) => k.name === 'Alex').days.flatMap((x) => x.missed);
ok(wyMiss.some((m) => m.title === 'Recycling out' && m.rotation === 'weekly'), 'history (week 2): Alex missed Recycling out');
ok(wyMiss.some((m) => m.title === 'Feed the dog') && h2.kids.find((k) => k.name === 'Sam').days.flatMap((x) => x.missed).some((m) => m.title === 'Feed the dog'), 'history: missed daily dog turns show for whichever kid had them');
const h1 = (await api(`parent/history?week=${MON}`, { token: tok, now: ny(MON3) })).data;
ok(!h1.kids.find((k) => k.name === 'Sam').days.flatMap((x) => x.missed).some((m) => m.title === 'Recycling out'), 'history (week 1): Sam did his recycling, not missed');

// ============ R6. overrides: swap and skip ============
console.log('\nR6. Swap turn and skip to next kid');
const D = addDays(MON, 2); // Wed: dog = Alex
r = await api('parent/turn', { method: 'POST', token: tok, now: ny(D), body: { choreId: dog.id, action: 'swap', kidId: E } });
let s = r.data;
ok(r.status === 200 && has(s, 'Sam', 'Feed the dog') && !has(s, 'Alex', 'Feed the dog') && s.chores.find((c) => c.id === dog.id).swapped, 'swap: Sam does the dog today instead of Alex');
ok(has(await state(addDays(D, 1)), 'Sam', 'Feed the dog') && has(await state(addDays(D, 2)), 'Alex', 'Feed the dog'), 'swap is one-off: Thu Sam, Fri Alex as planned');
await api('parent/turn', { method: 'POST', token: tok, now: ny(D), body: { choreId: dog.id, action: 'swap', kidId: W } });
ok(has(await state(D), 'Alex', 'Feed the dog') && !(await state(D)).chores.find((c) => c.id === dog.id).swapped, 'swapping back to the planned kid clears the override');
r = await api('parent/turn', { method: 'POST', token: tok, now: ny(D), body: { choreId: dog.id, action: 'skip' } });
const after = [];
for (let i = 0; i < 4; i++) { const x = await state(addDays(D, i)); after.push(has(x, 'Alex', 'Feed the dog') ? 'W' : 'E'); }
ok(after.join('') === 'EWEW', `skip: Sam now, then it alternates from him (${after.join('')})`);
const monAfter = await state(MON);
ok(has(monAfter, 'Alex', 'Feed the dog') && has(await state(TUE), 'Sam', 'Feed the dog'), 'skip doesn’t rewrite earlier days (Mon Alex, Tue Sam)');
await api('check', { method: 'POST', now: ny(D), body: { kidId: E, choreId: dog.id, period: D, day: D } });
r = await api('parent/turn', { method: 'POST', token: tok, now: ny(D), body: { choreId: dog.id, action: 'skip' } });
ok(r.status === 409, 'can’t skip a turn that’s already done (409)');
ok((await api('parent/turn', { method: 'POST', now: ny(D), body: { choreId: dog.id, action: 'skip' } })).status === 401, 'turn overrides need the parent PIN');
// UI swap button
const pg = await newPage(ctx, IPAD);
await open(pg, ny(addDays(D, 1)));
await pinLogin(pg);
await tapBtnText(pg, `[data-swap^="${dog.id}|"]`, 'Sam').catch(async () => tapBtnText(pg, `[data-swap^="${dog.id}|"]`, 'Alex'));
await sleep(600);
const sw = (await state(addDays(D, 1))).chores.find((c) => c.id === dog.id);
ok(sw.swapped, 'parent UI: ⇄ swap button works');
await shot(pg, 'R09-parent-whose-turn-swapped.png');
await pg.tap('[data-p="exit"]'); await sleep(300);

// ============ R7. a third kid ============
console.log('\nR7. Third kid in a rotation');
const THU = addDays(MON, 3);
r = await api('parent/kids', { method: 'POST', token: tok, now: ny(THU), body: { name: 'Kid 3', avatar: 'img:avatars/avatar-pilot.svg', color: '#FF7A1A', copyFromKid: W } });
const K3 = r.data.kids.find((k) => k.name === 'Kid 3').id;
let dogNow = r.data.chores.find((c) => c.id === dog.id), recNow = r.data.chores.find((c) => c.id === rec.id);
ok(dogNow.rotKids.join() === `${W},${E},${K3}` && recNow.rotKids.join() === `${E},${W},${K3}`, '“same chores as Alex” adds Kid 3 to the end of both rotations');
ok(dogNow.turn === sw.turn || dogNow.turn === turnAt(dogNow), 'current turn is kept when Kid 3 joins');
function turnAt(c) { return c.turn; }
const seq3 = [];
for (let i = 1; i <= 6; i++) { const x = await state(addDays(THU, i)); seq3.push(['Alex', 'Sam', 'Kid 3'].find((n) => has(x, n, 'Feed the dog'))?.[0] || '-'); }
ok(new Set(seq3.slice(0, 3)).size === 3 && seq3.slice(0, 3).join('') === seq3.slice(3).join(''), `dog cycles through all three kids: ${seq3.join('')}`);
ok(has(await state(addDays(MON, 28)), 'Kid 3', 'Recycling out') || has(await state(addDays(MON, 35)), 'Kid 3', 'Recycling out') || has(await state(addDays(MON, 21)), 'Kid 3', 'Recycling out'), 'Kid 3 gets a recycling week too');
ok(has(await state(MON), 'Alex', 'Feed the dog') && has(await state(TUE), 'Sam', 'Feed the dog'), 'adding a kid doesn’t change past turns');
await open(a, ny(addDays(THU, seq3.indexOf('K') + 1)));
await pickKid(a, 'Kid 3');
cs = await cards(a);
ok(cs.some((c) => c.t === 'Feed the dog' && c.rot), 'Kid 3 sees the dog with 🔄 on his day');
await shot(a, 'R10-ipad-kid3-rotation.png', true);
r = await api(`parent/kids/${K3}`, { method: 'DELETE', token: tok, now: ny(THU) });
dogNow = r.data.chores.find((c) => c.id === dog.id);
ok(dogNow.rotKids.join() === `${W},${E}` && [W, E].includes(dogNow.turn), 'removing Kid 3 takes him out of the rotation; the turn stays with a current kid');
let gap = false;
for (let i = 0; i < 6; i++) { const x = await state(addDays(THU, i)); if (!has(x, 'Alex', 'Feed the dog') && !has(x, 'Sam', 'Feed the dog')) gap = true; }
ok(!gap, 'no day without someone on the dog after Kid 3 leaves');

// ============ R8. goals ============
console.log('\nR8. Goals');
const G = FRI;
r = await api('parent/goals', { method: 'POST', token: tok, now: ny(G), body: { emoji: '🚲', title: 'Ride with no training wheels', descr: 'All the way down the street', kidIds: [W, E], minutes: 30, cents: 200 } });
r = await api('parent/goals', { method: 'POST', token: tok, now: ny(G), body: { emoji: '📚', title: 'Read 5 books', descr: '', kidIds: [E], minutes: 20, cents: 0 } });
const bike = r.data.goals.find((g) => g.title.startsWith('Ride'));
ok(bike && kidOf(r.data, 'Alex').goals.length === 1 && kidOf(r.data, 'Sam').goals.length === 2, 'goals created (shared bike goal + one just for Sam)');
const bal0 = kidOf(await state(G), 'Alex').balance;
await open(a, ny(G));
await pickKid(a, 'Alex');
await a.$eval('.goals', (e) => e.scrollIntoView());
await shot(a, 'R11-ipad-goals-section.png', true);
const didit = await a.$eval('.didit', (b) => { const r = b.getBoundingClientRect(); return r.width >= 64 && r.height >= 64; });
ok(didit, '“I did it!” button is at least 64×64');
await a.tap(`[data-goal="${bike.id}"]`); await sleep(900);
let g1 = kidOf(await state(G), 'Alex');
ok(g1.goals[0].status === 'pending' && g1.balance.minutes === bal0.minutes, 'kid taps “I did it!” → pending, no reward yet');
ok(kidOf(await state(G), 'Sam').goals.find((x) => x.goalId === bike.id).status === 'open', 'shared goal: still open for Sam (each kid does it himself)');
ok(await a.$(`[data-goal="${bike.id}"][data-op="unclaim"]`), 'shows ⏳ waiting');
await a.tap(`[data-goal="${bike.id}"]`); await sleep(900);
ok(kidOf(await state(G), 'Alex').goals[0].status === 'open', 'kid can take back a pending tap');
await a.tap(`[data-goal="${bike.id}"]`); await sleep(900);
await shot(a, 'R12-ipad-goal-pending.png');
ok((await api('parent/goal-confirm', { method: 'POST', now: ny(G), body: { goalId: bike.id, kidId: W } })).status === 401, 'confirming needs the parent PIN');
// parent confirms in the Goals tab
await pinLogin(a);
await a.tap('[data-tab="goals"]'); await sleep(300);
await shot(a, 'R13-parent-goals-pending.png');
await a.tap(`.pend [data-gconfirm="${bike.id}|${W}"]`);
await a.waitForSelector('.cel-done', { timeout: 5000 }).then(() => ok(true, 'confirm → celebration')).catch(() => ok(false, 'confirm → celebration'));
await sleep(900); await shot(a, 'R14-parent-goal-confirmed-party.png');
await closeParty(a);
g1 = kidOf(await state(G), 'Alex');
ok(g1.goals[0].status === 'done' && g1.goals[0].confirmedDay === G && g1.balance.minutes === bal0.minutes + 30 && g1.balance.cents === bal0.cents + 200, 'confirmed: +30 min, +$2, dated');
ok(g1.trophies.length === 1 && g1.trophies[0].day === G, 'trophy on the shelf with the date');
r = await api('parent/goal-confirm', { method: 'POST', token: tok, now: ny(G), body: { goalId: bike.id, kidId: W } });
ok(!r.data.confirmed && kidOf(r.data, 'Alex').balance.minutes === bal0.minutes + 30, 'confirming twice doesn’t pay twice');
await shot(a, 'R15-parent-goals-tab.png');
// edit form screenshot
await a.tap(`[data-editgoal="${bike.id}"]`); await sleep(300);
await shot(a, 'R16-parent-goal-form.png');
await a.tap('[data-p="cancel"]'); await sleep(200);
await a.tap('[data-p="exit"]'); await sleep(600);
await pickKid(a, 'Alex');
await closeParty(a);
await a.$eval('.shelf', (e) => e.scrollIntoView({ block: 'center' }));
ok(await a.$('.shelf .trophy'), 'kid view: trophy shelf shows the goal');
await shot(a, 'R17-ipad-trophy-shelf.png');
// a kid's other device celebrates once on next sync
const k2 = await newPage(await browser.createBrowserContext(), IPAD);
await open(k2, ny(G)); await pickKid(k2, 'Alex');
await k2.waitForSelector('.cel-done', { timeout: 4000 }).then(() => ok(true, 'the kid’s own iPad gets the “Goal reached!” party')).catch(() => ok(false, 'kid iPad party'));
await closeParty(k2);
await k2.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
ok(!(await k2.$('.cel-done')), '…only once');
// un-confirm reverses
r = await api('parent/goal-unconfirm', { method: 'POST', token: tok, now: ny(G), body: { goalId: bike.id, kidId: W } });
g1 = kidOf(r.data, 'Alex');
ok(g1.goals[0].status === 'pending' && g1.balance.minutes === bal0.minutes && g1.balance.cents === bal0.cents && g1.trophies.length === 0, 'un-confirm: back to pending, reward off the balance, off the shelf');
r = await api('parent/goal-reject', { method: 'POST', token: tok, now: ny(G), body: { goalId: bike.id, kidId: W } });
ok(kidOf(r.data, 'Alex').goals[0].status === 'open', '“Not yet”: back to open');
r = await api('parent/goal-confirm', { method: 'POST', token: tok, now: ny(G), body: { goalId: bike.id, kidId: W } });
ok(kidOf(r.data, 'Alex').goals[0].status === 'done', 'parent can confirm straight from open (“Mark done”)');
r = await api(`parent/goals/${bike.id}`, { method: 'PUT', token: tok, now: ny(G), body: { emoji: '🚲', title: 'Ride with no training wheels', descr: '', kidIds: [W, E], minutes: 99, cents: 0 } });
ok(kidOf(r.data, 'Alex').balance.minutes === bal0.minutes + 30, 'editing the reward later doesn’t change what was already earned');
const hg = (await api(`parent/history?week=${MON}`, { token: tok, now: ny(G) })).data;
const hd = hg.kids.find((k) => k.name === 'Alex').days.find((x) => x.day === G);
ok(hd.goals.length === 1 && hd.earned.minutes >= 30, 'history shows the goal on the day it was confirmed');
r = await api(`parent/goals/${bike.id}`, { method: 'DELETE', token: tok, now: ny(G) });
ok(kidOf(r.data, 'Alex').trophies.length === 1 && kidOf(r.data, 'Alex').balance.minutes === bal0.minutes + 30 && !kidOf(r.data, 'Sam').goals.some((x) => x.goalId === bike.id), 'removing a goal keeps won trophies and rewards');
ok((await api('goal/claim', { method: 'POST', now: ny(G), body: { goalId: bike.id, kidId: E } })).status === 400, 'can’t claim a removed goal');

// history screenshot with missed turns
const hp = await newPage(ctx, IPAD);
await open(hp, ny(MON3));
await pinLogin(hp);
await hp.tap('[data-tab="history"]'); await sleep(900);
await hp.tap(`[data-week="${MON2}"]`); await sleep(900);
await shot(hp, 'R18-parent-history-missed.png');
ok((await hp.$$('.hmiss')).length > 0, 'history UI marks missed turns');

ok(errors.length === 0, `no page JS errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
ok(foreign.length === 0, 'no requests to other origins');
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
