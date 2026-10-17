-- Reports, bans, receipts, and the moderation audit trail.
--
-- Re-runnable on purpose (see AGENTS.md): on a fresh install the full
-- `schema.sql` already creates these tables, but `d1 execute` never writes to
-- the `d1_migrations` ledger, so this file is still "pending" and will run
-- once more on the first `d1 migrations apply`. `CREATE ... IF NOT EXISTS`
-- (and no ALTER TABLE) keeps both paths safe.

-- One row per user report against a profile. `status` is the moderation
-- workflow state; `resolution` is the moderator's note, kept for the audit
-- trail. The target cascades with the account (a deleted account leaves no
-- report to review); the reporter is nulled instead, so deleting the reporter
-- never destroys evidence about the target.
--
-- `reason` has no CHECK constraint on purpose: the allowed values live in
-- `src/lib/moderation.ts` so a new reason is an app-only change. Widening a
-- CHECK later would need a table rebuild, which a re-runnable migration
-- cannot contain.
CREATE TABLE IF NOT EXISTS reports (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  target_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason         TEXT NOT NULL,
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  resolution     TEXT,
  handled_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  handled_at     INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id, target_user_id);

-- In-app receipts from moderators to the person who filed a report. One report
-- can receive several (an acknowledgement while it is open, then the outcome).
-- `read_at` is set the first time the reporter opens their report inbox and
-- drives the unread badge in the console sidebar.
CREATE TABLE IF NOT EXISTS report_receipts (
  id         TEXT PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  admin_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_report_receipts_report
  ON report_receipts (report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_report_receipts_unread
  ON report_receipts (read_at);

-- One row per account, replaced on re-ban (the audit trail keeps the history).
-- `revoked_at` marks a lifted ban; an expired `expires_at` is inactive too.
-- A NULL `expires_at` is a permanent ban.
CREATE TABLE IF NOT EXISTS user_bans (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  note       TEXT,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_bans_active ON user_bans (revoked_at, expires_at);

-- Append-only moderation log. Actor/target become NULL when an account is
-- deleted; the note and timestamp stay as the permanent record.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id             TEXT PRIMARY KEY,
  actor_id       TEXT REFERENCES users (id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  report_id      TEXT REFERENCES reports (id) ON DELETE SET NULL,
  note           TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_created ON moderation_actions (created_at);

-- Handles used by the moderation pages must not be claimable. New installs get
-- this from `schema.sql`; existing ones get it here (idempotent).
INSERT OR IGNORE INTO reserved_usernames (name) VALUES
  ('report'), ('suspended'), ('moderation'), ('reports');
