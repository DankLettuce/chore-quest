-- 0002: rotating chores + goals. Additive only (new columns with defaults, new tables).
-- Apply each statement once; ALTERs fail harmlessly with "duplicate column" if already applied.
ALTER TABLE chores ADD COLUMN rotation TEXT NOT NULL DEFAULT '';     -- '' (normal) | 'daily' | 'weekly'
ALTER TABLE chores ADD COLUMN rot_plan TEXT NOT NULL DEFAULT '[]';   -- JSON anchors, see functions/_lib/rotation.js
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
