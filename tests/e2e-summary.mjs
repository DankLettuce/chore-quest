// Read-only dashboard summary: GET /api/summary with Authorization: Bearer <DASHBOARD_READ_KEY>.
// BASE=https://<your-site> LIVE=1 SECRETS_FILE=.secrets.env for a read-only live check. Never prints the keys.
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const LIVE = !!process.env.LIVE;
const ROOT = new URL('..', import.meta.url).pathname;
import { sec } from './env.mjs';
const READ = sec.DASHBOARD_READ_KEY, FAMILY = sec.FAMILY_KEY, PIN = sec.PARENT_PIN;
const ORIGIN = (sec.DASHBOARD_ORIGINS || 'https://dashboard.example.com').split(',')[0];
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const U = `${BASE}/api/summary`;
const req = (opt = {}) => fetch(U, { redirect: 'manual', ...opt });

console.log('S1. Auth');
ok((await req()).status === 401, 'no Authorization header → 401');
ok((await req({ headers: { authorization: 'Bearer wrong-key-wrong-key-wrong-key-wrong-key' } })).status === 401, 'wrong key → 401');
ok((await req({ headers: { authorization: `Basic ${READ}` } })).status === 401, 'wrong scheme → 401');
ok((await req({ headers: { authorization: `Bearer ${READ.slice(0, -1)}` } })).status === 401, 'key with one char missing → 401');
ok((await req({ headers: { authorization: `Bearer ${FAMILY}` } })).status === 401, 'the family key is not accepted as a read key');
ok((await fetch(`${U}?k=${FAMILY}`)).status === 401 && (await req({ headers: { 'x-family-key': FAMILY } })).status === 401, 'family key via ?k= or x-family-key → 401');
const unauth = await (await req()).text();
ok(!/kids|balance|Alex/.test(unauth), 'a 401 body leaks no data');

console.log('\nS2. Read only');
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const r = await req({ method: m, headers: { authorization: `Bearer ${READ}`, 'content-type': 'application/json' }, body: '{"kidId":1,"choreId":1}' });
  ok(r.status === 405 && /GET/.test(r.headers.get('allow') || ''), `${m} with the right key → 405`);
}
const before = await (await req({ headers: { authorization: `Bearer ${READ}` } })).json();
const st = (await fetch(`${BASE}/api/check`, { method: 'POST', headers: { authorization: `Bearer ${READ}`, 'content-type': 'application/json' }, body: '{}' })).status;
ok(st === 401, `the read key can't call write endpoints (/api/check → ${st})`);
ok((await fetch(`${BASE}/api/state`, { headers: { authorization: `Bearer ${READ}` } })).status === 401, 'the read key can’t open the full app state');

console.log('\nS3. Shape + no secrets');
const r = await req({ headers: { authorization: `Bearer ${READ}` } });
ok(r.status === 200 && /application\/json/.test(r.headers.get('content-type')) && r.headers.get('cache-control') === 'no-store', 'right key → 200 JSON, no-store');
const s = await r.json(), txt = JSON.stringify(s);
ok(typeof s.today === 'string' && s.kids.length >= 2 && s.kids.every((k) => k.name && k.balance && Array.isArray(k.today.chores) && k.progress.week.length === 7 && typeof k.progress.day.total === 'number' && Array.isArray(k.goals)), `kids with balances, today's chores, daily + weekly progress, goals (${s.kids.map((k) => k.name).join(', ')})`);
ok(JSON.stringify(before.kids.map((k) => k.balance)) === JSON.stringify(s.kids.map((k) => k.balance)), 'repeat reads change nothing');
ok(!txt.includes(FAMILY) && !txt.includes(READ), 'no family key or read key in the body');
ok(!/pin|hash|token|family_key|sealed|session|secret/i.test(Object.keys(flat(s)).join(' ')), 'no PIN / hash / token / session fields');
if (!LIVE) {
  const db = execFileSync('npx', ['wrangler', 'd1', 'execute', 'chore-quest', '--local', '--json', '--command', "SELECT v FROM settings WHERE k LIKE '%hash%' OR k LIKE '%pin%' OR k LIKE '%key%'"], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const vals = JSON.parse(db)[0].results.map((x) => String(x.v)).filter((v) => v.length >= 8);
  ok(vals.length > 0 && vals.every((v) => !txt.includes(v)), `none of the ${vals.length} stored secret values (PIN hash, key hash, sealed key) appear`);
}
ok(!txt.includes(`"${PIN}"`), 'the PIN does not appear');

console.log('\nS4. CORS');
const pre = await fetch(U, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN && /authorization/i.test(pre.headers.get('access-control-allow-headers') || '') && !/POST/.test(pre.headers.get('access-control-allow-methods')), 'dashboard origin: preflight allowed for GET + Authorization');
const evil = await req({ headers: { authorization: `Bearer ${READ}`, origin: 'https://evil.example' } });
ok(!evil.headers.get('access-control-allow-origin'), 'other origins get no CORS header');

function flat(o, p = '', out = {}) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flat(v, `${p}.${k}`, out); else out[p] = o; return out; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
