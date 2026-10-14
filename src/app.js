// Celebrations come from the design kit: /theme/celebration/celebrate.js (window.Celebrate).
const Cel = () => window.Celebrate;

// ---------- setup ----------
const LS = { key: 'chores.key', kid: 'chores.kid', mute: 'chores.mute', state: 'chores.state', queue: 'chores.queue' };
const qs = new URLSearchParams(location.search);
const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;
let key = qs.get('k') || localStorage.getItem(LS.key) || '';
if (!KEY_RE.test(key)) key = '';
if (key) {
  localStorage.setItem(LS.key, key);
  // keep the key in the address so "Add to Home Screen" captures it (iOS web apps get their own storage)
  if (qs.get('k') !== key) { qs.set('k', key); history.replaceState(null, '', `${location.pathname}?${qs}`); }
  setManifest();
}
function setManifest() {
  const l = document.getElementById('manifest-link');
  if (l && key) l.href = `/manifest.webmanifest?k=${encodeURIComponent(key)}`;
}
function adoptKey(k) {
  key = k;
  localStorage.setItem(LS.key, k);
  const q = new URLSearchParams(location.search);
  q.set('k', k);
  history.replaceState(null, '', `${location.pathname}?${q}`);
  setManifest();
}
// test hooks (ignored by the production server): ?now=<ISO|ms> shifts the clock, ?poll=<seconds>
let clockOffset = 0;
if (qs.get('now')) { const n = qs.get('now'); const t = /^\d+$/.test(n) ? +n : Date.parse(n); if (!Number.isNaN(t)) clockOffset = t - Date.now(); }
const POLL_MS = Math.max(2, Number(qs.get('poll')) || 30) * 1000;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const S = {
  data: readJSON(LS.state),
  kidId: Number(localStorage.getItem(LS.kid)) || null,
  muted: localStorage.getItem(LS.mute) === '1',
  queue: readJSON(LS.queue) || [],
  online: navigator.onLine,
  error: null,
  parent: null,       // { token, tab, edit, week, history }
  theme: { avatars: ['img:avatars/avatar-astronaut.svg', 'img:avatars/avatar-robot.svg'], colors: ['#19C3C8', '#8B5CF6'], choreIcons: [], choreEmoji: ['img:chores/star.svg'] },
};
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
const saveQueue = () => localStorage.setItem(LS.queue, JSON.stringify(S.queue));

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
// An icon value is an emoji, or "img:<path under /theme/>" for a kit SVG.
const isImg = (v) => String(v).startsWith('img:');
// Known emoji (with or without FE0F) show as their Space Explorers SVG; any other typed emoji stays as text.
const EMOJI_SVG = {"👕": "img:chores/get-dressed.svg", "🎒": "img:chores/backpack.svg", "🧸": "img:chores/teddy-bear.svg", "🍽": "img:chores/set-table.svg", "🐶": "img:chores/dog.svg", "🐱": "img:chores/cat.svg", "🌱": "img:chores/water-plants.svg", "📚": "img:chores/books.svg", "✏": "img:chores/pencil.svg", "🎹": "img:chores/piano.svg", "🧹": "img:chores/clean-room.svg", "🧽": "img:chores/sponge.svg", "🚿": "img:chores/shower.svg", "👟": "img:chores/shoes.svg", "🥣": "img:chores/cereal-bowl.svg", "🧦": "img:chores/socks.svg", "🚗": "img:chores/car.svg", "🍂": "img:chores/rake-leaves.svg", "🛁": "img:chores/bath.svg", "💤": "img:chores/bedtime.svg", "🏃": "img:chores/run.svg", "🎨": "img:chores/paint.svg", "🧩": "img:chores/puzzle.svg", "⚽": "img:chores/soccer.svg", "⭐": "img:chores/star.svg", "🚲": "img:chores/bike.svg", "🏊": "img:chores/swim.svg", "🦷": "img:chores/tooth.svg", "🧗": "img:chores/climb.svg", "🏀": "img:chores/basketball.svg", "🚀": "img:chores/rocket.svg", "🙂": "img:chores/smile.svg"};
const toImg = (v) => { const t = String(v ?? '').trim(); return EMOJI_SVG[t.replace(/\uFE0F/g, '')] || t; };
const face = (v) => { const u = toImg(v); return isImg(u) ? `<img alt="" src="/theme/${esc(u.slice(4))}">` : esc(u); };
// Small status badge (src/theme/badges/badge-<slug>.svg)
const B = (slug, label = '') => `<img class="b" alt="${esc(label)}" src="/theme/badges/badge-${slug}.svg">`;
const icon = (v, cls = 'ic') => `<span class="${cls}">${face(v)}</span>`;
const R = (n) => `<img alt="" src="/theme/rewards/${n}.svg">`;
const RM = `<img class="b" alt="min" src="/theme/rewards/game-time.svg">`, RD = `<img class="b" alt="$" src="/theme/rewards/money-bill.svg">`;
const dayIdx = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function toast(msg, ms = 2200, ico = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; if (ico) t.insertAdjacentHTML('afterbegin', `${ico} `); t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- API ----------
async function api(path, { method = 'GET', body, parent = false } = {}) {
  const headers = { 'x-family-key': key };
  if (clockOffset) headers['x-test-now'] = String(Date.now() + clockOffset);
  if (body) headers['content-type'] = 'application/json';
  if (parent && S.parent) headers['x-parent-token'] = S.parent.token;
  let res;
  try {
    res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (e) {
    const err = new Error('offline'); err.offline = true; throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; throw err; }
  return data;
}

function setData(d) {
  if (!d || !d.kids) return;
  const dayChanged = S.data && S.data.today !== d.today;
  S.data = d;
  localStorage.setItem(LS.state, JSON.stringify(d));
  scheduleMidnight(d.msToMidnight);
  if (dayChanged) {
    // new day: drop queued ops that the server already rejected or that are stale
    S.queue = S.queue.filter((q) => q.day >= addDaysLocal(d.today, -7)); saveQueue();
  }
}
function addDaysLocal(d, n) { const t = Date.parse(`${d}T12:00:00Z`) + n * 864e5; return new Date(t).toISOString().slice(0, 10); }

let midnightTimer = null;
function scheduleMidnight(ms) {
  clearTimeout(midnightTimer);
  if (typeof ms === 'number' && ms > 0) midnightTimer = setTimeout(() => refresh(), Math.min(ms + 1500, 2 ** 31 - 1));
}

let refreshing = null;
async function refresh() {
  if (!key) return render();
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      await flushQueue();
      setData(await api('state'));
      S.online = true; S.error = null;
    } catch (e) {
      if (e.offline) S.online = false;
      else if (e.status === 401) { key = ''; localStorage.removeItem(LS.key); S.data = null; localStorage.removeItem(LS.state); S.error = null; }
      else S.error = e;
    } finally { refreshing = null; }
    renderKid();
  })();
  return refreshing;
}

let flushing = false;
async function flushQueue() {
  if (flushing || !S.queue.length) return;
  flushing = true;
  try {
    while (S.queue.length) {
      const op = S.queue[0];
      S.inflight = op;
      try {
        const r = await api(op.type === 'uncheck' ? 'uncheck' : 'check', { method: 'POST', body: op });
        S.queue.shift(); saveQueue();
        setData(r.state);
        S.online = true;
        if (r.celebrate) celebrateServer(r.celebrate, op.kidId, op.day);
      } catch (e) {
        if (e.offline || e.status >= 500 || e.status === 401) { S.online = !e.offline ? S.online : false; break; }
        S.queue.shift(); saveQueue(); // 4xx: the chore was removed or the day passed; drop it
        if (op.type === 'uncheck' && e.status === 403) toast('🔒 Ask a grown-up to undo that one.', 3000);
      } finally { S.inflight = null; }
    }
  } finally { flushing = false; }
}

// Celebrations and bonus toasts happen once per kid per day (and once per week for the
// streak), so check / uncheck / re-check doesn't replay them. Rewards are server-side and
// net to zero either way.
const CEL_KEY = 'chores.celebrated';
function celebratedOnce(tag) {
  const seen = readJSON(CEL_KEY) || {};
  if (seen[tag]) return false;
  seen[tag] = Date.now();
  for (const [k, t] of Object.entries(seen)) if (Date.now() - t > 9 * 864e5) delete seen[k];
  localStorage.setItem(CEL_KEY, JSON.stringify(seen));
  return true;
}

function celebrateServer(c, kidId, day) {
  const kid = S.data?.kids.find((k) => k.id === kidId);
  if (c.weekly && celebratedOnce(`week|${kidId}|${S.data?.weekStart}`)) {
    const show = () => Cel()?.allDone({ title: 'Super week!', sub: `${kid ? kid.name + ', you' : 'You'} did every chore, every day! ${bonusText(c.weekly)}`, button: 'Woo-hoo!', autoCloseMs: 12000 });
    // wait for the day's "All done!" screen to close first
    const wait = () => (document.querySelector('.cel-done') ? setTimeout(wait, 400) : show());
    setTimeout(wait, 1600);
  } else if (c.daily && celebratedOnce(`bonus|${kidId}|${day}`)) {
    setTimeout(() => toast(`Bonus! ${bonusText(c.daily)}`, 3500, B('trophy')), 1400);
  }
}
const bonusText = (b) => [b.minutes ? `+${b.minutes} min` : '', b.cents ? `+${money(b.cents)}` : ''].filter(Boolean).join('  ');

// ---------- kid view ----------
function currentKid() {
  const kids = S.data?.kids || [];
  let k = kids.find((x) => x.id === S.kidId);
  if (!k) { k = kids[0]; if (k) S.kidId = k.id; }
  return k;
}
/** items with queued (offline / in-flight) check-offs applied */
// Queued ops (offline or in flight) are applied on top of the server state, in order.
// Multi-times chores: each repeat (slot) has its own ops.
const opKey = (o) => `${o.kidId}|${o.choreId}|${o.period}|${o.slot || 0}`;
function lastOp(kidId, it, slot) {
  let last = null;
  for (const o of S.queue) if (o.kidId === kidId && o.choreId === it.choreId && o.period === it.period && (o.slot || 0) === (slot || 0)) last = o;
  return last;
}
function viewItems(kid) {
  return kid.items.map((it) => {
    if (it.slots) {
      let pending = false;
      const slots = it.slots.map((sl) => {
        const o = lastOp(kid.id, it, sl.slot);
        if (!o) return sl;
        const d = (o.type || 'check') === 'check';
        if (d === sl.done) return sl;
        pending = true; return { ...sl, done: d };
      });
      const n = slots.filter((x) => x.done).length;
      return { ...it, slots, progress: { n, of: it.times }, done: n === it.times, pending };
    }
    const o = lastOp(kid.id, it);
    if (!o) return it;
    const done = (o.type || 'check') === 'check';
    return done === it.done ? it : { ...it, done, pending: true };
  });
}
function viewBalance(kid) {
  let { minutes, cents } = kid.balance;
  const view = viewItems(kid);
  kid.items.forEach((it, i) => {
    if (!it.slots) return;
    const v = view[i];
    const k = it.rewardMode === 'all' ? (v.done ? 1 : 0) - (it.done ? 1 : 0) : v.progress.n - it.progress.n;
    minutes += k * it.minutes; cents += k * it.cents;
  });
  for (const it of kid.items) {
    if (it.slots) continue;
    const o = lastOp(kid.id, it);
    if (!o) continue;
    const done = (o.type || 'check') === 'check';
    if (done && !it.done) { minutes += it.minutes; cents += it.cents; }
    if (!done && it.done) { minutes -= it.minutes; cents -= it.cents; }
  }
  return { minutes, cents };
}

function render() { renderKid(); }

function renderKid() {
  if (!key) return renderSetup();
  const d = S.data;
  if (!d) {
    if (!S.online) return renderGate('No internet yet. Try again soon!');
    if (S.error) return renderGate('Something went wrong. Try again soon!');
    return; // boot screen stays
  }
  const kid = currentKid();
  const top = `
    <header class="app-header"><div class="in">
      <div class="kids" role="tablist">
        ${d.kids.map((k) => `<button class="kid-btn ${k.id === kid?.id ? 'on' : ''}" style="--kid:${esc(k.color)}" data-kid="${k.id}" role="tab" aria-selected="${k.id === kid?.id}">
            <span class="av">${face(k.avatar)}</span><span class="nm">${esc(k.name)}</span>
          </button>`).join('')}
      </div>
      <div class="hbtns"><button class="hbtn" data-act="mute" aria-label="${S.muted ? 'Sound off' : 'Sound on'}">${S.muted ? '🔇' : '🔊'}</button>
      <button class="hbtn" data-act="parent" aria-label="Grown-ups">🔒</button></div>
    </div></header>`;
  if (!kid) { $app.innerHTML = top + `<div class="page"><div class="empty">Add a kid in grown-up mode.</div></div>`; return; }

  const items = viewItems(kid);
  // count each repeat of a multi-times chore (2x teeth = 2 checks)
  // what counts toward today: open weekly chores only on their last available day (server: logic.js counted())
  const cnt = items.filter((i) => i.done || i.countsOpen !== false);
  const totalN = cnt.reduce((a, i) => a + (i.slots ? i.times : 1), 0);
  const doneN = cnt.reduce((a, i) => a + (i.slots ? i.progress.n : i.done ? 1 : 0), 0);
  const left = totalN - doneN;
  const allDone = cnt.length > 0 && cnt.every((i) => i.done);
  const bal = viewBalance(kid);
  const bonus = d.bonus;

  const prevPct = renderKid.kid === kid.id ? document.querySelector('.pb-daily')?.style.getPropertyValue('--pct') : null;
  renderKid.kid = kid.id;
  $app.innerHTML = `${top}<main class="page">
    <section class="hello">
      <div class="grow">
        <h1>Hi, ${esc(kid.name)}!</h1>
        <div class="sub">${DAYS_LONG[d.dow - 1]}${items.length ? ` · ${allDone ? 'all done!' : `${left} to go`}` : ''}</div>
      </div>
      <div class="pills">
        <span class="pill" aria-label="Game time">${R('game-time')}<span class="v-min">${bal.minutes}m</span></span>
        <span class="pill" aria-label="Money">${R('money-coin')}<span class="v-money">${money(bal.cents)}</span></span>
      </div>
    </section>
    ${progressBars(kid, doneN, totalN, allDone, d.today)}
    ${!S.online ? '<div class="offline">📡 Offline. Your checks will sync later.</div>' : ''}
    ${allDone ? `<div class="alldone">${R('trophy')}<div><b>All done!</b>${bonus.dailyMinutes || bonus.dailyCents ? `<small>Bonus: ${esc(bonusText({ minutes: bonus.dailyMinutes, cents: bonus.dailyCents }))}</small>` : ''}</div></div>` : ''}
    ${items.length ? `<div class="list">${items.map(card).join('')}</div>` : ''}
    ${goalsSection(kid)}
  </main>`;
  animateDaily(prevPct);
  celebrateTrophies(kid);
}

// same rule as the server (logic.js isAllDone): open weekly chores count only on their last available day
const allDoneView = (items) => { const c = items.filter((i) => i.done || i.countsOpen !== false); return c.length > 0 && c.every((i) => i.done); };

// ---------- progress bars (styles: theme/progress/) ----------
// Server data: kid.progress (functions/_lib/progress.js), same definition as the all-done bonus, NY days.
// The daily bar uses the live view (doneN/totalN incl. queued offline taps) so it moves instantly;
// today's weekly slot follows it. Server states map to the spec's: upcoming->empty, none->rest.
const PG = '/theme/progress/';
const PDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOT_ICON = { rest: 'slot-rest.svg', done: 'slot-done.svg', 'today-done': 'slot-done.svg', missed: 'slot-missed.svg', today: 'slot-today.svg' };
const SLOT_SAY = { rest: 'rest day', empty: 'not yet', missed: 'not finished', done: 'all done', today: 'today, in progress', 'today-done': 'today, all done' };
function slotStates(kid, today, done, total) {
  const wk = kid.progress?.week || kid.stars.map((st) => ({ day: '', state: st === 'future' ? 'upcoming' : st }));
  return wk.map((w) => {
    const isToday = w.day === today || (!w.day && w.state === 'today');
    if (isToday) return total === 0 ? 'rest' : done >= total ? 'today-done' : 'today';
    return { upcoming: 'empty', none: 'rest', done: 'done', missed: 'missed', today: 'today' }[w.state] || 'empty';
  });
}
function progressBars(kid, doneN, totalN, allDone, today) {
  const state = totalN === 0 ? 'rest' : doneN === 0 ? 'empty' : doneN >= totalN ? 'full' : 'partial';
  const pct = totalN ? Math.min(100, Math.round((doneN / totalN) * 100)) : 0;
  const left = totalN - doneN;
  const msg = state === 'full' ? '<span class="pb-daily__done-text">All done!</span>' : 'Today';
  const sub = state === 'full' ? 'Trophy won!' : left === 1 ? '1 more to go' : `${left} more to go`;
  const nm = `${esc(kid.name)}’s`;
  const daily = `<div class="pb-daily" data-done="${doneN}" data-total="${totalN}" data-state="${state}" style="--pct:${pct}">
    ${state === 'rest' ? `<div class="pb-daily__rest" role="status"><img src="${PG}moon.svg" alt=""><div><b>Day off!</b><span>No chores today. Enjoy!</span></div></div>` : `
    <div class="pb-daily__label"><span>${msg} <small>${sub}</small></span><span class="pb-daily__count"><b>${doneN}</b> of ${totalN}</span></div>
    <div class="pb-daily__rail" role="progressbar" aria-label="${nm} chores today" aria-valuemin="0" aria-valuemax="${totalN}" aria-valuenow="${doneN}" aria-valuetext="${doneN} of ${totalN} chores done">
      <div class="pb-daily__track"><div class="pb-daily__fill"></div></div>
      <span class="pb-daily__marker"><img src="${PG}rocket-marker.svg" alt=""></span>
      <img class="pb-daily__burst" src="${PG}burst.svg" alt="">
      <img class="pb-daily__goal" src="${PG}trophy.svg" alt="">
    </div>`}</div>`;
  const sts = slotStates(kid, today, doneN, totalN);
  const ti = (kid.progress?.week || []).findIndex((w) => w.day === today);
  const n = sts.filter((x) => x === 'done' || x === 'today-done').length;
  const week = `<div class="pb-week"><div class="pb-week__title"><span>This week</span><small>${n} of 7 stars</small></div>
    <ol class="pb-week__slots" aria-label="This week: ${n} of 7 days all done">${sts.map((x, i) => `<li class="pb-slot" data-state="${x}" data-day="${kid.progress?.week?.[i]?.day || ''}" aria-label="${PDAYS[i]}: ${x === 'rest' && i === ti ? 'today, rest day' : SLOT_SAY[x]}"${i === ti ? ' aria-current="date"' : ''}>
      <span class="pb-slot__dot">${SLOT_ICON[x] ? `<img src="${PG}${SLOT_ICON[x]}" alt="">` : ''}</span><span class="pb-slot__day" aria-hidden="true">${'MTWTFSS'[i]}</span></li>`).join('')}</ol></div>`;
  return `<section class="pb-kid pb-today" aria-label="${nm} progress">${daily}${week}</section>`;
}
// keep the fill/rocket transition: start the new bar at the old width, then move to the new one
function animateDaily(prev) {
  const el = document.querySelector('.pb-daily');
  if (!el || prev == null) return;
  const to = el.style.getPropertyValue('--pct');
  if (String(prev) === to) return;
  el.style.setProperty('--pct', prev);
  requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--pct', to)));
}

// ---------- goals (kid side) ----------
const shortDate = (d) => { const [, m, dd] = d.split('-').map(Number); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${dd}`; };
const rwChips = (m, c) => [m ? `<span class="rw">${R('game-time')}${m}m</span>` : '', c ? `<span class="rw">${R('money-coin')}${money(c)}</span>` : ''].join('');
function goalsSection(kid) {
  const open = (kid.goals || []).filter((g) => g.status !== 'done');
  const tro = kid.trophies || [];
  if (!open.length && !tro.length) return '';
  return `<section class="goals" aria-label="Goals">
    ${open.length ? `<h2 class="sec">${B('trophy')} Goals</h2><div class="list">${open.map((g) => `
      <div class="card goal ${g.status === 'pending' ? 'is-pending' : ''}" data-goalcard="${g.goalId}">
        ${icon(g.emoji, 'icon')}
        <span class="txt"><span class="label">${esc(g.title)}</span>${g.descr ? `<span class="descr">${esc(g.descr)}</span>` : ''}${g.minutes || g.cents ? `<span class="meta">${rwChips(g.minutes, g.cents)}</span>` : ''}</span>
        ${g.status === 'pending'
          ? `<button class="didit wait" data-goal="${g.goalId}" data-op="unclaim" aria-label="Waiting for a grown-up. Tap to take it back.">${B('waiting')}<small>Waiting</small></button>`
          : `<button class="didit" data-goal="${g.goalId}" data-op="claim">${B('i-did-it')}<small>I did it!</small></button>`}
      </div>`).join('')}</div>` : ''}
    ${tro.length ? `<h2 class="sec">${B('trophy')} Trophy shelf</h2><div class="shelf">${tro.map((t) => `
      <div class="trophy" title="${esc(t.title)}">${R('trophy')}<span class="te">${face(t.emoji)}</span><span class="tt">${esc(t.title)}</span><span class="td">${esc(shortDate(t.day))}</span></div>`).join('')}</div>` : ''}
  </section>`;
}
const goalBusy = new Set();
async function goalTap(btn) {
  const kid = currentKid();
  const goalId = Number(btn.dataset.goal), op = btn.dataset.op;
  const lock = `${kid.id}|${goalId}`;
  if (goalBusy.has(lock)) return;
  goalBusy.add(lock);
  const g = kid.goals.find((x) => x.goalId === goalId);
  if (g) g.status = op === 'claim' ? 'pending' : 'open'; // optimistic
  renderKid();
  if (op === 'claim') {
    const el = $app.querySelector(`[data-goalcard="${goalId}"]`);
    if (el && Cel()) Cel().check(el, { originEl: el.querySelector('.didit') });
    toast('A grown-up will check it!', 2600, B('waiting'));
  } else if (!S.muted) softSound();
  try {
    const r = await api(`goal/${op}`, { method: 'POST', body: { goalId, kidId: kid.id } });
    setData(r.state);
  } catch (e) {
    toast(e.offline ? '📡 No internet. Try again soon.' : `⚠️ ${e.message}`, 3000);
    await refresh();
  } finally { goalBusy.delete(lock); renderKid(); }
}
// a goal confirmed by a grown-up (on any device) gets a party the next time the kid looks
function celebrateTrophies(kid) {
  if (!S.data || $sheet || document.querySelector('.cel-done')) return; // not while a grown-up is in parent mode
  const recent = (kid.trophies || []).filter((t) => t.day >= addDaysLocal(S.data.today, -2));
  for (const t of recent) {
    if (!celebratedOnce(`goal|${kid.id}|${t.goalId}|${t.day}`)) continue;
    setTimeout(() => Cel()?.allDone({ title: 'Goal reached!', sub: `${kid.name}: ${t.title}! ${bonusText(t)}`, button: 'Yay!', autoCloseMs: 10000 }), 300);
    break;
  }
}

function card(it) {
  let tag = '';
  if (it.rot) tag = `<span class="tag rot" title="Your turn">${B('rotate', 'Your turn')}${it.rot === 'weekly' ? B('this-week', 'this week') : ''}</span>`;
  else if (it.due === 'week') tag = `<span class="tag week">${B('this-week')} This week</span>`;
  else if (it.due === 'late') tag = `<span class="tag late">${B('late')} ${DAYS[dayIdx(it.period)]}</span>`;
  if (it.slots) return multiCard(it, tag);
  const rw = [it.minutes ? `<span class="rw">${R('game-time')}${it.minutes}m</span>` : '', it.cents ? `<span class="rw">${R('money-coin')}${money(it.cents)}</span>` : ''].join('');
  return `<button class="card chore ${it.done ? 'is-done' : ''} ${it.pending ? 'pending' : ''}" data-key="${esc(it.key)}" aria-pressed="${it.done}" aria-label="${esc(it.title)}${it.done ? ', done. Tap to undo.' : ''}">
    ${icon(it.emoji, 'icon')}
    <span class="txt"><span class="label">${esc(it.title)}</span>${rw || tag ? `<span class="meta">${rw}${tag}</span>` : ''}</span>
    ${it.done ? `<span class="undo-hint" aria-hidden="true">${B('undo')}</span>` : ''}<span class="check ${it.done ? 'on' : ''}" aria-hidden="true"></span>
  </button>`;
}

// A chore done N times a day: one card, one big check per repeat (AM / PM ...).
function multiCard(it, tag) {
  const x = it.rewardMode === 'each' ? ` ×${it.times}` : '';
  const rw = [it.minutes ? `<span class="rw">${R('game-time')}${it.minutes}m${x}</span>` : '', it.cents ? `<span class="rw">${R('money-coin')}${money(it.cents)}${x}</span>` : ''].join('');
  const prog = `<span class="prog ${it.done ? 'full' : ''}">${it.progress.n}/${it.progress.of}</span>`;
  return `<div class="card chore multi ${it.done ? 'is-done' : ''} ${it.pending ? 'pending' : ''}" data-key="${esc(it.key)}" role="group" aria-label="${esc(it.title)}, ${it.progress.n} of ${it.progress.of} done">
    ${icon(it.emoji, 'icon')}
    <span class="txt"><span class="label">${esc(it.title)}</span><span class="meta">${prog}${rw}${tag}</span></span>
    <span class="slots">${it.slots.map((sl) => `<button class="slot ${sl.done ? 'on' : ''}" data-key="${esc(it.key)}" data-slot="${sl.slot}" aria-pressed="${sl.done}"
      aria-label="${esc(sl.label || `#${sl.slot}`)}${sl.done ? ', done. Tap to undo.' : ''}"><span class="check ${sl.done ? 'on' : ''}" aria-hidden="true"></span><span class="sl">${esc(sl.label || String(sl.slot))}</span></button>`).join('')}</span>
  </div>`;
}

// ---------- device setup (no family key yet): parent PIN on big buttons ----------
S.setup = { digits: '', err: '', busy: false, shake: false, paste: false };
function renderSetup() {
  const p = S.setup;
  $app.innerHTML = `<div class="pin setup"><div style="text-align:center">
    <img alt="" src="/theme/icons/favicon.svg" width="96" height="96" style="margin:0 auto 8px">
    <h2>Grown-up setup</h2>
    <p class="setup-sub">Enter the parent PIN to set up this device.</p>
    <div class="dots ${p.shake ? 'shake' : ''}">${[0, 1, 2, 3].map((i) => `<i class="${i < p.digits.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-unlock="${n}">${n}</button>`).join('')}
      <span></span><button data-unlock="0">0</button><button data-unlock="b" aria-label="Delete">⌫</button></div>
    <div class="err">${esc(p.err)}</div>
    <button class="linkish" data-act="paste">${p.paste ? 'Hide' : 'Have the family link? Paste it instead'}</button>
    ${p.paste ? `<form id="linkform" class="row" style="max-width:560px;margin:14px auto 0;justify-content:center">
      <input class="in" name="link" placeholder="Paste the family link" autocomplete="off" style="flex:1;min-width:220px">
      <button class="btn">Open</button></form>` : ''}
  </div></div>`;
  p.shake = false;
}
async function unlockKey(d) {
  const p = S.setup;
  if (p.busy) return;
  if (d === 'b') { p.digits = p.digits.slice(0, -1); return renderSetup(); }
  if (p.digits.length >= 4) return;
  p.digits += d; p.err = '';
  renderSetup();
  if (p.digits.length < 4) return;
  p.busy = true;
  try {
    const r = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: p.digits }), cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.key) throw Object.assign(new Error(data.error || 'Try again'), { status: r.status });
    S.setup = { digits: '', err: '', busy: false, shake: false, paste: false };
    adoptKey(data.key);
    toast('🔓 This device is set up!');
    $app.innerHTML = '<div class="boot"><img src="/theme/icons/favicon.svg" alt="" width="120" height="120"></div>';
    refresh();
  } catch (e) {
    p.busy = false; p.digits = ''; p.shake = true;
    p.err = e.status === 403 && e.message === 'wrong PIN' ? 'Wrong PIN' : e.status ? e.message : 'No internet. Try again.';
    renderSetup();
  }
}

function renderGate(msg, askLink = false) {
  $app.innerHTML = `<div class="gate"><img alt="" src="/theme/icons/favicon.svg"><p>${esc(msg)}</p>
    ${askLink ? `<form id="linkform" class="row" style="max-width:600px;margin:30px auto 0;justify-content:center">
      <input class="in" name="link" placeholder="Paste the family link" autocomplete="off" style="flex:1;min-width:220px">
      <button class="btn">Open</button></form>` : ''}</div>`;
}

$app.addEventListener('submit', (e) => {
  if (e.target.id !== 'linkform') return;
  e.preventDefault();
  const v = e.target.link.value.trim();
  const m = v.match(/[?&]k=([A-Za-z0-9_-]{24,64})/) || v.match(/^([A-Za-z0-9_-]{24,64})$/);
  if (!m) return toast('That link doesn\'t look right.');
  location.href = `/?k=${m[1]}`;
});

$app.addEventListener('click', (e) => {
  const kb = e.target.closest('[data-kid]');
  if (kb) { S.kidId = Number(kb.dataset.kid); localStorage.setItem(LS.kid, S.kidId); renderKid(); window.scrollTo({ top: 0 }); return; }
  const ub = e.target.closest('[data-unlock]');
  if (ub) return unlockKey(ub.dataset.unlock);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'paste') { S.setup.paste = !S.setup.paste; renderSetup(); return; }
  if (act === 'mute') { toggleMute(); renderKid(); toast(S.muted ? '🔇 Sound off' : '🔊 Sound on'); return; }
  if (act === 'parent') return openPin();
  const gb = e.target.closest('[data-goal]');
  if (gb) return goalTap(gb);
  const sb = e.target.closest('[data-slot]');
  if (sb) return slotTap(sb.dataset.key, Number(sb.dataset.slot));
  const cardEl = e.target.closest('.chore');
  if (cardEl) checkOff(cardEl);
});

function toggleMute() {
  S.muted = !S.muted;
  localStorage.setItem(LS.mute, S.muted ? '1' : '0');
  Cel()?.configure({ muted: S.muted });
}

const tapLock = new Map(); // card key -> time of last tap (double-tap guard)
const TAP_LOCK_MS = 600;

function checkOff(el) {
  const kid = currentKid();
  const it = viewItems(kid).find((i) => i.key === el.dataset.key);
  if (!it) return;
  if (it.slots) {
    // tapping the card itself (not a check): next open repeat, or undo the last one when all are done
    const open = it.slots.find((x) => !x.done);
    return slotTap(it.key, open ? open.slot : [...it.slots].reverse().find((x) => x.done).slot);
  }
  const lockKey = `${kid.id}|${it.key}`;
  const now = Date.now();
  if (now - (tapLock.get(lockKey) || 0) < TAP_LOCK_MS) return;
  tapLock.set(lockKey, now);
  if (it.done) return uncheckChore(kid, it);

  enqueue({ type: 'check', opId: uid(), kidId: kid.id, choreId: it.choreId, period: it.period, day: S.data.today });
  const nowAll = allDoneView(viewItems(kid));
  renderKid();
  const fresh = $app.querySelector(`.chore[data-key="${CSS.escape(it.key)}"]`);
  const run = Cel() && fresh ? Cel().check(fresh, { originEl: fresh.querySelector('.check') }) : Promise.resolve();
  if (nowAll && celebratedOnce(`all|${kid.id}|${S.data.today}`)) {
    const b = S.data.bonus;
    const extra = b.dailyMinutes || b.dailyCents ? ` Bonus: ${bonusText({ minutes: b.dailyMinutes, cents: b.dailyCents })}` : '';
    run.then(() => Cel()?.allDone({ title: 'All done!', sub: `Great job, ${kid.name}! Every chore is checked.${extra}`, button: 'Yay!', autoCloseMs: 10000 }));
  }
  flushQueue().then(() => renderKid());
}

function slotTap(itemKey, slot) {
  const kid = currentKid();
  const it = viewItems(kid).find((i) => i.key === itemKey);
  const sl = it?.slots?.find((x) => x.slot === slot);
  if (!sl) return;
  const lockKey = `${kid.id}|${it.key}|${slot}`;
  const now = Date.now();
  if (now - (tapLock.get(lockKey) || 0) < TAP_LOCK_MS) return;
  tapLock.set(lockKey, now);
  const sel = `.slot[data-key="${CSS.escape(it.key)}"][data-slot="${slot}"]`;
  if (sl.done) {
    enqueue({ type: 'uncheck', opId: uid(), kidId: kid.id, choreId: it.choreId, period: it.period, slot, day: S.data.today });
    renderKid();
    const f = $app.querySelector(sel);
    if (f) { f.classList.add('uncheck'); setTimeout(() => f.classList.remove('uncheck'), 500); }
    if (!S.muted) softSound();
    return flushQueue().then(() => renderKid());
  }
  enqueue({ type: 'check', opId: uid(), kidId: kid.id, choreId: it.choreId, period: it.period, slot, day: S.data.today });
  const nowAll = allDoneView(viewItems(kid));
  renderKid();
  const f = $app.querySelector(sel);
  const run = Cel() && f ? Cel().check(f.closest('.chore'), { originEl: f, pieces: 12 }) : Promise.resolve();
  if (nowAll && celebratedOnce(`all|${kid.id}|${S.data.today}`)) {
    const b = S.data.bonus;
    const extra = b.dailyMinutes || b.dailyCents ? ` Bonus: ${bonusText({ minutes: b.dailyMinutes, cents: b.dailyCents })}` : '';
    run.then(() => Cel()?.allDone({ title: 'All done!', sub: `Great job, ${kid.name}! Every chore is checked.${extra}`, button: 'Yay!', autoCloseMs: 10000 }));
  }
  flushQueue().then(() => renderKid());
}

function uncheckChore(kid, it) {
  enqueue({ type: 'uncheck', opId: uid(), kidId: kid.id, choreId: it.choreId, period: it.period, day: S.data.today });
  renderKid();
  const fresh = $app.querySelector(`.chore[data-key="${CSS.escape(it.key)}"]`);
  if (fresh) { fresh.classList.add('uncheck'); setTimeout(() => fresh.classList.remove('uncheck'), 500); }
  if (!S.muted) softSound();
  flushQueue().then(() => renderKid());
}

/** Add an op; a check that hasn't been sent yet is simply cancelled by the matching uncheck (and vice versa). */
function enqueue(op) {
  for (let i = S.queue.length - 1; i >= 0; i--) {
    const q = S.queue[i];
    if (opKey(q) !== opKey(op)) continue;
    if (q !== S.inflight && (q.type || 'check') !== op.type) { S.queue.splice(i, 1); saveQueue(); return; }
    break;
  }
  S.queue.push(op);
  saveQueue();
}

// soft "un-check" blip: two quiet descending sine notes (WebAudio, no asset)
let actx = null;
function softSound() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    [[660, 0], [440, 0.09]].forEach(([f, at]) => {
      const t = actx.currentTime + at, o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch { /* no audio */ }
}

// ---------- sync ----------
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('focus', () => refresh());
window.addEventListener('online', () => { S.online = true; refresh(); });
window.addEventListener('offline', () => { S.online = false; renderKid(); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);

// ---------- parent mode ----------
let $sheet = null;
let idleTimer = null;
const IDLE_MS = 5 * 60 * 1000;
function sheet() {
  if (!$sheet) {
    $sheet = document.createElement('div');
    $sheet.className = 'sheet';
    document.body.appendChild($sheet);
    $sheet.addEventListener('click', onSheetClick);
    $sheet.addEventListener('input', onSheetInput);
    $sheet.addEventListener('submit', (e) => e.preventDefault());
    $sheet.addEventListener('pointerdown', bumpIdle);
  }
  return $sheet;
}
function bumpIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => closeParent(), IDLE_MS); }
function closeParent() {
  if (S.parent?.token) api('parent/logout', { method: 'POST', parent: true }).catch(() => {});
  S.parent = null; S.pin = null;
  clearTimeout(idleTimer);
  if ($sheet) { $sheet.remove(); $sheet = null; }
  refresh();
}

function openPin() {
  S.pin = { digits: '', err: '' };
  bumpIdle();
  renderPin();
}
function renderPin() {
  const p = S.pin;
  sheet().innerHTML = `<div class="pin"><div style="text-align:center">
    <div style="font-size:64px">🔒</div><h2>Grown-ups only</h2>
    <div class="dots ${p.shake ? 'shake' : ''}" style="justify-content:center">${[0, 1, 2, 3].map((i) => `<i class="${i < p.digits.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-pin="${n}">${n}</button>`).join('')}
      <button data-pin="x" aria-label="Close">✕</button><button data-pin="0">0</button><button data-pin="b" aria-label="Delete">⌫</button></div>
    <div class="err">${esc(p.err)}</div></div></div>`;
  p.shake = false;
}
async function pinKey(k) {
  const p = S.pin;
  if (k === 'x') return closeParent();
  if (k === 'b') { p.digits = p.digits.slice(0, -1); return renderPin(); }
  if (p.digits.length >= 4 || p.busy) return;
  p.digits += k; p.err = '';
  renderPin();
  if (p.digits.length === 4) {
    p.busy = true;
    try {
      const r = await api('parent/login', { method: 'POST', body: { pin: p.digits } });
      S.pin = null;
      S.parent = { token: r.token, tab: 'today', edit: null, week: null, history: null };
      renderSheet();
    } catch (e) {
      p.busy = false; p.digits = ''; p.shake = true;
      p.err = e.offline ? 'No internet.' : e.message === 'wrong PIN' ? 'Wrong PIN' : e.message;
      renderPin();
    }
  }
}

async function parentCall(path, method, body) {
  try {
    const r = await api(path, { method, body, parent: true });
    if (r.kids && r.chores && r.bonus) { setData(r); renderKid(); }
    return r;
  } catch (e) {
    if (e.status === 401) { toast('Please enter the PIN again.'); closeParent(); openPin(); }
    else toast(e.offline ? '📡 No internet. Try again.' : `⚠️ ${e.message}`, 3000);
    throw e;
  }
}

const TABS = [['today', '✅ Today'], ['chores', '🧹 Chores'], ['goals', '🏆 Goals'], ['kids', '👦 Kids'], ['rewards', '💰 Rewards'], ['history', '📊 History'], ['settings', '⚙️ Settings']];
function renderSheet() {
  const P = S.parent;
  if (!P) return;
  const body = { today: tabToday, chores: tabChores, goals: tabGoals, kids: tabKids, rewards: tabRewards, history: tabHistory, settings: tabSettings }[P.tab]();
  const y = $sheet ? $sheet.scrollTop : 0;
  sheet().innerHTML = `<div class="wrap">
    <div class="ptop"><h2>Grown-up mode</h2><button class="pbtn ghost" data-p="exit">Done 🔓</button></div>
    <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${P.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    ${body}</div>`;
  $sheet.scrollTop = P.keepScroll ? y : 0;
  P.keepScroll = false;
}
const kidChip = (k) => `<span class="kidchip" style="--kid:${esc(k.color)}"><span class="f">${face(k.avatar)}</span>${esc(k.name)}</span>`;
const daysText = (c) => (c.days.length ? c.days.map((x) => DAYS[x - 1]).join(', ') : 'any day');
const timesText = (c) => ((c.times || 1) > 1 ? ` · ${c.times}× a day${c.labels.some(Boolean) ? ` (${c.labels.filter(Boolean).map(esc).join(', ')})` : ''}${c.rewardMode === 'all' ? ', reward when all done' : ''}` : '');
const schedText0 = (c) => (c.rotation === 'daily' ? `${B('rotate')} Takes turns, a new kid each day`
  : c.rotation === 'weekly' ? `${B('rotate')} Takes turns, a new kid each week (${daysText(c)})`
  : c.schedule === 'daily' ? 'Every day' : c.days.length ? `Weekly: ${daysText(c)}` : 'Once, any day this week');
const schedText = (c) => schedText0(c) + timesText(c);
const kidById = (id) => S.data.kids.find((k) => k.id === id);
const rewardText = (m, c) => [m ? `${RM} ${m} min` : '', c ? `${RD} ${money(c)}` : ''].filter(Boolean).join(' · ') || 'No reward';

function turnsCard() {
  const d = S.data;
  const rots = d.chores.filter((c) => c.rotation);
  if (!rots.length) return '';
  return `<div class="pcard turns"><h3 style="margin-top:4px">${B('rotate')} Whose turn?</h3>${rots.map((c) => {
    const who = kidById(c.turn), next = kidById(c.next);
    const done = c.done;
    const others = c.rotKids.filter((id) => id !== c.turn).map(kidById).filter(Boolean);
    return `<div class="line" data-turn="${c.id}">${icon(c.emoji, 'em ic')}
      <div class="grow"><div class="t">${esc(c.title)}</div>
        <div class="sub">${c.rotation === 'weekly' ? 'This week' : 'Today'}: ${who ? kidChip(who) : '—'}${c.swapped ? ' <span class="muted">(swapped)</span>' : ''}${done ? ` ${B('done', 'done')}` : ''}
        · Next${c.rotation === 'weekly' ? ' week' : ''}: ${next ? esc(next.name) : '—'}</div></div>
      ${done ? '' : `<div class="row turnbtns">${c.rotKids.length > 1 ? `<button class="pbtn small ghost" data-skip="${c.id}">${B('skip')} Skip to next kid</button>` : ''}
        ${others.map((k) => `<button class="pbtn small ghost" data-swap="${c.id}|${k.id}">⇄ ${esc(k.name)} this ${c.rotation === 'weekly' ? 'week' : 'time'}</button>`).join('')}</div>`}
    </div>`;
  }).join('')}</div>`;
}

function tabToday() {
  const d = S.data;
  return `<p class="muted">${DAYS_LONG[d.dow - 1]}, ${esc(d.today)}. Tap Undo if a check was a mistake.</p>` + turnsCard() + d.kids.map((k) => `
    <div class="pcard"><h3 style="margin-top:4px">${kidChip(k)} <span class="muted" style="font-size:17px">${k.items.filter((i) => i.done).length}/${k.items.length} done${k.allDone ? ` ${B('trophy', 'all done')}` : ''}</span></h3>
    ${k.items.map((it) => `<div class="line">${icon(it.emoji, 'em ic')}
      <div class="grow"><div class="t">${esc(it.title)}${it.rot ? ` ${B('rotate', 'takes turns')}` : ''}</div><div class="sub">${it.due === 'late' ? `From ${DAYS[dayIdx(it.period)]} · ` : it.due === 'week' ? 'This week · ' : ''}${rewardText(it.minutes, it.cents)}</div></div>
      ${it.slots ? `<span class="prog ${it.done ? 'full' : ''}">${it.progress.n}/${it.progress.of}</span>${it.slots.map((sl) => sl.done
          ? `<button class="pbtn small warn" data-untick="${k.id}|${it.choreId}|${it.period}|${sl.slot}">${B('undo')} ${esc(sl.label || `#${sl.slot}`)}</button>`
          : `<button class="pbtn small ghost" data-marktick="${k.id}|${it.choreId}|${it.period}|${sl.slot}">${B('mark')} ${esc(sl.label || `#${sl.slot}`)}</button>`).join('')}`
        : it.done ? `${B('done', 'done').replace('class="b"', 'class="b big"')}<button class="pbtn small warn" data-undo="${it.completionId}">Undo</button>`
        : `<button class="pbtn small ghost" data-markdone="${k.id}|${it.choreId}|${it.period}">Mark done</button>`}
    </div>`).join('') || '<p class="muted">No chores today.</p>'}</div>`).join('');
}

function tabChores() {
  const P = S.parent, d = S.data;
  if (P.edit?.type === 'chore') return choreForm(P.edit.draft);
  const kidsById = Object.fromEntries(d.kids.map((k) => [k.id, k]));
  return `<div class="row" style="margin-bottom:12px"><button class="pbtn" data-p="addchore">＋ Add chore</button></div>
    <div class="pcard">${d.chores.map((c) => `<div class="line">${icon(c.emoji, 'em ic')}
      <div class="grow"><div class="t">${esc(c.title)}</div>
      <div class="sub">${schedText(c)} · ${rewardText(c.minutes, c.cents)}</div>
      <div style="margin-top:4px">${(c.rotation ? c.rotKids : c.kidIds).map((id) => kidsById[id]).filter(Boolean).map(kidChip).join(c.rotation ? ' → ' : '')}</div></div>
      <button class="pbtn small ghost" data-editchore="${c.id}">Edit</button></div>`).join('') || '<p class="muted">No chores yet.</p>'}</div>`;
}

function choreForm(dr) {
  const d = S.data;
  const emojis = [...new Set([...(S.theme.choreIcons || []), ...S.theme.choreEmoji, dr.emoji].filter(Boolean))];
  return `<div class="pcard"><h3 style="margin-top:4px">${dr.id ? 'Edit chore' : 'New chore'}</h3>
    <label class="f">Picture</label>
    <div class="pick" data-group="emoji">${emojis.map((e) => `<button data-set="emoji" data-v="${esc(e)}" class="${e === dr.emoji ? 'on' : ''}">${face(e)}</button>`).join('')}</div>
    <label class="f">…or type an emoji if no picture fits</label><input class="in" data-field="emoji" value="${isImg(dr.emoji) ? '' : esc(dr.emoji)}" maxlength="16" style="max-width:160px" placeholder="Emoji">
    <label class="f">Name (short!)</label><input class="in" data-field="title" value="${esc(dr.title)}" maxlength="40" placeholder="Feed the dog">
    <label class="f">Who does it?</label>
    <div class="seg"><button data-set="mode" data-v="kids" class="${dr.mode !== 'rot' ? 'on' : ''}">${B('chosen-kids')} Chosen kids</button><button data-set="mode" data-v="rot" class="${dr.mode === 'rot' ? 'on' : ''}">${B('rotate')} Take turns</button></div>
    ${dr.mode === 'rot' ? rotFields(dr) : `
    <div class="seg">${d.kids.map((k) => `<button data-togglekid="${k.id}" class="${dr.kidIds.includes(k.id) ? 'on' : ''}">${face(k.avatar)} ${esc(k.name)}</button>`).join('')}</div>
    <label class="f">How often?</label>
    <div class="seg"><button data-set="schedule" data-v="daily" class="${dr.schedule === 'daily' ? 'on' : ''}">Every day</button><button data-set="schedule" data-v="weekly" class="${dr.schedule === 'weekly' ? 'on' : ''}">Weekly</button></div>`}
    ${dr.schedule === 'weekly' || (dr.mode === 'rot' && dr.rotation === 'weekly') ? `<label class="f">${dr.mode === 'rot' ? 'Which days can it be done? (pick none for “any day”)' : 'Which days? (pick none for “any day this week”)'}</label>
      <div class="seg">${DAYS.map((n, i) => `<button data-toggleday="${i + 1}" class="${dr.days.includes(i + 1) ? 'on' : ''}">${n}</button>`).join('')}
      <button data-p="anyday" class="${dr.days.length === 0 ? 'on' : ''}">Any day</button></div>` : ''}
    <label class="f">How many times${dr.mode === 'rot' && dr.rotation === 'weekly' ? ' (on the day he does it)' : ' a day'}?</label>
    <div class="seg times">${[1, 2, 3, 4, 5, 6].map((n) => `<button data-set="times" data-v="${n}" class="${(dr.times || 1) === n ? 'on' : ''}">${n}×</button>`).join('')}</div>
    ${(dr.times || 1) > 1 ? `<label class="f">Labels (optional, e.g. AM / PM)</label>
      <div class="row">${Array.from({ length: dr.times }, (_, i) => `<input class="in" data-label="${i}" value="${esc((dr.labels || [])[i] || '')}" maxlength="10" placeholder="#${i + 1}" style="max-width:120px">`).join('')}
        ${dr.times === 2 ? '<button class="pbtn small ghost" data-p="ampm">AM / PM</button>' : ''}</div>
      <label class="f">Reward</label>
      <div class="seg"><button data-set="rewardMode" data-v="each" class="${dr.rewardMode !== 'all' ? 'on' : ''}">${B('reward-each')} For each check</button><button data-set="rewardMode" data-v="all" class="${dr.rewardMode === 'all' ? 'on' : ''}">${B('reward-all')} Only when all ${dr.times} are done</button></div>` : ''}
    <div class="row" style="align-items:flex-start">
      <div style="flex:1;min-width:150px"><label class="f">${RM} Game minutes${(dr.times || 1) > 1 ? (dr.rewardMode === 'all' ? ' (for all of them)' : ' (per check)') : ''}</label><input class="in" data-field="minutes" type="number" inputmode="numeric" min="0" max="600" value="${dr.minutes}"></div>
      <div style="flex:1;min-width:150px"><label class="f">${RD} Money ($)</label><input class="in" data-field="dollars" type="number" inputmode="decimal" min="0" step="0.25" value="${(dr.cents / 100).toFixed(2)}"></div>
    </div>
    <div class="row" style="margin-top:18px"><button class="pbtn" data-p="savechore">Save</button><button class="pbtn ghost" data-p="cancel">Cancel</button>
      ${dr.id ? '<span style="flex:1"></span><button class="pbtn warn" data-p="delchore">Remove</button>' : ''}</div></div>`;
}

function rotFields(dr) {
  const d = S.data;
  const out = d.kids.filter((k) => !dr.rotKids.includes(k.id));
  return `<label class="f">Turn order (first one goes ${dr.rotation === 'weekly' ? 'this week' : 'today'})</label>
    <div class="order">${dr.rotKids.map((id, i) => { const k = kidById(id); return k ? `<div class="oline"><span class="n">${i + 1}</span>${kidChip(k)}
      <span class="grow"></span><button class="pbtn small ghost" data-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
      <button class="pbtn small ghost" data-move="${i}|1" ${i === dr.rotKids.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
      <button class="pbtn small warn" data-rotdel="${id}" aria-label="Take out">${B('missed')}</button></div>` : ''; }).join('') || '<p class="muted">Add kids below.</p>'}</div>
    ${out.length ? `<div class="seg">${out.map((k) => `<button data-rotadd="${k.id}">＋ ${face(k.avatar)} ${esc(k.name)}</button>`).join('')}</div>` : ''}
    <label class="f">Switch kids…</label>
    <div class="seg"><button data-set="rotation" data-v="daily" class="${dr.rotation === 'daily' ? 'on' : ''}">Every day</button><button data-set="rotation" data-v="weekly" class="${dr.rotation === 'weekly' ? 'on' : ''}">Every week (do it once)</button></div>`;
}

// ---------- goals (parent side) ----------
function tabGoals() {
  const P = S.parent, d = S.data;
  if (P.edit?.type === 'goal') return goalForm(P.edit.draft);
  const goals = d.goals || [];
  const pend = [];
  for (const g of goals) for (const cl of g.claims) if (cl.status === 'pending' && kidById(cl.kidId)) pend.push([g, cl]);
  const kidStatus = (g, k) => { const cl = g.claims.find((x) => x.kidId === k.id); return cl ? cl.status : 'open'; };
  return `${pend.length ? `<div class="pcard pend"><h3 style="margin-top:4px">${B('waiting')} Waiting for you</h3>${pend.map(([g, cl]) => `<div class="line">${icon(g.emoji, 'em ic')}
      <div class="grow"><div class="t">${esc(g.title)}</div><div class="sub">${kidChip(kidById(cl.kidId))} says “I did it!” · ${esc(shortDate(cl.claimedDay))} · ${rewardText(g.minutes, g.cents)}</div></div>
      <button class="pbtn small" data-gconfirm="${g.id}|${cl.kidId}">${B('done')} Confirm</button><button class="pbtn small ghost" data-greject="${g.id}|${cl.kidId}">Not yet</button></div>`).join('')}</div>` : ''}
    <div class="row" style="margin-bottom:12px"><button class="pbtn" data-p="addgoal">＋ Add goal</button></div>
    <div class="pcard">${goals.map((g) => `<div class="line goalrow">${icon(g.emoji, 'em ic')}
      <div class="grow"><div class="t">${esc(g.title)}</div><div class="sub">${g.descr ? `${esc(g.descr)} · ` : ''}${rewardText(g.minutes, g.cents)}</div>
        <div class="gk">${g.kidIds.map(kidById).filter(Boolean).map((k) => { const st = kidStatus(g, k); const cl = g.claims.find((x) => x.kidId === k.id);
          return `<span class="gks">${kidChip(k)} ${st === 'done' ? `${B('trophy', 'done')} ${esc(shortDate(cl.confirmedDay))} <button class="pbtn small ghost" data-gunconfirm="${g.id}|${k.id}">Un-confirm</button>`
            : st === 'pending' ? B('waiting', 'waiting') : `<button class="pbtn small ghost" data-gconfirm="${g.id}|${k.id}">Mark done</button>`}</span>`; }).join('')}</div></div>
      <button class="pbtn small ghost" data-editgoal="${g.id}">Edit</button></div>`).join('') || '<p class="muted">No goals yet. Goals are one-time challenges, like “Ride a bike with no training wheels”.</p>'}</div>`;
}
const GOAL_EMOJI = ['bike', 'books', 'swim', 'soccer', 'piano', 'puzzle', 'tooth', 'climb', 'paint', 'basketball', 'star', 'rocket'].map((n) => `img:chores/${n}.svg`);
function goalForm(dr) {
  const d = S.data;
  const emojis = [...new Set([...GOAL_EMOJI, dr.emoji].filter(Boolean))];
  return `<div class="pcard"><h3 style="margin-top:4px">${dr.id ? 'Edit goal' : 'New goal'}</h3>
    <label class="f">Picture</label>
    <div class="pick">${emojis.map((e) => `<button data-set="emoji" data-v="${esc(e)}" class="${e === dr.emoji ? 'on' : ''}">${face(e)}</button>`).join('')}</div>
    <label class="f">…or type an emoji if no picture fits</label><input class="in" data-field="emoji" value="${isImg(dr.emoji) ? '' : esc(dr.emoji)}" maxlength="16" style="max-width:160px" placeholder="Emoji">
    <label class="f">Goal (short!)</label><input class="in" data-field="title" value="${esc(dr.title)}" maxlength="40" placeholder="Read 5 books">
    <label class="f">More about it (optional)</label><input class="in" data-field="descr" value="${esc(dr.descr)}" maxlength="140" placeholder="Chapter books count!">
    <label class="f">For who? (each kid does it himself)</label>
    <div class="seg">${d.kids.map((k) => `<button data-togglekid="${k.id}" class="${dr.kidIds.includes(k.id) ? 'on' : ''}">${face(k.avatar)} ${esc(k.name)}</button>`).join('')}</div>
    <div class="row" style="align-items:flex-start">
      <div style="flex:1;min-width:150px"><label class="f">${RM} Game minutes</label><input class="in" data-field="minutes" type="number" inputmode="numeric" min="0" max="600" value="${dr.minutes}"></div>
      <div style="flex:1;min-width:150px"><label class="f">${RD} Money ($)</label><input class="in" data-field="dollars" type="number" inputmode="decimal" min="0" step="0.25" value="${(dr.cents / 100).toFixed(2)}"></div>
    </div>
    <div class="row" style="margin-top:18px"><button class="pbtn" data-p="savegoal">Save</button><button class="pbtn ghost" data-p="cancel">Cancel</button>
      ${dr.id ? '<span style="flex:1"></span><button class="pbtn warn" data-p="delgoal">Remove</button>' : ''}</div></div>`;
}

function tabKids() {
  const P = S.parent, d = S.data;
  if (P.edit?.type === 'kid') return kidForm(P.edit.draft);
  return `<div class="row" style="margin-bottom:12px"><button class="pbtn" data-p="addkid">＋ Add kid</button></div>
    <div class="pcard">${d.kids.map((k) => `<div class="line kidrow"><span class="av" style="--kid:${esc(k.color)}">${face(k.avatar)}</span>
      <div class="grow"><div class="t">${esc(k.name)}</div><div class="sub">${d.chores.filter((c) => c.kidIds.includes(k.id)).length} chores</div></div>
      <button class="pbtn small ghost" data-editkid="${k.id}">Edit</button></div>`).join('')}</div>`;
}

function kidForm(dr) {
  const d = S.data;
  return `<div class="pcard"><h3 style="margin-top:4px">${dr.id ? 'Edit kid' : 'New kid'}</h3>
    <label class="f">Name</label><input class="in" data-field="name" value="${esc(dr.name)}" maxlength="24" placeholder="Name" autocomplete="off">
    <label class="f">Avatar</label>
    <div class="pick avatars">${S.theme.avatars.map((a) => `<button data-set="avatar" data-v="${esc(a)}" class="${a === dr.avatar ? 'on' : ''}">${face(a)}</button>`).join('')}</div>
    <label class="f">Color</label>
    <div class="pick colors">${S.theme.colors.map((c) => `<button data-set="color" data-v="${c}" class="${c === dr.color ? 'on' : ''}" style="background:${c}" aria-label="${c}">${c}</button>`).join('')}</div>
    ${dr.id ? '' : `<label class="f">Give the same chores as…</label>
      <div class="seg"><button data-set="copyFromKid" data-v="0" class="${!dr.copyFromKid ? 'on' : ''}">Nobody</button>
      ${d.kids.map((k) => `<button data-set="copyFromKid" data-v="${k.id}" class="${dr.copyFromKid === k.id ? 'on' : ''}">${esc(k.name)}</button>`).join('')}</div>`}
    <div class="row" style="margin-top:18px"><button class="pbtn" data-p="savekid">Save</button><button class="pbtn ghost" data-p="cancel">Cancel</button>
      ${dr.id ? '<span style="flex:1"></span><button class="pbtn warn" data-p="delkid">Remove</button>' : ''}</div></div>`;
}

function tabRewards() {
  const d = S.data, b = d.bonus;
  return d.kids.map((k) => `<div class="pcard"><h3 style="margin-top:4px">${kidChip(k)}</h3>
      <div class="row balrow"><span class="bal">${R('game-time')}${k.balance.minutes} min</span>
      <span class="bal">${R('money-coin')}${money(k.balance.cents)}</span>
      <button class="pbtn" data-payall="${k.id}">Mark all paid / used</button></div>
      <label class="f">Or pay part of it:</label>
      <div class="row"><input class="in" id="pm-${k.id}" type="number" inputmode="numeric" min="0" placeholder="Minutes" style="max-width:150px">
      <input class="in" id="pc-${k.id}" type="number" inputmode="decimal" min="0" step="0.25" placeholder="Dollars" style="max-width:150px">
      <button class="pbtn ghost" data-paypart="${k.id}">Pay</button></div></div>`).join('') + `
    <div class="pcard"><h3 style="margin-top:4px">Bonuses</h3>
      <p class="muted">All chores done for the day:</p>
      <div class="row"><label>${RM} <input class="in" id="b-dm" type="number" min="0" value="${b.dailyMinutes}" style="width:120px"> min</label>
      <label>${RD} $<input class="in" id="b-dc" type="number" min="0" step="0.25" value="${(b.dailyCents / 100).toFixed(2)}" style="width:120px"></label></div>
      <p class="muted">All done every day, Monday to Sunday:</p>
      <div class="row"><label>${RM} <input class="in" id="b-wm" type="number" min="0" value="${b.weeklyMinutes}" style="width:120px"> min</label>
      <label>${RD} $<input class="in" id="b-wc" type="number" min="0" step="0.25" value="${(b.weeklyCents / 100).toFixed(2)}" style="width:120px"></label></div>
      <p class="muted">Set to 0 to turn a bonus off.</p>
      <button class="pbtn" data-p="savebonus">Save bonuses</button></div>`;
}

function tabHistory() {
  const P = S.parent, h = P.history;
  if (!h) { loadHistory(P.week); return '<p class="muted">Loading…</p>'; }
  const fmtDay = (d) => `${DAYS[dayIdx(d)]} ${Number(d.slice(8))}`;
  const next = addDaysLocal(h.weekStart, 7);
  return `<div class="row" style="margin-bottom:12px"><button class="pbtn ghost" data-week="${addDaysLocal(h.weekStart, -7)}">◀</button>
      <strong style="font-size:20px;color:var(--on-space)">Week of ${esc(h.weekStart)}</strong>
      <button class="pbtn ghost" data-week="${next}" ${next > h.today ? 'disabled style="opacity:.4"' : ''}>▶</button></div>` +
    h.kids.map((k) => {
      const tot = k.days.reduce((a, x) => ({ m: a.m + x.earned.minutes, c: a.c + x.earned.cents, pm: a.pm + x.paid.minutes, pc: a.pc + x.paid.cents }), { m: 0, c: 0, pm: 0, pc: 0 });
      if (k.weeklyBonus) { tot.m += k.weeklyBonus.minutes; tot.c += k.weeklyBonus.cents; }
      return `<div class="pcard"><h3 style="margin-top:4px">${kidChip(k)}${k.active ? '' : ' <span class="muted">(removed)</span>'}</h3>
      ${k.days.map((x) => `<div class="hday ${x.day === h.today ? 'today' : ''}"><span class="d">${fmtDay(x.day)}${x.allDone ? R('star-badge') : ''}</span>
        <span class="ems" title="${esc(x.done.map((c) => c.title).join(', '))}">${x.done.map((c) => (c.progress ? `<span class="hmulti">${icon(c.emoji)}<b>${c.progress.n}/${c.progress.of}</b></span>` : icon(c.emoji))).join('')}${(x.partial || []).map((m) => `<span class="hmulti part" title="${esc(m.title)}: ${m.progress.n} of ${m.progress.of}">${icon(m.emoji)}<b>${m.progress.n}/${m.progress.of}</b></span>`).join('')}${(x.goals || []).map((g) => `<span class="hgoal" title="Goal: ${esc(g.title)}">${B('trophy')}${face(g.emoji)}</span>`).join('')}${(x.missed || []).map((m) => `<span class="hmiss" title="Missed turn: ${esc(m.title)}">${icon(m.emoji)}${B('missed', 'missed')}</span>`).join('')}${!x.done.length && !(x.partial || []).length && !(x.goals || []).length && !(x.missed || []).length ? '<span class="muted" style="font-size:16px">—</span>' : ''}</span>
        <span class="money">${x.earned.minutes || x.earned.cents ? `<span class="plus">+${x.earned.minutes}m +${money(x.earned.cents)}</span>` : ''}
        ${x.payouts.map((p) => `<br><span class="minus">paid −${p.minutes}m −${money(p.cents)}</span>`).join('')}</span></div>`).join('')}
      ${k.days.some((x) => (x.missed || []).length) ? `<p class="muted" style="margin:8px 0 0">${B('missed')} = missed turn: ${[...new Set(k.days.flatMap((x) => (x.missed || []).map((m) => `${m.title}${m.rotation === 'weekly' ? ' (this week)' : ` (${DAYS[dayIdx(m.day)]})`}`)))].map(esc).join(', ')}</p>` : ''}
      <p class="muted" style="margin:8px 0 0">Week: earned ${RM} ${tot.m} min, ${RD} ${money(tot.c)}${k.weeklyBonus ? ` (includes ${B('week-bonus')} week bonus)` : ''} · paid/used ${RM} ${tot.pm} min, ${RD} ${money(tot.pc)}</p></div>`;
    }).join('');
}
async function loadHistory(week) {
  try {
    const r = await parentCall(`parent/history${week ? `?week=${week}` : ''}`, 'GET');
    if (S.parent) { S.parent.history = r; if (S.parent.tab === 'history') renderSheet(); }
  } catch { /* toast shown */ }
}

function tabSettings() {
  const link = `${location.origin}/?k=${key}`;
  return `<div class="pcard"><h3 style="margin-top:4px">Change PIN</h3>
      <div class="row"><input class="in" id="pin-cur" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" style="max-width:180px">
      <input class="in" id="pin-new" type="password" inputmode="numeric" maxlength="4" placeholder="New PIN" style="max-width:180px">
      <button class="pbtn" data-p="savepin">Change</button></div></div>
    <div class="pcard"><h3 style="margin-top:4px">Family link</h3>
      <p class="muted">Open this on a new iPad or phone, then Share → Add to Home Screen. Keep it private: anyone with it can check off chores.</p>
      <input class="in" readonly value="${esc(link)}" id="famlink" style="font-size:16px">
      <div class="row" style="margin-top:10px"><button class="pbtn ghost" data-p="copylink">Copy link</button></div></div>
    <div class="pcard"><h3 style="margin-top:4px">This device</h3>
      <div class="row"><button class="pbtn ghost" data-p="mute">${S.muted ? '🔇 Sound is off' : '🔊 Sound is on'}</button>
      <button class="pbtn ghost" data-p="reload">↻ Reload app</button></div></div>`;
}

function onSheetInput(e) {
  const f = e.target.dataset.field;
  const dr = S.parent?.edit?.draft;
  if (dr && e.target.dataset.label != null) { dr.labels = dr.labels || []; dr.labels[Number(e.target.dataset.label)] = e.target.value; return; }
  if (!f || !dr) return;
  if (f === 'dollars') dr.cents = Math.round((parseFloat(e.target.value) || 0) * 100);
  else if (f === 'minutes') dr.minutes = parseInt(e.target.value, 10) || 0;
  else if (f === 'emoji') dr.emoji = toImg(e.target.value); // a known emoji saves as its SVG
  else dr[f] = e.target.value;
}

async function onSheetClick(e) {
  bumpIdle();
  const t = e.target.closest('button');
  if (!t) return;
  if (S.pin && t.dataset.pin) return pinKey(t.dataset.pin);
  const P = S.parent;
  if (!P) return;
  const ds = t.dataset;
  const d = S.data;
  const rerender = (keep = true) => { P.keepScroll = keep; renderSheet(); };

  if (ds.tab) { P.tab = ds.tab; P.edit = null; if (ds.tab === 'history') P.history = null; return rerender(false); }
  if (ds.set && P.edit) { const v = ds.v; P.edit.draft[ds.set] = ds.set === 'copyFromKid' || ds.set === 'times' ? Number(v) : v; return rerender(); }
  if (ds.togglekid && P.edit) { const id = Number(ds.togglekid); const a = P.edit.draft.kidIds; P.edit.draft.kidIds = a.includes(id) ? a.filter((x) => x !== id) : [...a, id]; return rerender(); }
  if (ds.toggleday && P.edit) { const n = Number(ds.toggleday); const a = P.edit.draft.days; P.edit.draft.days = a.includes(n) ? a.filter((x) => x !== n) : [...a, n].sort(); return rerender(); }
  if (ds.move && P.edit) { const [i, dir] = ds.move.split('|').map(Number); const a = P.edit.draft.rotKids; const j = i + dir; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; return rerender(); }
  if (ds.rotadd && P.edit) { P.edit.draft.rotKids.push(Number(ds.rotadd)); return rerender(); }
  if (ds.rotdel && P.edit) { P.edit.draft.rotKids = P.edit.draft.rotKids.filter((x) => x !== Number(ds.rotdel)); return rerender(); }
  if (ds.skip) { await parentCall('parent/turn', 'POST', { choreId: Number(ds.skip), action: 'skip' }).then(() => toast('Next kid’s turn', 2200, B('skip'))).catch(() => {}); return rerender(); }
  if (ds.swap) { const [choreId, kidId] = ds.swap.split('|').map(Number); await parentCall('parent/turn', 'POST', { choreId, kidId, action: 'swap' }).then(() => toast('⇄ Swapped')).catch(() => {}); return rerender(); }
  if (ds.gconfirm || ds.gunconfirm || ds.greject) {
    const [goalId, kidId] = (ds.gconfirm || ds.gunconfirm || ds.greject).split('|').map(Number);
    const what = ds.gconfirm ? 'goal-confirm' : ds.gunconfirm ? 'goal-unconfirm' : 'goal-reject';
    if (ds.gunconfirm && !confirm('Un-confirm this goal? Its reward comes off the balance.')) return;
    if (ds.gconfirm) celebratedOnce(`goal|${kidId}|${goalId}|${d.today}`); // the party happens here; don't replay it on this device
    try {
      const r = await parentCall(`parent/${what}`, 'POST', { goalId, kidId });
      if (ds.gconfirm && r.confirmed) {
        const g = r.goals.find((x) => x.id === goalId), k = kidById(kidId);
        Cel()?.allDone({ title: 'Goal reached!', sub: `${k?.name}: ${g?.title}! ${bonusText(g || {})}`, button: 'Yay!', autoCloseMs: 8000 });
      } else toast(ds.gunconfirm ? 'Un-confirmed' : ds.greject ? 'Back to the goal list' : 'Done', 2200, B(ds.gunconfirm ? 'undo' : ds.greject ? 'mark' : 'done'));
    } catch { /* toast shown */ }
    return rerender();
  }
  if (ds.editgoal) { const g = d.goals.find((x) => x.id === Number(ds.editgoal)); P.edit = { type: 'goal', draft: { id: g.id, emoji: g.emoji, title: g.title, descr: g.descr, kidIds: [...g.kidIds], minutes: g.minutes, cents: g.cents } }; return rerender(false); }
  if (ds.undo) { await parentCall('parent/undo', 'POST', { completionId: Number(ds.undo) }).catch(() => {}); toast('Undone', 2200, B('undo')); return rerender(); }
  if (ds.untick) {
    const [kidId, choreId, period, slot] = ds.untick.split('|');
    await parentCall('parent/untick', 'POST', { kidId: +kidId, choreId: +choreId, period, slot: +slot }).catch(() => {});
    toast('Undone', 2200, B('undo')); return rerender();
  }
  if (ds.marktick) {
    const [kidId, choreId, period, slot] = ds.marktick.split('|');
    try { const r = await api('check', { method: 'POST', body: { kidId: +kidId, choreId: +choreId, period, slot: +slot, day: d.today, opId: uid() } }); setData(r.state); renderKid(); } catch (err) { toast(`⚠️ ${err.message}`); }
    return rerender();
  }
  if (ds.markdone) {
    const [kidId, choreId, period] = ds.markdone.split('|');
    try { const r = await api('check', { method: 'POST', body: { kidId: +kidId, choreId: +choreId, period, day: d.today, opId: uid() } }); setData(r.state); renderKid(); } catch (err) { toast(`⚠️ ${err.message}`); }
    return rerender();
  }
  if (ds.editchore) {
    const c = structuredClone(d.chores.find((x) => x.id === Number(ds.editchore)));
    P.edit = { type: 'chore', draft: { ...c, mode: c.rotation ? 'rot' : 'kids', rotation: c.rotation || 'weekly', rotKids: c.rotation ? c.rotKids : [...c.kidIds] } };
    return rerender(false);
  }
  if (ds.editkid) { const k = d.kids.find((x) => x.id === Number(ds.editkid)); P.edit = { type: 'kid', draft: { id: k.id, name: k.name, avatar: k.avatar, color: k.color } }; return rerender(false); }
  if (ds.payall) {
    const k = d.kids.find((x) => x.id === Number(ds.payall));
    if (!k.balance.minutes && !k.balance.cents) return toast('Nothing to pay out.');
    if (!confirm(`Mark all of ${k.name}'s ${k.balance.minutes} min and ${money(k.balance.cents)} as paid/used?`)) return;
    await parentCall('parent/payout', 'POST', { kidId: k.id, all: true }).then(() => toast('💰 Paid out')).catch(() => {});
    return rerender();
  }
  if (ds.paypart) {
    const id = Number(ds.paypart);
    const minutes = parseInt($sheet.querySelector(`#pm-${id}`).value, 10) || 0;
    const cents = Math.round((parseFloat($sheet.querySelector(`#pc-${id}`).value) || 0) * 100);
    if (!minutes && !cents) return toast('Type minutes or dollars first.');
    await parentCall('parent/payout', 'POST', { kidId: id, minutes, cents }).then(() => toast('💰 Paid out')).catch(() => {});
    return rerender();
  }
  if (ds.week) { P.week = ds.week; P.history = null; loadHistory(ds.week); return; }

  switch (ds.p) {
    case 'exit': return closeParent();
    case 'cancel': P.edit = null; return rerender(false);
    case 'addchore': P.edit = { type: 'chore', draft: { id: null, emoji: (S.theme.choreIcons || [])[0] || S.theme.choreEmoji[0] || 'img:chores/star.svg', title: '', kidIds: d.kids.map((k) => k.id), schedule: 'daily', days: [], minutes: 5, cents: 0, mode: 'kids', rotation: 'weekly', rotKids: d.kids.map((k) => k.id), times: 1, labels: [], rewardMode: 'each' } }; return rerender(false);
    case 'ampm': P.edit.draft.labels = ['AM', 'PM']; return rerender();
    case 'anyday': P.edit.draft.days = []; return rerender();
    case 'savechore': {
      const dr = P.edit.draft;
      if (!dr.title.trim()) return toast('Give the chore a name.');
      if (dr.mode === 'rot' ? !dr.rotKids.length : !dr.kidIds.length) return toast('Pick at least one kid.');
      try {
        const body = { ...dr, rotation: dr.mode === 'rot' ? dr.rotation : '' };
        await parentCall(dr.id ? `parent/chores/${dr.id}` : 'parent/chores', dr.id ? 'PUT' : 'POST', body);
        P.edit = null; toast('Saved', 2200, B('done')); return rerender(false);
      } catch { return; }
    }
    case 'delchore': {
      if (!confirm(`Remove “${P.edit.draft.title}”? Its history stays.`)) return;
      await parentCall(`parent/chores/${P.edit.draft.id}`, 'DELETE').catch(() => {});
      P.edit = null; return rerender(false);
    }
    case 'addgoal': P.edit = { type: 'goal', draft: { id: null, emoji: GOAL_EMOJI[0], title: '', descr: '', kidIds: d.kids.map((k) => k.id), minutes: 30, cents: 0 } }; return rerender(false);
    case 'savegoal': {
      const dr = P.edit.draft;
      if (!dr.title.trim()) return toast('Give the goal a name.');
      if (!dr.kidIds.length) return toast('Pick at least one kid.');
      try {
        await parentCall(dr.id ? `parent/goals/${dr.id}` : 'parent/goals', dr.id ? 'PUT' : 'POST', dr);
        P.edit = null; toast('Saved', 2200, B('done')); return rerender(false);
      } catch { return; }
    }
    case 'delgoal': {
      if (!confirm(`Remove “${P.edit.draft.title}”? Trophies already won stay on the shelf.`)) return;
      await parentCall(`parent/goals/${P.edit.draft.id}`, 'DELETE').catch(() => {});
      P.edit = null; return rerender(false);
    }
    case 'addkid': {
      const used = new Set(d.kids.map((k) => k.avatar));
      const usedC = new Set(d.kids.map((k) => k.color));
      P.edit = { type: 'kid', draft: { id: null, name: '', avatar: S.theme.avatars.find((a) => !used.has(a)) || S.theme.avatars[0], color: S.theme.colors.find((c) => !usedC.has(c)) || S.theme.colors[0], copyFromKid: 0 } };
      rerender(false);
      setTimeout(() => $sheet?.querySelector('[data-field="name"]')?.focus(), 50);
      return;
    }
    case 'savekid': {
      const dr = P.edit.draft;
      if (!dr.name.trim()) return toast('Type a name.');
      try {
        await parentCall(dr.id ? `parent/kids/${dr.id}` : 'parent/kids', dr.id ? 'PUT' : 'POST', dr);
        P.edit = null; toast('Saved', 2200, B('done')); return rerender(false);
      } catch { return; }
    }
    case 'delkid': {
      if (!confirm(`Remove ${P.edit.draft.name}? Their history stays.`)) return;
      await parentCall(`parent/kids/${P.edit.draft.id}`, 'DELETE').catch(() => {});
      P.edit = null; return rerender(false);
    }
    case 'savebonus': {
      const v = (id) => $sheet.querySelector(id).value;
      await parentCall('parent/settings', 'PUT', {
        dailyMinutes: parseInt(v('#b-dm'), 10) || 0, dailyCents: Math.round((parseFloat(v('#b-dc')) || 0) * 100),
        weeklyMinutes: parseInt(v('#b-wm'), 10) || 0, weeklyCents: Math.round((parseFloat(v('#b-wc')) || 0) * 100),
      }).then(() => toast('Bonuses saved', 2200, B('done'))).catch(() => {});
      return rerender();
    }
    case 'savepin': {
      const cur = $sheet.querySelector('#pin-cur').value, nw = $sheet.querySelector('#pin-new').value;
      if (!/^\d{4}$/.test(nw)) return toast('New PIN must be 4 digits.');
      try {
        const r = await parentCall('parent/pin', 'PUT', { currentPin: cur, newPin: nw });
        P.token = r.token; toast('🔒 PIN changed'); return rerender();
      } catch { return; }
    }
    case 'copylink': {
      const inp = $sheet.querySelector('#famlink');
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
      return toast('📋 Copied');
    }
    case 'mute': toggleMute(); return rerender();
    case 'reload': location.reload(); return;
    default:
  }
}

// ---------- boot ----------
function setupCelebrate() {
  Cel()?.configure({ sound: S.theme.sound || '/theme/sound/check.mp3', soundFallback: S.theme.soundFallback || '/theme/sound/check.wav', volume: 0.6, muted: S.muted });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupCelebrate); else setupCelebrate();
fetch('/theme/theme.json').then((r) => r.json()).then((t) => { S.theme = { ...S.theme, ...t }; setupCelebrate(); }).catch(() => {});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // look for a new version whenever the app comes back to the foreground
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  // a new version took over: reload once so new code and images show (not while a grown-up is editing)
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    const tryReload = () => { if ($sheet || document.querySelector('.cel-done')) return setTimeout(tryReload, 30000); reloaded = true; location.reload(); };
    tryReload();
  });
}
renderKid();
refresh();

// for tests
window.__chores = { S, refresh, flushQueue };
