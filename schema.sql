-- EarthOL Player Profile · full schema (single version)
-- Apply with `npm run db:init` (local) or `npm run db:init:remote` (production).
-- Incremental changes for EXISTING deployments live in `migrations/` — apply
-- them with `npm run db:migrate` (local) or `npm run db:migrate:remote`.

-- ------------------------------------------------------------------ users
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  username      TEXT UNIQUE,
  display_name  TEXT,
  headline      TEXT,
  bio           TEXT,
  avatar_url    TEXT,
  location      TEXT,
  website       TEXT,
  pronouns      TEXT,
  theme         TEXT NOT NULL DEFAULT 'default',
  visibility    TEXT NOT NULL DEFAULT 'public',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_users_username ON users (username);

-- One account can be reached through multiple auth providers.
CREATE TABLE identities (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  email             TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_identities_user ON identities (user_id);

-- Free-form key/value pairs shown on the profile page (stats, handles, links, …).
CREATE TABLE fields (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  value       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_fields_user ON fields (user_id, sort_order);

-- Single-use magic-link tokens. Only the SHA-256 hash is stored.
CREATE TABLE login_tokens (
  token_hash   TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_login_tokens_email ON login_tokens (email);

-- One TOTP factor per user (authenticator-app sign-in). A factor only counts
-- for sign-in once it has been confirmed with a valid code; `last_step` blocks
-- replaying an already-accepted code.
CREATE TABLE totp_factors (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret     TEXT NOT NULL,
  confirmed  INTEGER NOT NULL DEFAULT 0,
  last_step  INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Handles that cannot be claimed because they collide with routes or brands.
CREATE TABLE reserved_usernames (
  name TEXT PRIMARY KEY
);

INSERT INTO reserved_usernames (name) VALUES
  ('login'), ('logout'), ('signin'), ('signup'), ('register'),
  ('dashboard'), ('onboarding'), ('settings'), ('account'), ('profile'),
  ('auth'), ('api'), ('admin'), ('health'), ('partials'), ('assets'),
  ('about'), ('help'), ('terms'), ('privacy'), ('pricing'), ('blog'),
  ('u'), ('www'), ('cdn-cgi'), ('favicon.ico'), ('robots.txt'),
  ('sitemap.xml'), ('styles.css'), ('app.js'), ('new'), ('edit'), ('me'),
  ('report'), ('suspended'), ('moderation'), ('reports');

-- Key/value configuration managed from the admin panel.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------- tag categories
-- Categories (name + color) are managed from the admin panel; users attach
-- free-text tags to a category from their dashboard.
CREATE TABLE tag_categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT 'sky',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO tag_categories (id, name, color, sort_order, created_at) VALUES
  ('seed-cat-social',      'Social',       'sky',     0, strftime('%s', 'now') * 1000),
  ('seed-cat-playstyle',   'Playstyle',    'violet',  1, strftime('%s', 'now') * 1000),
  ('seed-cat-interests',   'Interests',    'emerald', 2, strftime('%s', 'now') * 1000),
  ('seed-cat-achievement', 'Achievements', 'amber',   3, strftime('%s', 'now') * 1000);

-- ------------------------------------------------------------------- tags
CREATE TABLE user_tags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tag_categories (id) ON DELETE CASCADE,
  value       TEXT NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_user_tags_user ON user_tags (user_id, sort_order);
CREATE INDEX idx_user_tags_category ON user_tags (category_id);
CREATE INDEX idx_user_tags_value ON user_tags (category_id, value);

-- ------------------------------------------------------------------ follows
-- Directed follow edges: `follower_id` follows `following_id`. One row per
-- pair (composite PK); both FKs cascade on user deletion. `idx_follows_following`
-- covers follower count/list queries; the PK covers `WHERE follower_id = ?`.
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX idx_follows_following ON follows (following_id);

-- -------------------------------------------------------- profile blocks
-- Modular profile content: a user assembles an ordered list of blocks (a text
-- block or a gallery block), each carrying its own audience. The CHECK
-- constraints are the storage contract shared with `src/db/types.ts` — the
-- table itself rejects an unknown `kind`/`visibility`, a 'text' block without
-- a body, and a 'gallery' block without items. `idx_profile_blocks_user`
-- covers the per-user list ordered by `sort_order`; the FK cascades on user
-- deletion. Same definition as `migrations/0003_create_profile_blocks.sql`.
--
-- `required_tag` / `min_follow_days` are LEGACY: `migrations/0004` folded their
-- values into `profile_block_rules` and cleared them. The columns stay (SQLite
-- cannot drop them without a one-shot rebuild) but nothing reads or writes them.
CREATE TABLE profile_blocks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  title            TEXT,
  body             TEXT,
  items            TEXT,
  visibility       TEXT NOT NULL DEFAULT 'public',
  required_tag     TEXT,
  min_follow_days  INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (kind IN ('text', 'gallery')),
  CHECK (visibility IN ('public', 'users', 'same_tag', 'self')),
  CHECK (kind <> 'text' OR body IS NOT NULL),
  CHECK (kind <> 'gallery' OR items IS NOT NULL),
  CHECK (min_follow_days IS NULL OR min_follow_days >= 0)
);

CREATE INDEX idx_profile_blocks_user ON profile_blocks (user_id, sort_order);

-- Per-block audience refinements, as a 1:1 satellite of `profile_blocks` (the
-- table is deliberately left untouched so `migrations/0004` stays idempotent).
-- Every column is optional; the row exists only while the block carries a rule.
-- Same definition as `migrations/0004_profile_block_rules.sql`.
CREATE TABLE profile_block_rules (
  block_id             TEXT PRIMARY KEY REFERENCES profile_blocks (id) ON DELETE CASCADE,
  relation             TEXT,
  required_tags        TEXT,
  tag_match            TEXT NOT NULL DEFAULT 'any',
  excluded_tags        TEXT,
  min_follow_days      INTEGER,
  min_account_age_days INTEGER,
  visible_from         INTEGER,
  visible_until        INTEGER,
  CHECK (relation IS NULL OR relation IN ('followers', 'following', 'mutual')),
  CHECK (tag_match IN ('any', 'all')),
  CHECK (min_follow_days IS NULL OR min_follow_days >= 0),
  CHECK (min_account_age_days IS NULL OR min_account_age_days >= 0),
  CHECK (visible_until IS NULL OR visible_from IS NULL OR visible_from < visible_until)
);

CREATE INDEX idx_profile_block_rules_relation ON profile_block_rules (relation);

-- Explicit per-user allow/deny lists for a block: `allow` narrows the audience
-- to a named set, `deny` excludes named accounts. Both cascade with the block
-- and with the referenced user, so a deleted account leaves no dangling id.
-- Same definition as `migrations/0004_profile_block_rules.sql`.
CREATE TABLE profile_block_viewers (
  block_id TEXT NOT NULL REFERENCES profile_blocks (id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  PRIMARY KEY (block_id, user_id),
  CHECK (kind IN ('allow', 'deny'))
);

CREATE INDEX idx_profile_block_viewers_user ON profile_block_viewers (user_id);

-- -------------------------------------------------------- profile layout
-- Where the key/value "fields" card sits among the profile blocks: the number
-- of blocks that come before it (0 = first, N = last). The identity card is
-- fixed at the top and is not part of this ordering. One row per user; absent
-- means position 0. The FK cascades on user deletion. Same definition as
-- `migrations/0005_profile_layout.sql`.
CREATE TABLE profile_layout (
  user_id         TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  fields_position INTEGER NOT NULL DEFAULT 0,
  CHECK (fields_position >= 0)
);

-- ------------------------------------------------------------ moderation
-- Reports, bans, and the moderation audit trail. Same definitions as
-- `migrations/0006_moderation.sql` (see the comments there for the design
-- rules: app-level `reason` values, one ban row per account, append-only log).
CREATE TABLE reports (
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

CREATE INDEX idx_reports_target ON reports (target_user_id, created_at);
CREATE INDEX idx_reports_status ON reports (status, created_at);
CREATE INDEX idx_reports_reporter ON reports (reporter_id, target_user_id);

CREATE TABLE user_bans (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  note       TEXT,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_user_bans_active ON user_bans (revoked_at, expires_at);

CREATE TABLE moderation_actions (
  id             TEXT PRIMARY KEY,
  actor_id       TEXT REFERENCES users (id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  report_id      TEXT REFERENCES reports (id) ON DELETE SET NULL,
  note           TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_moderation_actions_created ON moderation_actions (created_at);

-- In-app receipts from moderators to the reporter. One report may receive
-- several; `read_at` is set when the reporter first opens `/reports` and drives
-- the unread badge. Same definition as `migrations/0006_moderation.sql`.
CREATE TABLE report_receipts (
  id         TEXT PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  admin_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);

CREATE INDEX idx_report_receipts_report ON report_receipts (report_id, created_at);
CREATE INDEX idx_report_receipts_unread ON report_receipts (read_at);
