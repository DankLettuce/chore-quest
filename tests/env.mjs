// Test credentials. tests/test.env holds FAKE values used only against a local `wrangler pages dev`
// (see `npm run dev:test`). Override with SECRETS_FILE=/path/to/file for a live, read-only run.
import { readFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
export const SECRETS_FILE = process.env.SECRETS_FILE || `${ROOT}tests/test.env`;
export const sec = Object.fromEntries(readFileSync(SECRETS_FILE, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
