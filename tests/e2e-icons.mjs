// E2E for the emoji -> Space Explorers SVG swap: picker, badges, legacy emoji rows, custom emoji fallback,
// no leftover chore/goal/badge emoji on any page, every icon image loads. Also takes the review screenshots.
// BASE + LIVE=1 runs it read-only against the live site (no data changes; screenshots only).
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const LIVE = !!process.env.LIVE;
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = ROOT + (LIVE ? 'shots/live-icons/' : 'shots/icons/');
mkdirSync(SHOTS, { recursive: true });
import { sec } from './env.mjs';
const KEY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ny = (day, hm = '09:00:00') => Date.parse(`${day}T${hm}-04:00`);
async function api(path, { method = 'GET', body, now, token } = {}) {
  const h = { 'x-family-key': KEY, 'content-type': 'application/json' };
  if (now && !LIVE) h['x-test-now'] = String(now);
  if (token) h['x-parent-token'] = token;
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const MON = '2026-10-12';
// Emoji that are deliberately kept: parent tab bar + UI chrome (lock, sound, offline, warnings, payout, copy) + typed custom emoji.
const KEPT = ['✅', '🧹', '🏆', '👦', '💰', '📊', '⚙️', '🔒', '🔓', '🔇', '🔊', '📡', '⚠️', '📋', '◀', '▶', '🦖'];
const leftovers = (p) => p.evaluate((kept) => {
  const re = /\p{Extended_Pictographic}/u, out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    if (n.parentElement.closest('.tabs, script, style, [data-pin], #toast')) continue;
    for (const ch of n.textContent.match(/\p{Extended_Pictographic}\uFE0F?/gu) || []) if (!kept.includes(ch) && !kept.includes(ch.replace(/\uFE0F/g, ''))) out.add(ch);
  }
  return [...out];
}, KEPT);
const broken = (p) => p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')));

if (!LIVE) {
  const { resetLocal } = await import('./_db.mjs');
  resetLocal(ROOT); console.log('local D1 reset');
}
const tok = (await api('parent/login', { method: 'POST', body: { pin: PIN }, now: ny(MON) })).data.token;
let st = (await api('state', { now: ny(MON) })).data;
const kid = (n) => st.kids.find((k) => k.name === n);
const W = kid('Alex').id, E = kid('Sam').id;

if (!LIVE) {
  console.log('\nI1. Seed data and legacy emoji rows');
  ok(st.chores.every((c) => c.emoji.startsWith('img:')), 'every starter chore uses an SVG icon (Get dressed, Pack backpack included)');
  // legacy rows exactly as the live DB had them before the remap (with and without FE0F)
  await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: '🐶', title: 'Feed the dog', rotation: 'daily', rotKids: [W, E], minutes: 5 } });
  await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: '🍽', title: 'Set the table', kidIds: [W, E], minutes: 5 } });
  await api('parent/chores', { method: 'POST', token: tok, now: ny(MON), body: { emoji: '🦖', title: 'Dino feed', kidIds: [W], minutes: 0 } });
  for (const [emoji, title, kidIds] of [['🏀', 'Learn to juggle', [W, E]], ['img:chores/climb.svg', 'Headstand 10 s', [W]], ['🚲', 'Ride a bike', [W, E]]])
    await api('parent/goals', { method: 'POST', token: tok, now: ny(MON), body: { emoji, title, descr: '', kidIds, minutes: 10, cents: 0 } });
  st = (await api('state', { now: ny(MON) })).data;
  const g = (t) => st.goals.find((x) => x.title === t).id;
  await api('goal/claim', { method: 'POST', now: ny(MON), body: { goalId: g('Learn to juggle'), kidId: W } });
  await api('goal/claim', { method: 'POST', now: ny(MON), body: { goalId: g('Headstand 10 s'), kidId: W } });
  await api('parent/goal-confirm', { method: 'POST', token: tok, now: ny(MON), body: { goalId: g('Headstand 10 s'), kidId: W } });
  st = (await api('state', { now: ny(MON) })).data;
  const w = st.kids.find((k) => k.id === W);
  for (const it of w.items.filter((i) => !i.times || i.times === 1).slice(0, 2)) await api('check', { method: 'POST', now: ny(MON), body: { kidId: W, choreId: it.choreId, period: it.period, day: MON } });
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 60000, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const VPS = { 'ipad-p': { width: 820, height: 1180 }, 'ipad-l': { width: 1180, height: 820 }, iphone: { width: 390, height: 844 } };
const errors = [];
for (const [vn, vp] of Object.entries(VPS)) {
  console.log(`\n${vn} (${vp.width}x${vp.height})`);
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.dismiss());
  await p.bringToFront();
  await p.goto(`${BASE}/?k=${KEY}${LIVE ? '' : `&now=${ny(MON)}`}`, { waitUntil: 'networkidle0' });
  await p.waitForSelector('.chore, .pb-kid, .empty'); await sleep(400);
  await p.waitForSelector('.cel-done', { timeout: 3000 }).catch(() => {});
  if (await p.$('.cel-done')) { await p.click('.cel-done__btn').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.cel-done'), { timeout: 5000 }).catch(() => {}); }
  const shot = async (n, full = false) => { await sleep(250); await p.screenshot({ path: `${SHOTS}${vn}-${n}.png`, fullPage: full }); };
  const check = async (where) => {
    const l = await leftovers(p), b = await broken(p);
    ok(l.length === 0, `${where}: no leftover chore/goal/badge emoji${l.length ? ` (found ${l.join(' ')})` : ''}`);
    ok(b.length === 0, `${where}: every icon image loads${b.length ? ` (broken ${b.join(', ')})` : ''}`);
  };
  // Kid Today (Alex)
  await check('kid Today (Alex)'); await shot('01-kid-today', true);
  if (!LIVE && vn === 'ipad-p') {
    ok(await p.$('.chore .tag.rot img[src*="badge-rotate"]'), 'rotating chore shows the SVG rotate badge');
    ok(await p.$('.chore .icon img[src$="/chores/dog.svg"]'), 'legacy 🐶 row renders as dog.svg');
    ok(await p.$('.chore .icon img[src$="/chores/set-table.svg"]'), 'legacy 🍽 (no FE0F) renders as set-table.svg');
    ok(await p.evaluate(() => [...document.querySelectorAll('.chore .icon')].some((e) => e.textContent.includes('🦖'))), 'a typed custom emoji (🦖) still shows as emoji');
    ok(await p.$('.chore.is-done .undo-hint img[src*="badge-undo"]'), 'done card undo hint is the SVG badge');
    ok(await p.$('.didit img[src*="badge-i-did-it"]') && await p.$('.didit.wait img[src*="badge-waiting"]'), 'goal buttons use I-did-it / waiting badges');
    ok(await p.$('.shelf img'), 'trophy shelf shows');
    const sz = await p.$eval('.tag.rot img', (i) => i.getBoundingClientRect().width);
    ok(sz >= 24, `rotate badge on Today is legible size (${Math.round(sz)}px)`);
  }
  const gs = await p.$('h2.sec');
  if (gs) { await gs.evaluate((e) => e.scrollIntoView()); await shot('02-kid-goals'); }
  // parent mode
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  await p.tap('[data-act="parent"]'); await p.waitForSelector('[data-pin="1"]');
  for (const d of PIN) { await p.tap(`[data-pin="${d}"]`); await sleep(40); }
  await p.waitForSelector('.tabs'); await sleep(400);
  await check('parent Today'); await shot('03-parent-today-whose-turn');
  if (!LIVE && vn === 'ipad-p') ok(await p.$('.turns h3 img[src*="badge-rotate"]') && await p.$('[data-skip] img[src*="badge-skip"]'), 'Whose turn? card uses rotate + skip badges');
  await p.tap('[data-tab="chores"]'); await sleep(400);
  await check('parent Chores'); await shot('04-parent-chores');
  await p.tap('[data-p="addchore"]'); await sleep(400);
  await check('chore picker'); await shot('05-chore-picker');
  const pick = await p.$$eval('.pick[data-group="emoji"] button', (bs) => ({ n: bs.length, imgs: bs.filter((b) => b.querySelector('img')).length }));
  ok(pick.n >= 35 && pick.imgs === pick.n, `chore picker is all SVGs (${pick.imgs}/${pick.n})`);
  if (!LIVE && vn === 'ipad-p') {
    await p.type('[data-field="emoji"]', '🐶'); await p.type('[data-field="title"]', 'Typed dog');
    await p.tap('[data-p="savechore"]'); await sleep(700);
    const t = (await api('state', { now: ny(MON) })).data.chores.find((c) => c.title === 'Typed dog');
    ok(t && t.emoji === 'img:chores/dog.svg', 'typing a known emoji in the custom field saves the SVG');
  } else { await p.tap('[data-p="cancel"]'); await sleep(300); }
  await p.tap('[data-tab="goals"]'); await sleep(400);
  await check('parent Goals'); await shot('06-parent-goals');
  await p.tap('[data-p="addgoal"]'); await sleep(400);
  const gp = await p.$$eval('.pick button', (bs) => ({ n: bs.length, imgs: bs.filter((b) => b.querySelector('img')).length }));
  ok(gp.n >= 12 && gp.imgs === gp.n, `goal picker is all SVGs (${gp.imgs}/${gp.n})`);
  await shot('07-goal-picker'); await p.tap('[data-p="cancel"]'); await sleep(300);
  await p.tap('[data-tab="history"]'); await sleep(1200);
  await check('parent History'); await shot('08-parent-history');
  await p.close();
}
ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
