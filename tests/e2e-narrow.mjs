// Narrow-screen layout audit (iPhone 375 + 390) in WebKit (Playwright) and Chrome. Every page and state:
// document scrollWidth <= viewport and no visible element's right edge past the viewport.
// Local: seeds via tests/e2e-icons.mjs state (run that first) — or BASE + LIVE=1 for a read-only live pass.
import { readFileSync, mkdirSync } from 'node:fs';
import { webkit, chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const LIVE = !!process.env.LIVE;
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = ROOT + (LIVE ? 'shots/live-narrow/' : 'shots/narrow/');
mkdirSync(SHOTS, { recursive: true });
import { sec } from './env.mjs';
const KEY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;
const NOW = Date.parse('2026-10-12T09:00:00-04:00');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; if (!c || process.env.V) console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const audit = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth, bad = [];
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox !== 'visible') { const r = a.getBoundingClientRect(); return r.right <= vw + 0.5 ? true : false; } } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('#toast, script, style, .cel-layer, canvas')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > vw + 0.5 && !clipped(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} "${(el.textContent || '').trim().slice(0, 30)}"`);
  }
  return { sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, vw, bad: bad.slice(0, 6) };
});

const engines = [['webkit', webkit, {}], ['chrome', chromium, { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }]];
for (const [en, type, opts] of engines) {
  const browser = await type.launch(opts);
  for (const w of [375, 390]) {
    const tag = `${en}-${w}`;
    console.log(`\n${tag}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, deviceScaleFactor: 2, isMobile: en === 'chrome' ? true : undefined, hasTouch: true });
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.dismiss());
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const step = async (name, shot = true) => {
      await sleep(350);
      const a = await audit(p);
      ok(a.sw <= a.vw && a.bw <= a.vw && !a.bad.length, `${tag} ${name}: scrollWidth ${a.sw}/${a.vw}${a.bad.length ? ' OVERFLOW ' + a.bad.join(' | ') : ''}`);
      if (shot) await p.screenshot({ path: `${SHOTS}${tag}-${name}.png`, fullPage: false });
    };
    const tapIf = async (sel) => { const h = await p.$(sel); if (h) { await h.scrollIntoViewIfNeeded(); await h.click(); await sleep(250); return true; } return false; };
    const tapText = async (sel, text) => { for (const h of await p.$$(sel)) if ((await h.textContent()).includes(text)) { await h.click(); await sleep(250); return true; } return false; };
    const closeParty = async () => { await p.waitForSelector('.cel-done', { timeout: 2500 }).catch(() => {}); if (await p.$('.cel-done')) { await p.click('.cel-done__btn').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.cel-done'), null, { timeout: 5000 }).catch(() => {}); } };
    await p.goto(`${BASE}/?k=${KEY}${LIVE ? '' : `&now=${NOW}`}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('.chore, .pb-kid, .empty'); await closeParty();
    for (const kid of ['Alex', 'Sam']) {
      await tapText('.kid-btn', kid); await closeParty(); await p.evaluate(() => scrollTo(0, 0));
      await step(`kid-${kid}-today`);
      const g = await p.$('.goals'); if (g) { await g.scrollIntoViewIfNeeded(); await step(`kid-${kid}-goals`); }
      const s = await p.$('.shelf'); if (s) { await s.scrollIntoViewIfNeeded(); await step(`kid-${kid}-trophies`); }
      await p.screenshot({ path: `${SHOTS}${tag}-kid-${kid}-full.png`, fullPage: true });
    }
    await p.evaluate(() => scrollTo(0, 0));
    await p.click('[data-act="parent"]'); await p.waitForSelector('[data-pin="1"]');
    await step('pin-pad');
    for (const d of PIN) { await p.click(`[data-pin="${d}"]`); await sleep(40); }
    await p.waitForSelector('.tabs');
    const tab = async (t) => { await p.click(`[data-tab="${t}"]`); await sleep(400); await p.evaluate(() => document.querySelector('.sheet')?.scrollTo(0, 0)); };
    const deep = async (name) => { await step(name); await p.evaluate(() => { const s = document.querySelector('.sheet'); if (s) s.scrollTo(0, s.scrollHeight); }); await step(name + '-end'); };
    await tab('today'); await deep('parent-today');
    await tab('chores'); await deep('parent-chores');
    if (await tapIf('[data-p="addchore"]')) {
      await step('chore-form-picker');
      await tapIf('[data-set="mode"][data-v="rot"]'); await step('chore-form-rotate', false);
      await tapIf('[data-set="times"][data-v="2"]'); await deep('chore-form-full');
      await tapIf('[data-p="cancel"]');
    }
    await tab('goals'); await deep('parent-goals');
    if (await tapIf('[data-p="addgoal"]')) { await deep('goal-form'); await tapIf('[data-p="cancel"]'); }
    await tab('kids'); await deep('parent-kids');
    if (await tapIf('[data-p="addkid"]')) { await deep('kid-form'); await tapIf('[data-p="cancel"]'); }
    await tab('rewards'); await deep('parent-rewards');
    await tab('history'); await sleep(800); await deep('parent-history');
    await tab('settings'); await deep('parent-settings');
    ok(!errs.length, `${tag} no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
