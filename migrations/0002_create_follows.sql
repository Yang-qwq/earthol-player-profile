-- Migration 0002 · Follows (`src/db/queries.ts`).
-- A directed edge: `follower_id` follows `following_id`. Incremental change for
-- EXISTING deployments: apply with `npm run db:migrate` (local) or
-- `npm run db:migrate:remote` (production). Fresh installs get the same table
-- from `schema.sql` directly — the IF NOT EXISTS guard keeps both paths safe.
-- Tracked and ordered by `wrangler d1 migrations` (state lives in the
-- `d1_migrations` table, so files apply exactly once).
--
-- Both FKs cascade so deleting a user removes every edge they own, in either
-- direction. The composite PK means a pair is followed at most once and
-- doubles as the index for `WHERE follower_id = ?`; the added index covers
-- `WHERE following_id = ?` (follower counts / lists). The CHECK keeps a user
-- from following themselves (enforced in app code too).
CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);
