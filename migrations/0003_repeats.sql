-- 0003: multi-times-per-day chores. Additive only.
-- Apply each statement once; ALTERs fail harmlessly with "duplicate column" if already applied.
ALTER TABLE chores ADD COLUMN times INTEGER NOT NULL DEFAULT 1;          -- checks per day (1-6)
ALTER TABLE chores ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';        -- JSON, e.g. ["AM","PM"]
ALTER TABLE chores ADD COLUMN reward_mode TEXT NOT NULL DEFAULT 'each'; -- 'each' check | 'all' done
-- One row per ticked repeat. When every repeat of a period is ticked, the usual `completions`
-- row is added too (that's what "done", the all-done bonus, streaks and history use).
-- Rewards: mode 'each' -> on these rows (completion row is 0); mode 'all' -> on the completion row.
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
-- starter chore (data): convert the existing "Brush teeth" to 2x a day, AM/PM, reward when both are done
-- UPDATE chores SET times = 2, labels = '["AM","PM"]', reward_mode = 'all', minutes = 5 WHERE id = <teeth id>;
