// Chore Quest API. Every route needs the family key (X-Family-Key header).
// Kids (key only): GET state, POST check, POST uncheck (same day / same week only),
// POST goal/claim and goal/unclaim ("I did it!" -> pending; only a grown-up confirms).
// Parent routes also need a session token from POST /api/parent/login (X-Parent-Token).
import { nyDate, msToMidnight, isDay, sqlUtcToNyDate } from '../_lib/time.js';
import { sha256Hex, randomHex, hashPin, verifyPin, timingSafeEq, sealKey, openKey } from '../_lib/crypto.js';
import { itemsFor, isAllDone, counted, validPeriod, parseKids, parseDays, weekDays, weekStart, addDays, dow } from '../_lib/logic.js';
import { weekProgress, summarize } from '../_lib/progress.js';
import { isRot, rotPeriod, nextPeriod, turnFor, planTurn, replan, planStartingWith, rotKidsNow, parsePlan, startedBy } from '../_lib/rotation.js';

const SESSION_MS = 2 * 3600 * 1000;
const MAX_FAILS = 5;            // wrong PINs before a lockout
const LOCK_MS = 5 * 60 * 1000;  // first lockout; doubles with each further block of 5 misses (max 24 h)
const MAX_LOCK_MS = 24 * 3600 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };

export async function onRequest(ctx) {
  try {
    return await route(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'server error' }, 500);
  }
}

async function route({ request, env }) {
  const db = env.DB;
  if (!db) throw new HttpError(500, 'D1 binding DB missing');
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method;

  // clock: real time, or an injected test clock when ALLOW_TEST_CLOCK=1 (local dev only)
  let now = Date.now();
  const testNow = request.headers.get('x-test-now');
  if (env.ALLOW_TEST_CLOCK === '1' && testNow && /^\d{10,14}$/.test(testNow)) now = Number(testNow);
  const today = nyDate(now);

  // Optional read-only summary (e.g. for a family dashboard): its own key (env DASHBOARD_READ_KEY), never the family key.
  if (path === 'summary') return summaryRoute(request, env, db, now, today);

  const settings = await loadSettings(db);
  // Device setup without the family link: parent PIN -> family key. No family key needed.
  if (path === 'unlock' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return json(await unlock({ db, settings, now, body }));
  }
  const key = request.headers.get('x-family-key') || url.searchParams.get('k') || '';
  if (!settings.family_key_hash) throw new HttpError(503, 'not set up: family key missing');
  if (!key || !timingSafeEq(await sha256Hex(key), settings.family_key_hash)) throw new HttpError(401, 'bad family key');

  const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
  const c = { db, env, now, today, settings, body, url, key };

  if (path === 'ping') return json({ ok: true, today });
  if (path === 'state' && method === 'GET') return json(await buildState(c));
  if (path === 'progress' && method === 'GET') return json(await progressFor(c, url.searchParams.get('week')));
  if (path === 'check' && method === 'POST') return json(await checkOff(c));
  if (path === 'uncheck' && method === 'POST') return json(await uncheck(c));
  if (path === 'goal/claim' && method === 'POST') return json(await goalClaim(c));
  if (path === 'goal/unclaim' && method === 'POST') return json(await goalUnclaim(c));
  if (path === 'parent/login' && method === 'POST') return json(await login(c));

  if (path.startsWith('parent/')) {
    await requireParent(c, request.headers.get('x-parent-token'));
    const [, res, id] = path.split('/');
    if (res === 'logout' && method === 'POST') { await db.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256Hex(request.headers.get('x-parent-token'))).run(); return json({ ok: true }); }
    if (res === 'kids') return json(await kidsCrud(c, method, id));
    if (res === 'chores') return json(await choresCrud(c, method, id));
    if (res === 'undo' && method === 'POST') return json(await undo(c));
    if (res === 'untick' && method === 'POST') return json(await parentUntick(c));
    if (res === 'turn' && method === 'POST') return json(await turnOverride(c));
    if (res === 'goals') return json(await goalsCrud(c, method, id));
    if (res === 'goal-confirm' && method === 'POST') return json(await goalConfirm(c));
    if (res === 'goal-unconfirm' && method === 'POST') return json(await goalUnconfirm(c));
    if (res === 'goal-reject' && method === 'POST') return json(await goalReject(c));
    if (res === 'payout' && method === 'POST') return json(await payout(c));
    if (res === 'payout' && method === 'DELETE' && id) { await db.prepare('DELETE FROM payouts WHERE id = ?').bind(+id).run(); return json(await buildState(c)); }
    if (res === 'settings' && method === 'PUT') return json(await saveSettings(c));
    if (res === 'pin' && method === 'PUT') return json(await changePin(c));
    if (res === 'history' && method === 'GET') return json(await history(c));
  }
  throw new HttpError(404, 'not found');
}

// ---------- data ----------
async function loadSettings(db) {
  const { results } = await db.prepare('SELECT k, v FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.k, r.v]));
}
const setSetting = (db, k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v));
const int = (v) => Number.parseInt(v, 10) || 0;

async function activeKids(db) {
  return (await db.prepare('SELECT id, name, avatar, color, sort FROM kids WHERE active = 1 ORDER BY sort, id').all()).results;
}
async function activeChores(db) {
  return (await db.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort, id').all()).results;
}
async function weekComps(db, kidId, day) {
  const mon = weekStart(day);
  // pinned/daily periods are dates within the week; any-day periods are the Monday
  return (await db.prepare('SELECT id, chore_id, kid_id, period, day, minutes, cents FROM completions WHERE kid_id = ? AND period >= ? AND period <= ?')
    .bind(kidId, mon, addDays(mon, 6)).all()).results;
}
const isMulti = (ch) => (ch?.times || 1) > 1;
const parseLabels = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map((x) => String(x)) : []; } catch { return []; } };
async function weekTicks(db, kidId, day) {
  const mon = weekStart(day);
  return (await db.prepare('SELECT id, chore_id, kid_id, period, slot, day, minutes, cents FROM repeat_checks WHERE kid_id = ? AND period >= ? AND period <= ?')
    .bind(kidId, mon, addDays(mon, 6)).all()).results;
}
/** Decorate multi-times items with their slots (which repeats are ticked) and progress. */
function withSlots(items, chores, ticks) {
  const byId = new Map(chores.map((ch) => [ch.id, ch]));
  return items.map((it) => {
    const ch = byId.get(it.choreId);
    if (!isMulti(ch)) return it;
    const mine = ticks.filter((t) => t.chore_id === ch.id && t.period === it.period);
    const labels = parseLabels(ch.labels);
    // a check-off from before the chore became multi (no ticks) counts as all repeats
    const legacy = it.done && mine.length === 0;
    const slots = Array.from({ length: ch.times }, (_, i) => ({ slot: i + 1, label: labels[i] || '', done: legacy || mine.some((t) => t.slot === i + 1) }));
    const each = ch.reward_mode !== 'all';
    return { ...it, times: ch.times, rewardMode: each ? 'each' : 'all', slots, progress: { n: slots.filter((x) => x.done).length, of: ch.times },
      // the reward shown is the chore's: per check ('each') or for the whole set ('all')
      minutes: ch.minutes, cents: ch.cents };
  });
}
async function loadOverrides(db) {
  const { results } = await db.prepare('SELECT chore_id, period, kid_id FROM rotation_overrides').all();
  return new Map(results.map((r) => [`${r.chore_id}|${r.period}`, r.kid_id]));
}
async function balances(db) {
  const { results } = await db.prepare(`
    SELECT kid_id, SUM(m) AS minutes, SUM(c) AS cents FROM (
      SELECT kid_id, minutes AS m, cents AS c FROM completions
      UNION ALL SELECT kid_id, minutes, cents FROM bonuses
      UNION ALL SELECT kid_id, -minutes, -cents FROM payouts
    ) GROUP BY kid_id`).all();
  const out = Object.fromEntries(results.map((r) => [r.kid_id, { minutes: r.minutes || 0, cents: r.cents || 0 }]));
  // per-check rewards of multi-times chores
  const t = await db.prepare('SELECT kid_id, SUM(minutes) AS minutes, SUM(cents) AS cents FROM repeat_checks GROUP BY kid_id').all();
  for (const r of t.results) {
    const b = out[r.kid_id] || (out[r.kid_id] = { minutes: 0, cents: 0 });
    b.minutes += r.minutes || 0; b.cents += r.cents || 0;
  }
  // confirmed goals (separate query: D1 caps compound SELECT terms)
  const g = await db.prepare("SELECT kid_id, SUM(minutes) AS minutes, SUM(cents) AS cents FROM goal_claims WHERE status = 'done' GROUP BY kid_id").all();
  for (const r of g.results) {
    const b = out[r.kid_id] || (out[r.kid_id] = { minutes: 0, cents: 0 });
    b.minutes += r.minutes || 0; b.cents += r.cents || 0;
  }
  return out;
}

async function buildState(c) {
  const { db, today, now, settings } = c;
  const [kids, chores, bal, ovr, goals, claims, doneNow, bonusRows] = await Promise.all([
    activeKids(db), activeChores(db), balances(db), loadOverrides(db),
    db.prepare('SELECT * FROM goals WHERE active = 1 ORDER BY sort, id').all().then((r) => r.results),
    db.prepare('SELECT goal_id, kid_id, status, claimed_day, confirmed_day, minutes, cents, emoji, title FROM goal_claims ORDER BY confirmed_day DESC, id DESC').all().then((r) => r.results),
    db.prepare('SELECT DISTINCT chore_id, period FROM completions WHERE period >= ?').bind(weekStart(today)).all().then((r) => new Set(r.results.map((x) => `${x.chore_id}|${x.period}`))),
    db.prepare("SELECT kid_id, kind, period, minutes, cents FROM bonuses WHERE period >= ?").bind(weekStart(today)).all().then((r) => r.results),
  ]);
  const mon = weekStart(today);
  const out = [];
  for (const k of kids) {
    const comps = await weekComps(db, k.id, today);
    const ticks = await weekTicks(db, k.id, today);
    const items = withSlots(itemsFor(k.id, today, chores, comps, ovr), chores, ticks);
    const week = weekProgress(k.id, today, today, chores, comps, ovr, (x) => withSlots(x, chores, ticks));
    const mine = claims.filter((x) => x.kid_id === k.id);
    const allDoneDays = new Set(bonusRows.filter((b) => b.kid_id === k.id && b.kind === 'daily').map((b) => b.period));
    const stars = weekDays(mon).map((d) => (allDoneDays.has(d) ? 'done' : d < today ? 'missed' : d === today ? 'today' : 'future'));
    out.push({
      ...k,
      balance: bal[k.id] || { minutes: 0, cents: 0 },
      items,
      allDone: isAllDone(items),
      stars,
      // daily + weekly progress bars (functions/_lib/progress.js); same definition as the all-done bonus
      progress: { day: { day: today, ...summarize(items) }, week, weekDone: week.filter((d) => d.state === 'done').length },
      weeklyBonus: bonusRows.some((b) => b.kid_id === k.id && b.kind === 'weekly' && b.period === mon),
      goals: goals.filter((g) => parseKids(g.kid_ids).includes(k.id)).map((g) => {
        const cl = mine.find((x) => x.goal_id === g.id);
        return { goalId: g.id, emoji: g.emoji, title: g.title, descr: g.descr, minutes: cl?.status === 'done' ? cl.minutes : g.minutes, cents: cl?.status === 'done' ? cl.cents : g.cents,
          status: cl ? cl.status : 'open', claimedDay: cl?.claimed_day || null, confirmedDay: cl?.confirmed_day || null };
      }),
      // trophy shelf: every confirmed goal, even if the goal was later removed
      trophies: mine.filter((x) => x.status === 'done').map((x) => ({ goalId: x.goal_id, emoji: x.emoji, title: x.title, day: x.confirmed_day, minutes: x.minutes, cents: x.cents })),
    });
  }
  return {
    today, weekStart: mon, dow: dow(today), serverNow: now, msToMidnight: msToMidnight(now),
    kids: out,
    chores: chores.map((ch) => ({ id: ch.id, emoji: ch.emoji, title: ch.title, kidIds: parseKids(ch.kid_ids), schedule: ch.schedule, days: parseDays(ch.days), minutes: ch.minutes, cents: ch.cents,
      rotation: ch.rotation || '', ...(isRot(ch) ? rotInfo(ch, today, ovr, doneNow) : {}),
      times: ch.times || 1, labels: parseLabels(ch.labels), rewardMode: ch.reward_mode === 'all' ? 'all' : 'each' })),
    goals: goals.map((g) => ({ id: g.id, emoji: g.emoji, title: g.title, descr: g.descr, kidIds: parseKids(g.kid_ids), minutes: g.minutes, cents: g.cents,
      claims: claims.filter((x) => x.goal_id === g.id).map((x) => ({ kidId: x.kid_id, status: x.status, claimedDay: x.claimed_day, confirmedDay: x.confirmed_day })) })),
    bonus: {
      dailyMinutes: int(settings.daily_bonus_minutes), dailyCents: int(settings.daily_bonus_cents),
      weeklyMinutes: int(settings.weekly_bonus_minutes), weeklyCents: int(settings.weekly_bonus_cents),
    },
  };
}

// ---------- read-only dashboard summary ----------
// DASHBOARD_ORIGINS: optional comma-separated list of origins allowed to call /api/summary from a browser.
const dashOrigins = (env) => String(env.DASHBOARD_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
function summaryHeaders(request, env) {
  const o = request.headers.get('origin');
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  if (o && dashOrigins(env).includes(o)) {
    Object.assign(h, { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'Authorization', 'access-control-max-age': '600' });
  }
  return h;
}
async function summaryRoute(request, env, db, now, today) {
  const h = summaryHeaders(request, env);
  const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: h });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'read only: GET only' }), { status: 405, headers: { ...h, allow: 'GET, OPTIONS' } });
  const want = env.DASHBOARD_READ_KEY;
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  if (!want || want.length < 32) return out({ error: 'summary not configured' }, 503);
  if (!m || !timingSafeEq(await sha256Hex(m[1]), await sha256Hex(want))) return out({ error: 'unauthorized' }, 401);
  const settings = await loadSettings(db);
  const st = await buildState({ db, env, now, today, settings });
  return out(toSummary(st));
}
/** Explicit allow-list: nothing secret (no PIN, hashes, family key, sessions) can leak by accident. */
function toSummary(st) {
  const goalById = new Map(st.goals.map((g) => [g.id, g]));
  return {
    today: st.today, weekStart: st.weekStart, generatedAt: new Date(st.serverNow).toISOString(),
    kids: st.kids.map((k) => ({
      id: k.id, name: k.name, avatar: k.avatar, color: k.color,
      balance: { minutes: k.balance.minutes, cents: k.balance.cents },
      today: {
        allDone: k.allDone,
        chores: k.items.map((i) => ({ choreId: i.choreId, title: i.title, emoji: i.emoji, schedule: i.schedule, rotation: i.rot || '', done: i.done, counts: i.done || i.countsOpen !== false,
          minutes: i.minutes, cents: i.cents, ...(i.slots ? { repeats: { done: i.progress.n, of: i.progress.of } } : {}) })),
      },
      progress: {
        day: { done: k.progress.day.n, total: k.progress.day.of, allDone: k.progress.day.allDone },
        week: k.progress.week.map((w) => ({ day: w.day, state: w.state, done: w.n, total: w.of })),
        weekDone: k.progress.weekDone, weeklyBonus: !!k.weeklyBonus,
      },
      goals: k.goals.filter((g) => g.status !== 'open').map((g) => ({ goalId: g.goalId, title: g.title, emoji: g.emoji, status: g.status, claimedDay: g.claimedDay, confirmedDay: g.confirmedDay, minutes: g.minutes, cents: g.cents })),
      openGoals: k.goals.filter((g) => g.status === 'open').length,
    })),
    goals: st.goals.map((g) => ({ id: g.id, title: goalById.get(g.id).title, emoji: g.emoji, kidIds: g.kidIds, minutes: g.minutes, cents: g.cents })),
  };
}

/** Parent view of a rotation: whose turn this period is, who's next, and whether it's done. */
function rotInfo(ch, today, ovr, doneNow) {
  const period = rotPeriod(ch, today);
  const turn = turnFor(ch, period, ovr);
  return {
    rotKids: rotKidsNow(ch, period), period, turn, planned: planTurn(ch, period),
    swapped: ovr.has(`${ch.id}|${period}`), done: doneNow.has(`${ch.id}|${period}`), next: turnFor(ch, nextPeriod(ch, period), ovr),
  };
}

// ---------- kids: check off ----------
async function checkOff(c) {
  const { db, today, body, settings } = c;
  const kidId = int(body.kidId), choreId = int(body.choreId);
  const period = String(body.period || '');
  const kid = await db.prepare('SELECT id FROM kids WHERE id = ? AND active = 1').bind(kidId).first();
  const ch = await db.prepare('SELECT * FROM chores WHERE id = ? AND active = 1').bind(choreId).first();
  if (!kid || !ch) bad('unknown kid or chore');
  if (!isDay(period) || !validPeriod(ch, period, today)) bad('bad period');
  if (isRot(ch)) {
    if (turnFor(ch, period, await loadOverrides(db)) !== kidId) bad('not this kid\'s turn');
  } else if (!parseKids(ch.kid_ids).includes(kidId)) bad('chore not assigned to this kid');
  // the day it was done: the client's day (queued offline check-offs), clamped to the last week
  let day = isDay(body.day) && body.day <= today && body.day >= addDays(today, -7) ? body.day : today;
  if (day < period) day = period;
  if (ch.schedule === 'daily') day = period;
  if (ch.rotation === 'weekly') {
    if (day > addDays(period, 6)) day = addDays(period, 6);
    const avail = parseDays(ch.days);
    if (avail.length && !avail.includes(dow(day))) bad('not an available day for this chore');
  }

  if (isMulti(ch)) {
    const res = await addTick(db, ch, kidId, period, body.slot, day, String(body.opId || '').slice(0, 64), settings);
    return { ok: true, ...res, state: await buildState(c) };
  }
  const r = await db.prepare(`INSERT OR IGNORE INTO completions (chore_id, kid_id, period, day, minutes, cents, emoji, title, op_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(choreId, kidId, period, day, ch.minutes, ch.cents, ch.emoji, ch.title, String(body.opId || '').slice(0, 64)).run();
  const already = r.meta.changes === 0;
  const celebrate = already ? null : await awardBonuses(db, kidId, day, settings);
  return { ok: true, already, celebrate, state: await buildState(c) };
}

// ---------- multi-times chores ----------
const tickRows = (db, ch, kidId, period) => db.prepare('SELECT * FROM repeat_checks WHERE chore_id = ? AND kid_id = ? AND period = ? ORDER BY slot')
  .bind(ch.id, kidId, period).all().then((r) => r.results);

/** Tick one repeat (slot 1..times; no slot = the next open one). When all are ticked, the chore is complete. */
async function addTick(db, ch, kidId, period, slot, day, opId, settings) {
  const have = await tickRows(db, ch, kidId, period);
  const comp = await db.prepare('SELECT id FROM completions WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(ch.id, kidId, period).first();
  if (comp && have.length === 0) return { already: true, celebrate: null, slot: null }; // done before it became multi
  let s = int(slot);
  if (!s) { for (let i = 1; i <= ch.times; i++) if (!have.some((t) => t.slot === i)) { s = i; break; } }
  if (!s) return { already: true, celebrate: null, slot: null };
  if (s < 1 || s > ch.times) bad('bad repeat');
  const each = ch.reward_mode !== 'all';
  const r = await db.prepare('INSERT OR IGNORE INTO repeat_checks (chore_id, kid_id, period, slot, day, minutes, cents, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(ch.id, kidId, period, s, day, each ? ch.minutes : 0, each ? ch.cents : 0, opId).run();
  if (!r.meta.changes) return { already: true, celebrate: null, slot: s };
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM repeat_checks WHERE chore_id = ? AND kid_id = ? AND period = ? AND slot <= ?').bind(ch.id, kidId, period, ch.times).first()).n;
  if (n < ch.times) return { already: false, celebrate: null, slot: s, progress: { n, of: ch.times } };
  const ins = await db.prepare(`INSERT OR IGNORE INTO completions (chore_id, kid_id, period, day, minutes, cents, emoji, title, op_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(ch.id, kidId, period, day, each ? 0 : ch.minutes, each ? 0 : ch.cents, ch.emoji, ch.title, opId).run();
  // a racing un-tick could have removed a repeat meanwhile: make sure the set is still complete
  const n2 = (await db.prepare('SELECT COUNT(*) AS n FROM repeat_checks WHERE chore_id = ? AND kid_id = ? AND period = ? AND slot <= ?').bind(ch.id, kidId, period, ch.times).first()).n;
  if (n2 < ch.times) {
    const cr = await db.prepare('SELECT * FROM completions WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(ch.id, kidId, period).first();
    if (cr) await undoCompletion(db, cr);
    return { already: false, celebrate: null, slot: s, progress: { n: n2, of: ch.times } };
  }
  const celebrate = ins.meta.changes ? await awardBonuses(db, kidId, day, settings) : null;
  return { already: false, celebrate, slot: s, progress: { n: ch.times, of: ch.times } };
}

/** Un-tick one repeat; the chore is no longer complete, so its completion (and any bonus) comes back off. */
async function removeTick(db, tick) {
  const r = await db.prepare('DELETE FROM repeat_checks WHERE id = ?').bind(tick.id).run();
  const comp = await db.prepare('SELECT * FROM completions WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(tick.chore_id, tick.kid_id, tick.period).first();
  if (comp) await undoCompletion(db, comp);
  return r.meta.changes > 0;
}
/** Find the tick an un-check means: that slot, or (no slot, older app versions) the last ticked one. */
async function findTick(db, ch, kidId, period, slot) {
  const have = await tickRows(db, ch, kidId, period);
  const s = int(slot);
  return s ? have.find((t) => t.slot === s) : have[have.length - 1];
}
// parent: un-tick any repeat (no time limit), like parent undo
async function parentUntick(c) {
  const { db, body } = c;
  const ch = await db.prepare('SELECT * FROM chores WHERE id = ?').bind(int(body.choreId)).first();
  if (!ch) bad('unknown chore');
  const t = await findTick(db, ch, int(body.kidId), String(body.period || ''), body.slot);
  if (t) await removeTick(db, t);
  else {
    // done before it became multi: undo the whole thing
    const comp = await db.prepare('SELECT * FROM completions WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(ch.id, int(body.kidId), String(body.period || '')).first();
    if (comp) await undoCompletion(db, comp);
  }
  return buildState(c);
}

/** GET /api/progress?week=YYYY-MM-DD (any day of the week; default this week): every kid's 7 slots. */
async function progressFor(c, week) {
  const { db, today } = c;
  const anyDay = isDay(week || '') ? week : today;
  const [kids, chores, ovr] = await Promise.all([activeKids(db), activeChores(db), loadOverrides(db)]);
  const out = [];
  for (const k of kids) {
    const comps = await weekComps(db, k.id, anyDay), ticks = await weekTicks(db, k.id, anyDay);
    const w = weekProgress(k.id, anyDay, today, chores, comps, ovr, (x) => withSlots(x, chores, ticks));
    out.push({ kidId: k.id, name: k.name, week: w, weekDone: w.filter((d) => d.state === 'done').length });
  }
  return { today, weekStart: weekStart(anyDay), kids: out };
}

async function dayAllDone(db, kidId, day, chores, ovr) {
  const items = itemsFor(kidId, day, chores, await weekComps(db, kidId, day), ovr || await loadOverrides(db));
  return isAllDone(items);
}

/** After a check-off on `day`: daily all-done bonus, then the Mon-Sun streak bonus. */
async function awardBonuses(db, kidId, day, settings) {
  const chores = await activeChores(db);
  const ovr = await loadOverrides(db);
  const out = { allDone: false, daily: null, weekly: null };
  if (!(await dayAllDone(db, kidId, day, chores, ovr))) return out;
  out.allDone = true;
  const dm = int(settings.daily_bonus_minutes), dc = int(settings.daily_bonus_cents);
  const r = await db.prepare('INSERT OR IGNORE INTO bonuses (kid_id, kind, period, minutes, cents) VALUES (?, ?, ?, ?, ?)')
    .bind(kidId, 'daily', day, dm, dc).run();
  if (r.meta.changes && (dm || dc)) out.daily = { minutes: dm, cents: dc };

  const wm = int(settings.weekly_bonus_minutes), wc = int(settings.weekly_bonus_cents);
  if (!(wm || wc)) return out;
  const mon = weekStart(day);
  const days = weekDays(mon);
  const have = new Set((await db.prepare("SELECT period FROM bonuses WHERE kid_id = ? AND kind = 'daily' AND period >= ? AND period <= ?")
    .bind(kidId, mon, days[6]).all()).results.map((x) => x.period));
  for (const d of days) {
    if (have.has(d)) continue;
    // a day with no chores at all doesn't break the streak
    const items = itemsFor(kidId, d, chores, await weekComps(db, kidId, d), ovr);
    if (counted(items).length > 0 || d > day) return out;
  }
  const w = await db.prepare('INSERT OR IGNORE INTO bonuses (kid_id, kind, period, minutes, cents) VALUES (?, ?, ?, ?, ?)')
    .bind(kidId, 'weekly', mon, wm, wc).run();
  if (w.meta.changes) out.weekly = { minutes: wm, cents: wc };
  return out;
}

// ---------- parent ----------
/**
 * Checks the parent PIN with a shared lockout (parent mode and device unlock count together):
 * 5 misses -> 5 min, the next 5 -> 10 min, then 20, 40 ... up to 24 h. Success resets it.
 */
async function checkPin(c, pin) {
  const { db, settings, now } = c;
  const lockUntil = int(settings.pin_lock_until);
  if (lockUntil > now) throw new HttpError(429, `locked for ${Math.ceil((lockUntil - now) / 60000)} min`);
  pin = String(pin || '');
  if (/^\d{4}$/.test(pin) && (await verifyPin(pin, settings.pin_hash))) {
    if (int(settings.pin_fail_total) || int(settings.pin_fails)) await db.batch([setSetting(db, 'pin_fails', 0), setSetting(db, 'pin_fail_total', 0)]);
    return pin;
  }
  const total = int(settings.pin_fail_total) + 1;
  const stmts = [setSetting(db, 'pin_fail_total', total), setSetting(db, 'pin_fails', total % MAX_FAILS)];
  let msg = 'wrong PIN';
  if (total % MAX_FAILS === 0) {
    const ms = Math.min(MAX_LOCK_MS, LOCK_MS * 2 ** (total / MAX_FAILS - 1));
    stmts.push(setSetting(db, 'pin_lock_until', now + ms));
    msg = `wrong PIN, locked for ${Math.round(ms / 60000)} minutes`;
  }
  await db.batch(stmts);
  throw new HttpError(403, msg);
}

async function login(c) {
  const { db } = c;
  const pin = await checkPin(c, c.body.pin);
  // keep a PIN-sealed copy of the family key so new devices can be unlocked with the PIN
  if (!c.settings.family_key_enc && c.key) await setSetting(db, 'family_key_enc', await sealKey(c.key, pin)).run();
  const token = randomHex(32);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').bind(await sha256Hex(token), Date.now() + SESSION_MS),
  ]);
  return { token, expiresIn: SESSION_MS };
}

async function unlock(c) {
  const pin = await checkPin(c, c.body.pin);
  const key = await openKey(c.settings.family_key_enc, pin);
  if (!key || !timingSafeEq(await sha256Hex(key), c.settings.family_key_hash)) {
    throw new HttpError(409, 'this device can\'t be set up with the PIN yet: open the family link once on any device and enter grown-up mode');
  }
  return { key };
}

async function requireParent(c, token) {
  if (!token) throw new HttpError(401, 'parent PIN needed');
  const row = await c.db.prepare('SELECT expires_at FROM sessions WHERE token = ?').bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'parent PIN needed');
}

const AVATAR_RE = /^(img:(?!.*\.\.)[a-z0-9._/-]{1,60}|[^<>"'&]{1,16})$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const cleanText = (s, max) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);

async function kidsCrud(c, method, id) {
  const { db, body } = c;
  if (method === 'POST' || method === 'PUT') {
    const name = cleanText(body.name, 24);
    const avatar = String(body.avatar || '');
    const color = COLOR_RE.test(body.color || '') ? body.color : '#19C3C8';
    if (!name) bad('name required');
    if (!AVATAR_RE.test(avatar)) bad('bad avatar');
    if (method === 'POST') {
      const max = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM kids').first();
      const r = await db.prepare('INSERT INTO kids (name, avatar, color, sort) VALUES (?, ?, ?, ?)').bind(name, avatar, color, max.s).run();
      // optional: give the new kid copies of chosen chores
      if (Array.isArray(body.copyChoresFrom) || body.copyFromKid) {
        const from = int(body.copyFromKid);
        const newId = r.meta.last_row_id;
        for (const ch of await activeChores(db)) {
          const ids = parseKids(ch.kid_ids);
          if (from && isRot(ch) && ids.includes(from) && !ids.includes(newId)) {
            // a copied rotation: the new kid joins the end of the turn order
            const period = rotPeriod(ch, c.today);
            const kids = [...rotKidsNow(ch, period), newId];
            await db.prepare('UPDATE chores SET rot_plan = ?, kid_ids = ? WHERE id = ?').bind(JSON.stringify(replan(ch, kids, period)), JSON.stringify(kids), ch.id).run();
            continue;
          }
          if (from && ids.includes(from) && !ids.includes(newId)) {
            await db.prepare('UPDATE chores SET kid_ids = ? WHERE id = ?').bind(JSON.stringify([...ids, newId]), ch.id).run();
          }
        }
      }
    } else {
      await db.prepare('UPDATE kids SET name = ?, avatar = ?, color = ? WHERE id = ?').bind(name, avatar, color, int(id)).run();
    }
  } else if (method === 'DELETE') {
    const kidId = int(id);
    await db.prepare('UPDATE kids SET active = 0 WHERE id = ?').bind(kidId).run();
    // take the kid out of every rotation from the current turn on (past turns stay as they were)
    for (const ch of await activeChores(db)) {
      if (!isRot(ch)) continue;
      const period = rotPeriod(ch, c.today);
      const kids = rotKidsNow(ch, period);
      if (!kids.includes(kidId)) continue;
      const left = kids.filter((k) => k !== kidId);
      await db.batch([
        db.prepare('UPDATE chores SET rot_plan = ?, kid_ids = ? WHERE id = ?').bind(JSON.stringify(replan(ch, left, period)), JSON.stringify(left), ch.id),
        db.prepare('DELETE FROM rotation_overrides WHERE chore_id = ? AND period >= ? AND kid_id = ?').bind(ch.id, period, kidId),
      ]);
    }
  } else bad('method');
  return buildState(c);
}

async function choresCrud(c, method, id) {
  const { db, body, today } = c;
  if (method === 'POST' || method === 'PUT') {
    const emoji = String(body.emoji || '').trim().slice(0, 60);
    const title = cleanText(body.title, 40);
    const rotation = body.rotation === 'daily' || body.rotation === 'weekly' ? body.rotation : '';
    const src = rotation ? body.rotKids : body.kidIds;
    const active = new Set((await activeKids(db)).map((k) => k.id));
    const kids = Array.isArray(src) ? [...new Set(src.map(Number).filter((n) => Number.isInteger(n) && active.has(n)))] : [];
    const schedule = rotation || (body.schedule === 'weekly' ? 'weekly' : 'daily');
    const days = schedule === 'weekly' && Array.isArray(body.days) ? [...new Set(body.days.map(Number).filter((n) => n >= 1 && n <= 7))].sort().join(',') : '';
    const minutes = Math.max(0, Math.min(600, int(body.minutes)));
    const cents = Math.max(0, Math.min(10000, int(body.cents)));
    if (!emoji || !AVATAR_RE.test(emoji)) bad('emoji required');
    if (!title) bad('title required');
    if (!kids.length) bad('pick at least one kid');
    const times = Math.max(1, Math.min(6, int(body.times) || 1));
    const labels = JSON.stringify((Array.isArray(body.labels) ? body.labels : []).slice(0, times).map((x) => cleanText(x, 10)));
    const rewardMode = body.rewardMode === 'all' && times > 1 ? 'all' : 'each';
    const fresh = { rotation, rot_plan: '[]' };
    if (method === 'POST') {
      const max = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM chores').first();
      const plan = rotation ? JSON.stringify(replan(fresh, kids, rotPeriod(fresh, today))) : '[]';
      // created_at in UTC; backdate to NY start of today so pinned days earlier this week don't show as late
      await db.prepare(`INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort, created_at, rotation, rot_plan, times, labels, reward_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(emoji, title, JSON.stringify(kids), schedule, days, minutes, cents, max.s, nyNoonUtc(today), rotation, plan, times, labels, rewardMode).run();
    } else {
      const old = await db.prepare('SELECT * FROM chores WHERE id = ?').bind(int(id)).first();
      if (!old) bad('unknown chore');
      let plan = old.rot_plan || '[]';
      if (rotation) {
        const period = rotPeriod(fresh, today);
        // same kind of rotation: keep the turns going (re-anchor only if the order changed);
        // new or switched kind: start fresh this period
        if (old.rotation === rotation) {
          if (JSON.stringify(rotKidsNow(old, period)) !== JSON.stringify(kids)) plan = JSON.stringify(replan(old, kids, period));
        } else plan = JSON.stringify(replan(fresh, kids, period));
      }
      await db.prepare('UPDATE chores SET emoji = ?, title = ?, kid_ids = ?, schedule = ?, days = ?, minutes = ?, cents = ?, rotation = ?, rot_plan = ?, times = ?, labels = ?, reward_mode = ? WHERE id = ?')
        .bind(emoji, title, JSON.stringify(kids), schedule, days, minutes, cents, rotation, plan, times, labels, rewardMode, int(id)).run();
    }
  } else if (method === 'DELETE') {
    await db.prepare('UPDATE chores SET active = 0 WHERE id = ?').bind(int(id)).run();
  } else bad('method');
  return buildState(c);
}
// parent: "skip to next kid" (the turns carry on from the next kid) or "swap turn" (this
// day / week only goes to another kid; the order is unchanged after it).
async function turnOverride(c) {
  const { db, body, today } = c;
  const ch = await db.prepare('SELECT * FROM chores WHERE id = ? AND active = 1').bind(int(body.choreId)).first();
  if (!ch || !isRot(ch)) bad('not a rotating chore');
  const period = rotPeriod(ch, today);
  const ovr = await loadOverrides(db);
  const turn = turnFor(ch, period, ovr);
  const done = await db.prepare('SELECT id FROM completions WHERE chore_id = ? AND period = ? LIMIT 1').bind(ch.id, period).first();
  const ticked = await db.prepare('SELECT id FROM repeat_checks WHERE chore_id = ? AND period = ? LIMIT 1').bind(ch.id, period).first();
  if (done || ticked) throw new HttpError(409, 'already started or done this turn: undo it first');
  const kids = rotKidsNow(ch, period);
  if (body.action === 'skip') {
    const next = kids[(kids.indexOf(turn) + 1) % kids.length];
    await db.batch([
      db.prepare('UPDATE chores SET rot_plan = ? WHERE id = ?').bind(JSON.stringify(planStartingWith(ch, next, period)), ch.id),
      db.prepare('DELETE FROM rotation_overrides WHERE chore_id = ? AND period >= ?').bind(ch.id, period),
    ]);
  } else if (body.action === 'swap') {
    const kidId = int(body.kidId);
    if (!kids.includes(kidId)) bad('that kid isn\'t in this rotation');
    if (kidId === planTurn(ch, period)) await db.prepare('DELETE FROM rotation_overrides WHERE chore_id = ? AND period = ?').bind(ch.id, period).run();
    else await db.prepare('INSERT INTO rotation_overrides (chore_id, period, kid_id) VALUES (?, ?, ?) ON CONFLICT(chore_id, period) DO UPDATE SET kid_id = excluded.kid_id').bind(ch.id, period, kidId).run();
  } else bad('action must be skip or swap');
  return buildState(c);
}

// ---------- goals ----------
async function goalFor(db, body) {
  const g = await db.prepare('SELECT * FROM goals WHERE id = ? AND active = 1').bind(int(body.goalId)).first();
  if (!g) bad('unknown goal');
  const kidId = int(body.kidId);
  if (!parseKids(g.kid_ids).includes(kidId)) bad('goal not for this kid');
  return { g, kidId };
}
// kid: "I did it!" -> pending (idempotent)
async function goalClaim(c) {
  const { g, kidId } = await goalFor(c.db, c.body);
  await c.db.prepare('INSERT OR IGNORE INTO goal_claims (goal_id, kid_id, status, claimed_day, emoji, title) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(g.id, kidId, 'pending', c.today, g.emoji, g.title).run();
  return { ok: true, state: await buildState(c) };
}
// kid: oops, take back a pending claim (never a confirmed one)
async function goalUnclaim(c) {
  const { g, kidId } = await goalFor(c.db, c.body);
  await c.db.prepare("DELETE FROM goal_claims WHERE goal_id = ? AND kid_id = ? AND status = 'pending'").bind(g.id, kidId).run();
  return { ok: true, state: await buildState(c) };
}
// parent: confirm (pending, or straight from open) -> rewards count, done for good
async function goalConfirm(c) {
  const { db, today } = c;
  const { g, kidId } = await goalFor(db, c.body);
  const r = await db.prepare(`INSERT INTO goal_claims (goal_id, kid_id, status, claimed_day, confirmed_day, minutes, cents, emoji, title) VALUES (?, ?, 'done', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(goal_id, kid_id) DO UPDATE SET status = 'done', confirmed_day = excluded.confirmed_day, minutes = excluded.minutes, cents = excluded.cents, emoji = excluded.emoji, title = excluded.title
    WHERE goal_claims.status = 'pending'`).bind(g.id, kidId, today, today, g.minutes, g.cents, g.emoji, g.title).run();
  return { ...(await buildState(c)), confirmed: r.meta.changes > 0 };
}
// parent: un-confirm -> back to pending; its rewards come off the balance
async function goalUnconfirm(c) {
  const { db, body } = c;
  await db.prepare("UPDATE goal_claims SET status = 'pending', confirmed_day = NULL, minutes = 0, cents = 0 WHERE goal_id = ? AND kid_id = ? AND status = 'done'")
    .bind(int(body.goalId), int(body.kidId)).run();
  return buildState(c);
}
// parent: "not yet" on a pending claim
async function goalReject(c) {
  await c.db.prepare("DELETE FROM goal_claims WHERE goal_id = ? AND kid_id = ? AND status = 'pending'").bind(int(c.body.goalId), int(c.body.kidId)).run();
  return buildState(c);
}
async function goalsCrud(c, method, id) {
  const { db, body } = c;
  if (method === 'POST' || method === 'PUT') {
    const emoji = String(body.emoji || '').trim().slice(0, 60);
    const title = cleanText(body.title, 40);
    const descr = cleanText(body.descr, 140);
    const active = new Set((await activeKids(db)).map((k) => k.id));
    const kids = Array.isArray(body.kidIds) ? [...new Set(body.kidIds.map(Number).filter((n) => active.has(n)))] : [];
    const minutes = Math.max(0, Math.min(600, int(body.minutes)));
    const cents = Math.max(0, Math.min(100000, int(body.cents)));
    if (!emoji || !AVATAR_RE.test(emoji)) bad('emoji required');
    if (!title) bad('title required');
    if (!kids.length) bad('pick at least one kid');
    if (method === 'POST') {
      const max = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM goals').first();
      await db.prepare('INSERT INTO goals (emoji, title, descr, kid_ids, minutes, cents, sort) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(emoji, title, descr, JSON.stringify(kids), minutes, cents, max.s).run();
    } else {
      // confirmed claims keep the reward they were given
      await db.batch([
        db.prepare('UPDATE goals SET emoji = ?, title = ?, descr = ?, kid_ids = ?, minutes = ?, cents = ? WHERE id = ?').bind(emoji, title, descr, JSON.stringify(kids), minutes, cents, int(id)),
        db.prepare("UPDATE goal_claims SET emoji = ?, title = ? WHERE goal_id = ? AND status = 'pending'").bind(emoji, title, int(id)),
      ]);
    }
  } else if (method === 'DELETE') {
    // trophies already won stay on the shelf and in the balance; pending claims go away
    await db.batch([
      db.prepare('UPDATE goals SET active = 0 WHERE id = ?').bind(int(id)),
      db.prepare("DELETE FROM goal_claims WHERE goal_id = ? AND status = 'pending'").bind(int(id)),
    ]);
  } else bad('method');
  return buildState(c);
}

// 16:00 UTC is always the same NY calendar day; stored so sqlUtcToNyDate(created_at) === day
const nyNoonUtc = (day) => `${day} 16:00:00`;

/** Delete one completion and take back any daily / weekly bonus that no longer holds. */
async function undoCompletion(db, comp) {
  const r = await db.prepare('DELETE FROM completions WHERE id = ?').bind(comp.id).run();
  const chores = await activeChores(db);
  if (!(await dayAllDone(db, comp.kid_id, comp.day, chores))) {
    await db.batch([
      db.prepare("DELETE FROM bonuses WHERE kid_id = ? AND kind = 'daily' AND period = ?").bind(comp.kid_id, comp.day),
      db.prepare("DELETE FROM bonuses WHERE kid_id = ? AND kind = 'weekly' AND period = ?").bind(comp.kid_id, weekStart(comp.day)),
    ]);
  }
  return r.meta.changes > 0;
}

// parent: undo any completion by id
async function undo(c) {
  const comp = await c.db.prepare('SELECT * FROM completions WHERE id = ?').bind(int(c.body.completionId)).first();
  if (!comp) bad('nothing to undo');
  // a multi-times chore: undo every repeat of that period too
  await c.db.prepare('DELETE FROM repeat_checks WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(comp.chore_id, comp.kid_id, comp.period).run();
  await undoCompletion(c.db, comp);
  return buildState(c);
}

// kids (family key only): uncheck a chore checked off today, or this week for weekly chores.
// Idempotent: unchecking something that isn't checked is a no-op.
async function uncheck(c) {
  const { db, body, today } = c;
  const kidId = int(body.kidId), choreId = int(body.choreId);
  const period = String(body.period || '');
  if (!isDay(period)) bad('bad period');
  const mch = await db.prepare('SELECT * FROM chores WHERE id = ?').bind(choreId).first();
  if (isMulti(mch)) {
    const t = await findTick(db, mch, kidId, period, body.slot);
    if (t) {
      const mon0 = weekStart(today);
      const ok = mch.schedule === 'weekly' ? t.day >= mon0 && t.period >= mon0 && t.day <= today : t.day === today && t.period === today;
      if (!ok) throw new HttpError(403, 'only a grown-up can undo an earlier day');
      const removed = await removeTick(db, t);
      return { ok: true, removed, state: await buildState(c) };
    }
    // no ticks: fall through (a check-off from before it became multi)
  }
  const comp = await db.prepare('SELECT * FROM completions WHERE chore_id = ? AND kid_id = ? AND period = ?').bind(choreId, kidId, period).first();
  if (!comp) return { ok: true, removed: false, state: await buildState(c) };
  const ch = await db.prepare('SELECT schedule FROM chores WHERE id = ?').bind(choreId).first();
  const mon = weekStart(today);
  const allowed = ch && ch.schedule === 'weekly'
    ? comp.day >= mon && comp.period >= mon && comp.day <= today
    : comp.day === today && comp.period === today;
  if (!allowed) throw new HttpError(403, 'only a grown-up can undo an earlier day');
  const removed = await undoCompletion(db, comp);
  return { ok: true, removed, state: await buildState(c) };
}

async function payout(c) {
  const { db, body, today } = c;
  const kidId = int(body.kidId);
  const bal = (await balances(db))[kidId] || { minutes: 0, cents: 0 };
  let minutes = body.all ? bal.minutes : Math.max(0, int(body.minutes));
  let cents = body.all ? bal.cents : Math.max(0, int(body.cents));
  if (minutes > bal.minutes || cents > bal.cents) bad('more than the balance');
  minutes = Math.max(0, minutes); cents = Math.max(0, cents);
  if (!minutes && !cents) bad('nothing to pay out');
  await db.prepare('INSERT INTO payouts (kid_id, day, minutes, cents, note) VALUES (?, ?, ?, ?, ?)')
    .bind(kidId, today, minutes, cents, cleanText(body.note, 60)).run();
  return buildState(c);
}

async function saveSettings(c) {
  const { db, body } = c;
  const clamp = (v, max) => Math.max(0, Math.min(max, int(v)));
  await db.batch([
    setSetting(db, 'daily_bonus_minutes', clamp(body.dailyMinutes, 600)),
    setSetting(db, 'daily_bonus_cents', clamp(body.dailyCents, 10000)),
    setSetting(db, 'weekly_bonus_minutes', clamp(body.weeklyMinutes, 600)),
    setSetting(db, 'weekly_bonus_cents', clamp(body.weeklyCents, 10000)),
  ]);
  c.settings = await loadSettings(db);
  return buildState(c);
}

async function changePin(c) {
  const { db, body, settings } = c;
  if (!/^\d{4}$/.test(String(body.newPin || ''))) bad('PIN must be 4 digits');
  await checkPin(c, body.currentPin);
  await db.batch([
    setSetting(db, 'pin_hash', await hashPin(String(body.newPin))),
    setSetting(db, 'family_key_enc', await sealKey(c.key, String(body.newPin))),
    db.prepare('DELETE FROM sessions'),
  ]);
  // keep this caller signed in
  const token = randomHex(32);
  await db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').bind(await sha256Hex(token), Date.now() + SESSION_MS).run();
  return { ok: true, token };
}

async function history(c) {
  const { db, url, today } = c;
  const w = url.searchParams.get('week');
  const mon = isDay(w) ? weekStart(w) : weekStart(today);
  const sun = addDays(mon, 6);
  const [kids, comps, bons, pays, chores, ovr, goalsDone, ticks] = await Promise.all([
    db.prepare('SELECT id, name, avatar, color, active FROM kids ORDER BY sort, id').all().then((r) => r.results),
    db.prepare('SELECT id, kid_id, chore_id, day, period, emoji, title, minutes, cents FROM completions WHERE day >= ? AND day <= ? ORDER BY created_at').bind(mon, sun).all().then((r) => r.results),
    db.prepare('SELECT kid_id, kind, period, minutes, cents FROM bonuses WHERE period >= ? AND period <= ?').bind(mon, sun).all().then((r) => r.results),
    db.prepare('SELECT id, kid_id, day, minutes, cents, note FROM payouts WHERE day >= ? AND day <= ? ORDER BY created_at').bind(mon, sun).all().then((r) => r.results),
    activeChores(db), loadOverrides(db),
    db.prepare("SELECT kid_id, goal_id, confirmed_day AS day, emoji, title, minutes, cents FROM goal_claims WHERE status = 'done' AND confirmed_day >= ? AND confirmed_day <= ?").bind(mon, sun).all().then((r) => r.results),
    db.prepare('SELECT chore_id, kid_id, period, slot, day, minutes, cents FROM repeat_checks WHERE day >= ? AND day <= ?').bind(mon, sun).all().then((r) => r.results),
  ]);
  const choreById = new Map(chores.map((ch) => [ch.id, ch]));
  // progress like 1/2 for multi-times chores (on done ones, and on ones started but not finished)
  for (const x of comps) { const ch = choreById.get(x.chore_id); if (isMulti(ch)) x.progress = { n: ch.times, of: ch.times }; }
  // Missed turns: a rotating chore whose turn ended without a check-off. The turn still moves on
  // to the next kid (no catch-up); it shows here as missed for the kid whose turn it was.
  const rots = chores.filter(isRot);
  const doneKeys = new Set(comps.map((x) => `${x.chore_id}|${x.period}`));
  const missed = [];
  for (const ch of rots) {
    const periods = ch.rotation === 'weekly' ? [mon] : weekDays(mon);
    for (const p of periods) {
      const end = ch.rotation === 'weekly' ? sun : p;
      if (end >= today || !startedBy(ch, p)) continue;
      if (doneKeys.has(`${ch.id}|${p}`)) continue;
      const kid = turnFor(ch, p, ovr);
      if (kid != null) missed.push({ kid_id: kid, chore_id: ch.id, period: p, day: end, emoji: ch.emoji, title: ch.title, rotation: ch.rotation });
    }
  }
  const days = weekDays(mon);
  return {
    weekStart: mon, today, days,
    kids: kids.filter((k) => k.active || comps.some((x) => x.kid_id === k.id) || pays.some((x) => x.kid_id === k.id)).map((k) => {
      const perDay = days.map((d) => {
        const done = comps.filter((x) => x.kid_id === k.id && x.day === d);
        const goalsHere = goalsDone.filter((x) => x.kid_id === k.id && x.day === d);
        const tk = ticks.filter((x) => x.kid_id === k.id && x.day === d);
        const partial = [];
        for (const [key, rows] of Object.entries(Object.groupBy ? Object.groupBy(tk, (x) => `${x.chore_id}|${x.period}`) : group(tk))) {
          const ch = choreById.get(rows[0].chore_id);
          if (!ch || comps.some((x) => `${x.chore_id}|${x.period}` === key && x.kid_id === k.id)) continue;
          const all = ticks.filter((x) => x.kid_id === k.id && `${x.chore_id}|${x.period}` === key).length;
          partial.push({ chore_id: ch.id, emoji: ch.emoji, title: ch.title, progress: { n: all, of: ch.times } });
        }
        const bonus = bons.filter((b) => b.kid_id === k.id && b.kind === 'daily' && b.period === d);
        const paid = pays.filter((p) => p.kid_id === k.id && p.day === d);
        const sum = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0);
        return {
          day: d, done, allDone: bonus.length > 0, payouts: paid, goals: goalsHere, partial,
          missed: missed.filter((x) => x.kid_id === k.id && x.day === d),
          earned: { minutes: sum(done, 'minutes') + sum(bonus, 'minutes') + sum(goalsHere, 'minutes') + sum(tk, 'minutes'), cents: sum(done, 'cents') + sum(bonus, 'cents') + sum(goalsHere, 'cents') + sum(tk, 'cents') },
          paid: { minutes: sum(paid, 'minutes'), cents: sum(paid, 'cents') },
        };
      });
      const weekly = bons.find((b) => b.kid_id === k.id && b.kind === 'weekly' && b.period === mon) || null;
      return { id: k.id, name: k.name, avatar: k.avatar, color: k.color, active: !!k.active, days: perDay, weeklyBonus: weekly };
    }),
  };
}

const group = (arr) => arr.reduce((m, x) => { (m[`${x.chore_id}|${x.period}`] ||= []).push(x); return m; }, {});
export const _test = { sqlUtcToNyDate, parsePlan, withSlots };
