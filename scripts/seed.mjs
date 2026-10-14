// Creates (once) the family key and parent PIN in .secrets.env (or $SECRETS_FILE), then writes their hashes
// into D1. INSERT OR IGNORE: re-running never resets a PIN that was changed in the app.
// Usage: node scripts/seed.mjs --local | --remote
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, randomInt, createHash, pbkdf2Sync } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const where = process.argv.includes('--remote') ? '--remote' : '--local';
const SECRETS = process.env.SECRETS_FILE || new URL('../.secrets.env', import.meta.url).pathname;

function makePin() {
  for (;;) {
    const p = String(randomInt(0, 10000)).padStart(4, '0');
    const d = [...p].map(Number);
    const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1) || d.every((x, i) => i === 0 || x === d[i - 1] - 1);
    if (new Set(d).size >= 3 && !run && !/^(19|20)\d\d$/.test(p)) return p;
  }
}

let env = {};
if (existsSync(SECRETS)) {
  for (const line of readFileSync(SECRETS, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}
const had = env.FAMILY_KEY && env.PARENT_PIN;
if (!env.FAMILY_KEY) env.FAMILY_KEY = randomBytes(24).toString('base64url'); // 32 chars
if (!env.PARENT_PIN) env.PARENT_PIN = makePin();
// only write when something was generated; keep any other lines (e.g. DASHBOARD_READ_KEY)
if (!had) writeFileSync(SECRETS, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

const keyHash = createHash('sha256').update(env.FAMILY_KEY).digest('hex');
const salt = randomBytes(16).toString('hex');
const pinHash = `pbkdf2$100000$${salt}$${pbkdf2Sync(env.PARENT_PIN, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`;

// PIN-sealed copy of the family key (same format as functions/_lib/crypto.js sealKey)
const { subtle } = globalThis.crypto;
const ksalt = randomBytes(16), iv = randomBytes(12);
const base = await subtle.importKey('raw', new TextEncoder().encode(env.PARENT_PIN), 'PBKDF2', false, ['deriveKey']);
const aes = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: ksalt, iterations: 100000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(env.FAMILY_KEY)));
const sealed = `v1$${ksalt.toString('hex')}$${iv.toString('hex')}$${ct.toString('hex')}`;

const file = new URL(`../seed.${where.slice(2)}.sql`, import.meta.url);
writeFileSync(file, `INSERT OR IGNORE INTO settings (k, v) VALUES ('family_key_hash', '${keyHash}');
INSERT OR IGNORE INTO settings (k, v) VALUES ('pin_hash', '${pinHash}');
INSERT OR IGNORE INTO settings (k, v) VALUES ('family_key_enc', '${sealed}');
`);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'chore-quest', where, '--file', file.pathname, ...(where === '--remote' ? ['--yes'] : [])], { stdio: 'inherit' });
console.log(`seeded ${where.slice(2)} D1. Family key and PIN are in ${SECRETS}`);
