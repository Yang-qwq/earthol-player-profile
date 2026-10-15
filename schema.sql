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
  ('sitemap.xml'), ('styles.css'), ('app.js'), ('new'), ('edit'), ('me');

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
