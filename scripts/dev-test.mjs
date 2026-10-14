// Local test server: builds, then runs `wrangler pages dev` with the test clock enabled and the
// FAKE credentials from tests/test.env. Never use ALLOW_TEST_CLOCK in production.
import { execFileSync, spawn } from 'node:child_process';
import { sec } from '../tests/env.mjs';
execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' });
const b = ['ALLOW_TEST_CLOCK=1', `DASHBOARD_READ_KEY=${sec.DASHBOARD_READ_KEY}`, `DASHBOARD_ORIGINS=${sec.DASHBOARD_ORIGINS}`];
spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', '8788', '--ip', '127.0.0.1', ...b.flatMap((x) => ['--binding', x])], { stdio: 'inherit' });
