// Shared local-D1 reset for the e2e suites: schema + additive migrations + reset + seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SECRETS_FILE } from './env.mjs';
export function resetLocal(ROOT, { singleTeeth = false } = {}) {
  const wr = (...a) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'chore-quest', '--local', ...a], { cwd: ROOT, stdio: 'pipe' });
  const migrate = () => {
    for (const f of ['0002_rotations_goals.sql', '0003_repeats.sql']) {
      const m = readFileSync(`${ROOT}migrations/${f}`, 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
      for (const st of m.split(';').map((x) => x.trim()).filter(Boolean)) { try { wr('--command', st); } catch { /* already applied / no table yet */ } }
    }
  };
  migrate();                     // older local DB: add the new columns before schema.sql's seed uses them
  wr('--file', 'schema.sql');
  migrate();
  wr('--file', 'tests/reset.sql');
  wr('--file', 'schema.sql');
  execFileSync('node', ['scripts/seed.mjs', '--local'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, SECRETS_FILE } });
  // tests run on a simulated clock (Oct 2026): starter chores must already exist then, whatever the real date
  wr('--command', "UPDATE chores SET created_at = '2026-01-01 12:00:00'");
  // the older suites were written for a single "Brush teeth" check
  if (singleTeeth) wr('--command', "UPDATE chores SET times = 1, labels = '[]', reward_mode = 'each' WHERE title = 'Brush teeth'");
  return wr;
}
