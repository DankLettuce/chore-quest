// Runs every suite in order against a local `npm run dev:test` server (http://127.0.0.1:8788).
// e2e-narrow reuses the state e2e-icons leaves behind, so the order matters.
import { execFileSync } from 'node:child_process';
const suites = ['unit', 'unit-progress', 'e2e', 'e2e-multi', 'e2e-rot-goals', 'e2e-progress', 'e2e-summary', 'e2e-icons', 'e2e-narrow'];
const failed = [];
for (const s of suites) {
  console.log(`\n===== ${s} =====`);
  try { execFileSync('node', [`tests/${s}.mjs`], { stdio: 'inherit' }); } catch { failed.push(s); }
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nall suites passed');
process.exit(failed.length ? 1 : 0);
