-- Chore Quest, D1 schema (idempotent).
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,           -- emoji, or "img:<path under /theme/>"
  color TEXT NOT NULL DEFAULT '#3b82f6',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emoji TEXT NOT NULL,            -- emoji, or "img:chores/<name>.svg"
  title TEXT NOT NULL,
  kid_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of kid ids
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily','weekly')),
  days TEXT NOT NULL DEFAULT '',        -- weekly: comma list of ISO weekdays 1=Mon..7=Sun; '' = any day this week
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rotation TEXT NOT NULL DEFAULT '',    -- '' | 'daily' | 'weekly' (take turns; see migrations/0002)
  rot_plan TEXT NOT NULL DEFAULT '[]',
  times INTEGER NOT NULL DEFAULT 1,     -- repeats per day (see migrations/0003)
  labels TEXT NOT NULL DEFAULT '[]',
  reward_mode TEXT NOT NULL DEFAULT 'each'
);

-- One row per finished occurrence. period = the day (YYYY-MM-DD) for daily and
-- day-pinned weekly chores, or the Monday of the week for 'any day' weekly chores.
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id INTEGER NOT NULL,
  kid_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  day TEXT NOT NULL,              -- New York date it was checked off
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  emoji TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  op_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chore_id, kid_id, period)
);
CREATE INDEX IF NOT EXISTS completions_kid_day ON completions (kid_id, day);

-- kind 'daily': all of the day's chores done (row kept even if the bonus is 0, used for streaks)
-- kind 'weekly': all-done streak Mon-Sun. period = day or week Monday.
CREATE TABLE IF NOT EXISTS bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly')),
  period TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kid_id, kind, period)
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payouts_kid ON payouts (kid_id, day);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Rotations and goals (also in migrations/0002_rotations_goals.sql for existing databases)
CREATE TABLE IF NOT EXISTS rotation_overrides (
  chore_id INTEGER NOT NULL,
  period TEXT NOT NULL,           -- day (daily rotation) or week Monday (weekly rotation)
  kid_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chore_id, period)
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emoji TEXT NOT NULL,
  title TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  kid_ids TEXT NOT NULL DEFAULT '[]',
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- one per goal per kid: 'pending' (kid tapped "I did it!") or 'done' (grown-up confirmed; rewards count)
CREATE TABLE IF NOT EXISTS goal_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  kid_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  claimed_day TEXT NOT NULL,
  confirmed_day TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,  -- reward locked in at confirmation
  cents INTEGER NOT NULL DEFAULT 0,
  emoji TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (goal_id, kid_id)
);

-- Repeats (also in migrations/0003_repeats.sql)
CREATE TABLE IF NOT EXISTS repeat_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id INTEGER NOT NULL,
  kid_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  slot INTEGER NOT NULL,          -- 1..times
  day TEXT NOT NULL,              -- New York date it was ticked
  minutes INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0,
  op_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chore_id, kid_id, period, slot)
);
CREATE INDEX IF NOT EXISTS repeat_checks_kid ON repeat_checks (kid_id, period);

-- Starter data, inserted only once (guarded by the 'seeded' setting).
INSERT INTO kids (id, name, avatar, color, sort) SELECT 1, 'Alex', 'img:avatars/avatar-astronaut.svg', '#19C3C8', 1 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO kids (id, name, avatar, color, sort) SELECT 2, 'Sam', 'img:avatars/avatar-robot.svg', '#8B5CF6', 2 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/make-bed.svg', 'Make your bed', '[1,2]', 'daily', '', 5, 0, 1 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort, times, labels, reward_mode) SELECT 'img:chores/brush-teeth.svg', 'Brush teeth', '[1,2]', 'daily', '', 5, 0, 2, 2, '["AM","PM"]', 'all' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/get-dressed.svg', 'Get dressed', '[1,2]', 'daily', '', 5, 0, 3 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/backpack.svg', 'Pack backpack', '[1,2]', 'daily', '', 5, 0, 4 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/tidy-toys.svg', 'Pick up toys', '[1,2]', 'daily', '', 5, 0, 5 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/take-out-trash.svg', 'Take out trash', '[1]', 'weekly', '1,4', 10, 50, 6 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');
INSERT INTO chores (emoji, title, kid_ids, schedule, days, minutes, cents, sort) SELECT 'img:chores/laundry.svg', 'Put away laundry', '[1,2]', 'weekly', '', 10, 100, 7 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE k = 'seeded');

INSERT OR IGNORE INTO settings (k, v) VALUES
  ('daily_bonus_minutes', '10'),
  ('daily_bonus_cents', '0'),
  ('weekly_bonus_minutes', '30'),
  ('weekly_bonus_cents', '200'),
  ('seeded', '1');
