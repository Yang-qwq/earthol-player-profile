/**
 * All D1 access lives here: one function per query, grouped by table with
 * section banners below. Callers pass a `D1Database` (usually `c.env.DB`) and
 * never build SQL themselves.
 */
import type {
  BanStateRow,
  BlockInput,
  BlockKind,
  BlockRelation,
  BlockViewerRow,
  BlockVisibility,
  FieldInput,
  FieldRow,
  IdentityRow,
  LoginTokenRow,
  ModerationActionRow,
  ProfileBlockRow,
  ProfileInput,
  ReportReceiptRow,
  ReportRow,
  ReportStatus,
  TagCategoryRow,
  TagInput,
  TagMatch,
  TotpFactorRow,
  UserBanRow,
  UserRow,
  UserTagRow,
} from './types';
import { text } from '../lib/validate';
import { isBlockRelation, tagMatchOf } from '../lib/audience';

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

/* ------------------------------- users ------------------------------- */

export function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE username = ?')
    .bind(username.toLowerCase())
    .first<UserRow>();
}

export function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<UserRow>();
}

export async function createUser(
  db: D1Database,
  input: {
    email?: string | null;
    username?: string | null;
    theme?: string;
    visibility?: string;
  },
): Promise<UserRow> {
  const ts = now();
  const id = newId();
  const isFirstUser = (await count(db, 'SELECT COUNT(*) AS n FROM users')) === 0;
  await db
    .prepare(
      `INSERT INTO users (id, email, username, theme, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.email?.toLowerCase() ?? null,
      input.username?.toLowerCase() ?? null,
      input.theme ?? 'default',
      input.visibility ?? 'public',
      ts,
      ts,
    )
    .run();
  if (isFirstUser) {
    // First registered user bootstraps admin. The NOT EXISTS guard keeps this
    // to at most one auto-promotion.
    await db
      .prepare(
        `UPDATE users SET is_admin = 1 WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)`,
      )
      .bind(id)
      .run();
  }
  const user = await getUserById(db, id);
  if (!user) throw new Error('createUser: insert succeeded but row not found');
  return user;
}

export async function claimUsername(
  db: D1Database,
  userId: string,
  username: string,
  displayName: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?')
    .bind(username.toLowerCase(), displayName, now(), userId)
    .run();
}

export async function updateProfile(
  db: D1Database,
  userId: string,
  input: ProfileInput,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET
         username = ?, display_name = ?, headline = ?, bio = ?, avatar_url = ?,
         location = ?, website = ?, pronouns = ?, theme = ?, visibility = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.username.toLowerCase(),
      input.displayName,
      input.headline,
      input.bio,
      input.avatarUrl,
      input.location,
      input.website,
      input.pronouns,
      input.theme,
      input.visibility,
      now(),
      userId,
    )
    .run();
}

export async function isUsernameTaken(db: D1Database, username: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM users WHERE username = ?')
    .bind(username.toLowerCase())
    .first<{ x: number }>();
  return row !== null;
}

export async function isUsernameTakenByOther(
  db: D1Database,
  username: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM users WHERE username = ? AND id != ?')
    .bind(username.toLowerCase(), userId)
    .first<{ x: number }>();
  return row !== null;
}

export async function isUsernameReserved(db: D1Database, username: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM reserved_usernames WHERE name = ?')
    .bind(username.toLowerCase())
    .first<{ x: number }>();
  return row !== null;
}

export async function listUsernames(db: D1Database, limit = 50): Promise<UserRow[]> {
  const result = await db
    .prepare(
      `SELECT u.* FROM users u
       WHERE u.username IS NOT NULL AND u.visibility = 'public'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )
       ORDER BY u.updated_at DESC LIMIT ?`,
    )
    .bind(now(), limit)
    .all<UserRow>();
  return result.results ?? [];
}

/* ----------------------------- identities ----------------------------- */

export function findIdentity(
  db: D1Database,
  provider: string,
  providerUserId: string,
): Promise<IdentityRow | null> {
  return db
    .prepare('SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?')
    .bind(provider, providerUserId)
    .first<IdentityRow>();
}

export async function listIdentities(db: D1Database, userId: string): Promise<IdentityRow[]> {
  const result = await db
    .prepare('SELECT * FROM identities WHERE user_id = ? ORDER BY created_at ASC')
    .bind(userId)
    .all<IdentityRow>();
  return result.results ?? [];
}

export async function createIdentity(
  db: D1Database,
  input: { userId: string; provider: string; providerUserId: string; email?: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO identities (id, user_id, provider, provider_user_id, email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      input.userId,
      input.provider,
      input.providerUserId,
      input.email?.toLowerCase() ?? null,
      now(),
    )
    .run();
}

/* -------------------------------- fields ------------------------------ */

export async function listFields(db: D1Database, userId: string): Promise<FieldRow[]> {
  const result = await db
    .prepare('SELECT * FROM fields WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .bind(userId)
    .all<FieldRow>();
  return result.results ?? [];
}

export async function replaceFields(
  db: D1Database,
  userId: string,
  fields: FieldInput[],
): Promise<void> {
  const statements = [db.prepare('DELETE FROM fields WHERE user_id = ?').bind(userId)];
  fields.forEach((field, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO fields (id, user_id, label, value, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), userId, field.label, field.value, index, now()),
    );
  });
  await db.batch(statements);
}

/* --------------------------- tag categories --------------------------- */

export async function listTagCategories(db: D1Database): Promise<TagCategoryRow[]> {
  const result = await db
    .prepare('SELECT * FROM tag_categories ORDER BY sort_order ASC, created_at ASC')
    .all<TagCategoryRow>();
  return result.results ?? [];
}

export function getTagCategory(db: D1Database, id: string): Promise<TagCategoryRow | null> {
  return db.prepare('SELECT * FROM tag_categories WHERE id = ?').bind(id).first<TagCategoryRow>();
}

export function findTagCategoryByName(
  db: D1Database,
  name: string,
): Promise<TagCategoryRow | null> {
  return db
    .prepare('SELECT * FROM tag_categories WHERE lower(name) = ?')
    .bind(name.trim().toLowerCase())
    .first<TagCategoryRow>();
}

export async function createTagCategory(
  db: D1Database,
  name: string,
  color: string,
): Promise<void> {
  const ts = now();
  const order = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tag_categories')
    .first<{ n: number }>();
  await db
    .prepare(
      `INSERT INTO tag_categories (id, name, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), name.trim(), color, order?.n ?? 0, ts)
    .run();
}

export async function updateTagCategory(
  db: D1Database,
  id: string,
  name: string,
  color: string,
): Promise<void> {
  await db
    .prepare('UPDATE tag_categories SET name = ?, color = ? WHERE id = ?')
    .bind(name.trim(), color, id)
    .run();
}

export async function deleteTagCategory(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM user_tags WHERE category_id = ?').bind(id),
    db.prepare('DELETE FROM tag_categories WHERE id = ?').bind(id),
  ]);
}

/* -------------------------------- tags --------------------------------- */

export async function listUserTags(db: D1Database, userId: string): Promise<UserTagRow[]> {
  const result = await db
    .prepare(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM user_tags t
       JOIN tag_categories c ON c.id = t.category_id
       WHERE t.user_id = ?
       ORDER BY t.sort_order ASC, t.created_at ASC`,
    )
    .bind(userId)
    .all<UserTagRow>();
  return result.results ?? [];
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Community tag recommendations for a category: the most-used values, filtered
 * by a case-insensitive substring match. Only tags belonging to non-private
 * profiles are surfaced, so private pages never leak their values.
 */
export async function listTagSuggestions(
  db: D1Database,
  categoryId: string,
  query: string,
  limit = 8,
): Promise<string[]> {
  const q = query.trim();
  const banFilter = `NOT EXISTS (
    SELECT 1 FROM user_bans b
    WHERE b.user_id = u.id AND b.revoked_at IS NULL
      AND (b.expires_at IS NULL OR b.expires_at > ?)
  )`;
  const statement = q
    ? db
        .prepare(
          `SELECT t.value AS value, COUNT(*) AS uses
           FROM user_tags t
           JOIN users u ON u.id = t.user_id
           WHERE t.category_id = ? AND u.visibility != 'private' AND t.hidden = 0
             AND ${banFilter}
             AND t.value LIKE ? ESCAPE '\\'
           GROUP BY t.value
           ORDER BY uses DESC, t.value ASC
           LIMIT ?`,
        )
        .bind(categoryId, now(), `%${escapeLike(q)}%`, limit)
    : db
        .prepare(
          `SELECT t.value AS value, COUNT(*) AS uses
           FROM user_tags t
           JOIN users u ON u.id = t.user_id
           WHERE t.category_id = ? AND u.visibility != 'private' AND t.hidden = 0
             AND ${banFilter}
           GROUP BY t.value
           ORDER BY uses DESC, t.value ASC
           LIMIT ?`,
        )
        .bind(categoryId, now(), limit);
  const result = await statement.all<{ value: string }>();
  return (result.results ?? []).map((row) => row.value);
}

export async function replaceUserTags(
  db: D1Database,
  userId: string,
  tags: TagInput[],
): Promise<void> {
  const statements = [db.prepare('DELETE FROM user_tags WHERE user_id = ?').bind(userId)];
  tags.forEach((tag, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_tags (id, user_id, category_id, value, hidden, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), userId, tag.categoryId, tag.value, tag.hidden ? 1 : 0, index, now()),
    );
  });
  await db.batch(statements);
}

/* ------------------------------- follows ------------------------------ */

/** Whether `followerId` already follows `followingId`. */
export function isFollowing(
  db: D1Database,
  followerId: string,
  followingId: string,
): Promise<boolean> {
  return db
    .prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(followerId, followingId)
    .first<{ x: number }>()
    .then((row) => row !== null);
}

/**
 * Epoch ms `followerId` started following `followingId`, or null when they do
 * not follow. Powers the per-block `minFollowDays` condition
 * (`src/lib/audience.ts`) — the age of the follow edge, not the user's join
 * date.
 */
export async function getFollowStartedAt(
  db: D1Database,
  followerId: string,
  followingId: string,
): Promise<number | null> {
  const row = await db
    .prepare('SELECT created_at AS started_at FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(followerId, followingId)
    .first<{ started_at: number }>();
  return row ? row.started_at : null;
}

/** Idempotent: following the same user twice keeps a single row. */
export async function follow(
  db: D1Database,
  followerId: string,
  followingId: string,
): Promise<void> {
  if (followerId === followingId) return;
  await db
    .prepare('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)')
    .bind(followerId, followingId, now())
    .run();
}

export async function unfollow(
  db: D1Database,
  followerId: string,
  followingId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(followerId, followingId)
    .run();
}

/**
 * How many (non-private) users follow `followingId`. Private profiles are
 * excluded — like tag suggestions — so the count matches what the followers
 * list can actually show.
 */
export async function countFollowers(db: D1Database, followingId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND u.visibility != 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )`,
    )
    .bind(followingId, now())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** How many (non-private) users `followerId` follows (drives the profile's "following" stat). */
export async function countFollowing(db: D1Database, followerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND u.visibility != 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )`,
    )
    .bind(followerId, now())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The profile rows of everyone who follows `followingId`, newest first.
 * Users without a handle or with a `private` profile are excluded (they have
 * no public page to link to); the list is capped at `limit` rows.
 */
export async function listFollowers(
  db: D1Database,
  followingId: string,
  limit = 100,
): Promise<UserRow[]> {
  const result = await db
    .prepare(
      `SELECT u.* FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND u.username IS NOT NULL AND u.visibility != 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )
       ORDER BY f.created_at DESC, f.follower_id ASC
       LIMIT ?`,
    )
    .bind(followingId, now(), limit)
    .all<UserRow>();
  return result.results ?? [];
}

/** The profile rows everyone that `followerId` follows, newest first (see `listFollowers`). */
export async function listFollowing(
  db: D1Database,
  followerId: string,
  limit = 100,
): Promise<UserRow[]> {
  const result = await db
    .prepare(
      `SELECT u.* FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND u.username IS NOT NULL AND u.visibility != 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )
       ORDER BY f.created_at DESC, f.following_id ASC
       LIMIT ?`,
    )
    .bind(followerId, now(), limit)
    .all<UserRow>();
  return result.results ?? [];
}

/**
 * Which of `followingIds` does `followerId` already follow (drives the per-row
 * follow toggle on the followers/following list pages). One batched query.
 */
export async function listFollowingIds(
  db: D1Database,
  followerId: string,
  followingIds: string[],
): Promise<string[]> {
  if (followingIds.length === 0) return [];
  const placeholders = followingIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT following_id FROM follows
       WHERE follower_id = ? AND following_id IN (${placeholders})`,
    )
    .bind(followerId, ...followingIds)
    .all<{ following_id: string }>();
  return (result.results ?? []).map((row) => row.following_id);
}

/* -------------------------- profile blocks ---------------------------- */

/**
 * Defensive limits for profile blocks, shared with route-level validation and
 * the dashboard UI. `replaceProfileBlocks` never exceeds these, so a hostile
 * submit can only ever produce at most `maxBlocks` rows of at most these
 * sizes — anything over is dropped, never truncated into a throw.
 */
export const BLOCK_LIMITS = {
  maxBlocks: 20,
  maxTitleLength: 120,
  maxBodyLength: 4000,
  maxGalleryItems: 12,
  maxGalleryItemLength: 500,
  /** Max length of one value in `required_tags` / `excluded_tags` — same fold as any tag value. */
  maxTagValueLength: 40,
  /** Max entries per tag list. */
  maxRequiredTags: 10,
  maxExcludedTags: 10,
  /** Max ids across a block's allow + deny lists combined. */
  maxListedUsers: 50,
  /** Inclusive max for `minFollowDays` / `minAccountAgeDays`; over-cap values degrade to "no condition". */
  maxMinDays: 3650,
} as const;

const BLOCK_KINDS: ReadonlySet<string> = new Set(['text', 'gallery']);
const BLOCK_VISIBILITIES: ReadonlySet<string> = new Set(['public', 'users', 'same_tag', 'self']);

function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && BLOCK_KINDS.has(value);
}

function isBlockVisibility(value: unknown): value is BlockVisibility {
  return typeof value === 'string' && BLOCK_VISIBILITIES.has(value);
}

/**
 * Normalises a gallery block's `items` into the canonical stored form: a JSON
 * array string of at most `maxGalleryItems` non-empty strings, each at most
 * `maxGalleryItemLength` chars. Accepts an array (serialised) or an already
 * serialised JSON array string (re-normalised). Returns null when the value
 * cannot be turned into a usable, non-empty array — the caller then drops the
 * block, which keeps the table's CHECK constraints satisfiable.
 */
function coerceGalleryItems(value: unknown): string | null {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const usable = entries
    .map((entry) => text(entry, BLOCK_LIMITS.maxGalleryItemLength))
    .filter((entry) => entry.length > 0)
    .slice(0, BLOCK_LIMITS.maxGalleryItems);
  if (usable.length === 0) return null;
  try {
    return JSON.stringify(usable);
  } catch {
    return null;
  }
}

/** The rules of one block after normalisation — exactly what gets stored. */
interface NormalisedRules {
  relation: BlockRelation | null;
  requiredTags: string[];
  tagMatch: TagMatch;
  excludedTags: string[];
  minFollowDays: number | null;
  minAccountAgeDays: number | null;
  visibleFrom: number | null;
  visibleUntil: number | null;
}

/** A block after normalisation — exactly what gets stored, all limits applied. */
interface NormalisedBlock {
  id: string;
  kind: BlockKind;
  title: string | null;
  body: string | null;
  items: string | null;
  visibility: BlockVisibility;
  rules: NormalisedRules;
  allowUserIds: string[];
  denyUserIds: string[];
}

/** True when every rule is unset (so no `profile_block_rules` row is written). */
function rulesAreEmpty(rules: NormalisedRules): boolean {
  return (
    rules.relation === null &&
    rules.requiredTags.length === 0 &&
    rules.excludedTags.length === 0 &&
    rules.minFollowDays === null &&
    rules.minAccountAgeDays === null &&
    rules.visibleFrom === null &&
    rules.visibleUntil === null
  );
}

/**
 * Normalises one tag list (all values trimmed + lower-cased, deduped, capped).
 * Accepts an array; a lone string counts as a single value, never its
 * characters. Mirrors `normaliseTagValue` (`src/lib/audience.ts`).
 */
function normaliseTagList(value: unknown, max: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of raw) {
    const normalised = text(item, BLOCK_LIMITS.maxTagValueLength).trim().toLowerCase();
    if (normalised === '' || out.includes(normalised)) continue;
    out.push(normalised);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalises one id list (trimmed, deduped, capped). Non-strings are dropped. */
function normaliseIdList(value: unknown, max: number): string[] {
  const raw = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id === '' || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Normalises one block's rules. A blank/bad scalar means "no condition" (the
 * rule is simply not enforced), never a row the CHECK constraints reject.
 */
function normaliseRules(value: unknown): NormalisedRules {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  let visibleFrom = clampTimestamp(raw.visibleFrom);
  let visibleUntil = clampTimestamp(raw.visibleUntil);
  if (visibleFrom !== null && visibleUntil !== null && visibleFrom >= visibleUntil) {
    // An inverted window would make the block permanently invisible and violate
    // the table CHECK; drop the window rather than store a rejected row.
    visibleFrom = null;
    visibleUntil = null;
  }
  return {
    relation: isBlockRelation(raw.relation) ? raw.relation : null,
    requiredTags: normaliseTagList(raw.requiredTags, BLOCK_LIMITS.maxRequiredTags),
    tagMatch: tagMatchOf(raw.tagMatch),
    excludedTags: normaliseTagList(raw.excludedTags, BLOCK_LIMITS.maxExcludedTags),
    minFollowDays: clampMinDays(raw.minFollowDays),
    minAccountAgeDays: clampMinDays(raw.minAccountAgeDays),
    visibleFrom,
    visibleUntil,
  };
}

/** The block as it will be stored, or null when the input is unusable. */
function normaliseBlock(input: unknown): NormalisedBlock | null {
  if (!input || typeof input !== 'object') return null;
  const block = input as Record<string, unknown>;
  const kind = isBlockKind(block.kind) ? block.kind : null;
  if (!kind) return null;
  const visibility = isBlockVisibility(block.visibility) ? block.visibility : null;
  if (!visibility) return null;
  const title = text(block.title, BLOCK_LIMITS.maxTitleLength) || null;
  const rules = normaliseRules(block.rules);
  // A deny entry beats an overlapping allow entry (the composite PK forbids a
  // user from being in both lists).
  const denyUserIds = normaliseIdList(block.denyUserIds, BLOCK_LIMITS.maxListedUsers);
  const allowUserIds = normaliseIdList(block.allowUserIds, BLOCK_LIMITS.maxListedUsers).filter(
    (id) => !denyUserIds.includes(id),
  );
  const id = newId();
  if (kind === 'text') {
    const body = text(block.body, BLOCK_LIMITS.maxBodyLength);
    if (!body) return null;
    return { id, kind, title, body, items: null, visibility, rules, allowUserIds, denyUserIds };
  }
  const items = coerceGalleryItems(block.items);
  if (items === null) return null;
  return { id, kind, title, body: null, items, visibility, rules, allowUserIds, denyUserIds };
}

/** Coerces a raw day count to an inclusive 0..cap integer, else null. */
function clampMinDays(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > BLOCK_LIMITS.maxMinDays) return null;
  return n;
}

/** Coerces a raw epoch-ms timestamp to a non-negative integer, else null. */
function clampTimestamp(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The subset of `ids` that actually exist in `users`. Used before writing
 * `profile_block_viewers` so a stale or hostile id can never trip the FK and
 * turn a save into a 500 — an unknown id is simply dropped.
 */
async function filterExistingUserIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: string }>();
  return new Set((result.results ?? []).map((row) => row.id));
}

/**
 * A user's blocks, each LEFT JOINed with its `profile_block_rules` satellite so
 * the rule values arrive on the same row as `rule_*` (null when the block has
 * none). One query keeps the public render path to a single D1 round-trip.
 */
export async function listProfileBlocks(db: D1Database, userId: string): Promise<ProfileBlockRow[]> {
  const result = await db
    .prepare(
      `SELECT b.*,
              r.relation             AS rule_relation,
              r.required_tags        AS rule_required_tags,
              r.tag_match            AS rule_tag_match,
              r.excluded_tags        AS rule_excluded_tags,
              r.min_follow_days      AS rule_min_follow_days,
              r.min_account_age_days AS rule_min_account_age_days,
              r.visible_from         AS rule_visible_from,
              r.visible_until        AS rule_visible_until
       FROM profile_blocks b
       LEFT JOIN profile_block_rules r ON r.block_id = b.id
       WHERE b.user_id = ?
       ORDER BY b.sort_order ASC, b.created_at ASC`,
    )
    .bind(userId)
    .all<ProfileBlockRow>();
  return result.results ?? [];
}

/**
 * Replaces the user's whole block list (delete-then-batch-insert, mirroring
 * `replaceFields`). Never throws on hostile input: invalid kinds/visibilities,
 * over-limit lists, oversized text, empty text bodies, and unusable gallery
 * items are dropped or normalised instead. `sort_order` is the index of the
 * surviving entry, so the stored list is always compact. Each block's rules go
 * into the `profile_block_rules` satellite (only when it carries any rule) and
 * its allow/deny lists into `profile_block_viewers`; the `DELETE` below cascades
 * both away first, so the rewrite is complete. Ids that no longer exist in
 * `users` are dropped before the insert, so the FK can never fail.
 */
export async function replaceProfileBlocks(
  db: D1Database,
  userId: string,
  blocks: BlockInput[],
): Promise<void> {
  const normalised: NormalisedBlock[] = [];
  for (const block of blocks ?? []) {
    const parsed = normaliseBlock(block);
    if (!parsed) continue;
    if (normalised.length >= BLOCK_LIMITS.maxBlocks) break;
    normalised.push(parsed);
  }

  const candidateIds = [
    ...new Set(normalised.flatMap((block) => [...block.allowUserIds, ...block.denyUserIds])),
  ];
  const existingIds = await filterExistingUserIds(db, candidateIds);

  const ts = now();
  const statements = [db.prepare('DELETE FROM profile_blocks WHERE user_id = ?').bind(userId)];
  normalised.forEach((block, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO profile_blocks
             (id, user_id, kind, title, body, items, visibility, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          block.id,
          userId,
          block.kind,
          block.title,
          block.body,
          block.items,
          block.visibility,
          index,
          ts,
          ts,
        ),
    );
    if (!rulesAreEmpty(block.rules)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO profile_block_rules
               (block_id, relation, required_tags, tag_match, excluded_tags,
                min_follow_days, min_account_age_days, visible_from, visible_until)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            block.id,
            block.rules.relation,
            block.rules.requiredTags.length > 0 ? JSON.stringify(block.rules.requiredTags) : null,
            block.rules.tagMatch,
            block.rules.excludedTags.length > 0 ? JSON.stringify(block.rules.excludedTags) : null,
            block.rules.minFollowDays,
            block.rules.minAccountAgeDays,
            block.rules.visibleFrom,
            block.rules.visibleUntil,
          ),
      );
    }
    for (const [ids, kind] of [
      [block.allowUserIds, 'allow'],
      [block.denyUserIds, 'deny'],
    ] as const) {
      for (const id of ids) {
        if (!existingIds.has(id)) continue;
        statements.push(
          db
            .prepare(
              'INSERT INTO profile_block_viewers (block_id, user_id, kind) VALUES (?, ?, ?)',
            )
            .bind(block.id, id, kind),
        );
      }
    }
  });
  await db.batch(statements);
}

/**
 * Where the key/value fields card sits among the user's blocks, as the number
 * of blocks before it. Absent row (or an unusable value) means 0. The caller
 * clamps it to the block count, so a stale position never throws a render off.
 */
export async function getProfileLayout(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT fields_position FROM profile_layout WHERE user_id = ?')
    .bind(userId)
    .first<{ fields_position: number }>();
  const position = row?.fields_position;
  return typeof position === 'number' && Number.isInteger(position) && position >= 0 ? position : 0;
}

/** Upserts the fields-card position (one row per user). */
export async function setProfileLayout(
  db: D1Database,
  userId: string,
  fieldsPosition: number,
): Promise<void> {
  const position = Number.isInteger(fieldsPosition) && fieldsPosition >= 0 ? fieldsPosition : 0;
  await db
    .prepare(
      `INSERT INTO profile_layout (user_id, fields_position) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET fields_position = excluded.fields_position`,
    )
    .bind(userId, position)
    .run();
}

/**
 * All allow/deny rows for a user's blocks, with the referenced handle joined in
 * for display. Used both by the public profile (grouped into per-block lists by
 * `groupViewerLists`) and by the dashboard editor (to show chosen usernames).
 */
export async function listBlockViewers(db: D1Database, ownerId: string): Promise<BlockViewerRow[]> {
  const result = await db
    .prepare(
      `SELECT v.block_id AS block_id, v.user_id AS user_id, v.kind AS kind, u.username AS username
       FROM profile_block_viewers v
       JOIN profile_blocks b ON b.id = v.block_id
       LEFT JOIN users u ON u.id = v.user_id
       WHERE b.user_id = ?
       ORDER BY v.kind ASC, u.username ASC`,
    )
    .bind(ownerId)
    .all<BlockViewerRow>();
  return result.results ?? [];
}

/**
 * Handle autocomplete for the block allow/deny editors. Only claimed,
 * non-private handles are surfaced (the same privacy rule the follow lists
 * use), matched case-insensitively against username or display name.
 */
export async function searchUserSuggestions(
  db: D1Database,
  query: string,
  limit = 8,
): Promise<UserRow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const like = `%${escapeLike(q)}%`;
  const result = await db
    .prepare(
      `SELECT * FROM users u
       WHERE u.username IS NOT NULL AND u.visibility != 'private'
         AND NOT EXISTS (
           SELECT 1 FROM user_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND (b.expires_at IS NULL OR b.expires_at > ?)
         )
         AND (lower(u.username) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\')
       ORDER BY u.username ASC
       LIMIT ?`,
    )
    .bind(now(), like, like, limit)
    .all<UserRow>();
  return result.results ?? [];
}

/**
 * Maps normalised (lower-case) usernames to user ids for the block editors.
 * A name that does not resolve is simply absent from the returned map, so the
 * route can reject the submit rather than silently dropping a listed account.
 */
export async function resolveUsernames(
  db: D1Database,
  usernames: string[],
): Promise<Map<string, string>> {
  const names = [...new Set(usernames.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (names.length === 0) return new Map();
  const placeholders = names.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT id, username FROM users WHERE lower(username) IN (${placeholders})`)
    .bind(...names)
    .all<{ id: string; username: string | null }>();
  const map = new Map<string, string>();
  for (const row of result.results ?? []) {
    if (row.username) map.set(row.username.toLowerCase(), row.id);
  }
  return map;
}

/* ----------------------------- login tokens --------------------------- */

export async function createLoginToken(
  db: D1Database,
  input: { tokenHash: string; email: string; expiresAt: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_tokens (token_hash, email, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(input.tokenHash, input.email.toLowerCase(), input.expiresAt, now())
    .run();
}

export function getLoginToken(
  db: D1Database,
  tokenHash: string,
): Promise<LoginTokenRow | null> {
  return db
    .prepare('SELECT * FROM login_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<LoginTokenRow>();
}

export async function consumeLoginToken(db: D1Database, tokenHash: string): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE login_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL',
    )
    .bind(now(), tokenHash)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function pruneExpiredLoginTokens(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now()).run();
}

/* ---------------------------- totp factors ---------------------------- */

export function getTotpFactor(db: D1Database, userId: string): Promise<TotpFactorRow | null> {
  return db
    .prepare('SELECT * FROM totp_factors WHERE user_id = ?')
    .bind(userId)
    .first<TotpFactorRow>();
}

/** Creates or replaces the (still unconfirmed) TOTP factor for a user. */
export async function upsertPendingTotpFactor(
  db: D1Database,
  userId: string,
  secret: string,
): Promise<void> {
  const ts = now();
  await db
    .prepare(
      `INSERT INTO totp_factors (user_id, secret, confirmed, last_step, created_at, updated_at)
       VALUES (?, ?, 0, NULL, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         secret = excluded.secret, confirmed = 0, last_step = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, secret, ts, ts)
    .run();
}

/** Atomic confirm: only a pending (unconfirmed) factor can be activated. */
export async function confirmTotpFactor(
  db: D1Database,
  userId: string,
  step: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE totp_factors SET confirmed = 1, last_step = ?, updated_at = ? WHERE user_id = ? AND confirmed = 0',
    )
    .bind(step, now(), userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Records the step of an accepted code so the same code cannot be replayed. */
export async function setTotpLastStep(db: D1Database, userId: string, step: number): Promise<void> {
  await db
    .prepare('UPDATE totp_factors SET last_step = ?, updated_at = ? WHERE user_id = ?')
    .bind(step, now(), userId)
    .run();
}

export async function deleteTotpFactor(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM totp_factors WHERE user_id = ?').bind(userId).run();
}

/* ------------------------------ reserved ------------------------------ */

export async function listReservedUsernames(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare('SELECT name FROM reserved_usernames ORDER BY name ASC')
    .all<{ name: string }>();
  return (result.results ?? []).map((row) => row.name);
}

export async function addReservedUsername(db: D1Database, name: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO reserved_usernames (name) VALUES (?)')
    .bind(name.toLowerCase())
    .run();
}

export async function removeReservedUsername(db: D1Database, name: string): Promise<void> {
  await db.prepare('DELETE FROM reserved_usernames WHERE name = ?').bind(name.toLowerCase()).run();
}

/* ------------------------------ settings ------------------------------ */

export async function readSettings(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT key, value FROM settings').all<{
    key: string;
    value: string;
  }>();
  const map: Record<string, string> = {};
  for (const row of result.results ?? []) {
    map[row.key] = row.value;
  }
  return map;
}

/** Batched upsert of many `settings` key/value rows. */
export async function writeSettings(db: D1Database, values: Record<string, string>): Promise<void> {
  const ts = now();
  const statements = Object.entries(values).map((entry) =>
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(entry[0], entry[1], ts),
  );
  if (statements.length) await db.batch(statements);
}

/* ------------------------------- admin -------------------------------- */

export interface AdminStats {
  users: number;
  handles: number;
  fields: number;
  admins: number;
}

async function count(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getStats(db: D1Database): Promise<AdminStats> {
  const [users, handles, fields, admins] = await Promise.all([
    count(db, 'SELECT COUNT(*) AS n FROM users'),
    count(db, 'SELECT COUNT(*) AS n FROM users WHERE username IS NOT NULL'),
    count(db, 'SELECT COUNT(*) AS n FROM fields'),
    count(db, 'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'),
  ]);
  return { users, handles, fields, admins };
}

export async function searchUsers(
  db: D1Database,
  query: string,
  limit = 50,
  offset = 0,
): Promise<UserRow[]> {
  const q = query.trim().toLowerCase();
  // The admin search keeps banned accounts visible (they still need
  // moderation), but flags them so the users table can show a badge.
  const bannedFlag = `EXISTS (
    SELECT 1 FROM user_bans b
    WHERE b.user_id = u.id AND b.revoked_at IS NULL
      AND (b.expires_at IS NULL OR b.expires_at > ?)
  ) AS is_banned`;
  if (!q) {
    const result = await db
      .prepare(
        `SELECT u.*, ${bannedFlag} FROM users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(now(), limit, offset)
      .all<UserRow>();
    return result.results ?? [];
  }
  const like = `%${q}%`;
  const result = await db
    .prepare(
      `SELECT u.*, ${bannedFlag} FROM users u
       WHERE lower(u.username) LIKE ? OR lower(u.email) LIKE ? OR lower(u.display_name) LIKE ?
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(now(), like, like, like, limit, offset)
    .all<UserRow>();
  return result.results ?? [];
}

export async function setUserAdmin(
  db: D1Database,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?')
    .bind(isAdmin ? 1 : 0, now(), userId)
    .run();
}

export async function deleteUser(db: D1Database, userId: string): Promise<UserRow | null> {
  const user = await getUserById(db, userId);
  if (!user) return null;
  const statements = [
    db.prepare('DELETE FROM user_tags WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM fields WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM identities WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM totp_factors WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM follows WHERE follower_id = ?').bind(userId),
    db.prepare('DELETE FROM follows WHERE following_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ];
  // Outstanding magic-link tokens would otherwise still resolve this email.
  if (user.email) {
    statements.push(
      db.prepare('DELETE FROM login_tokens WHERE email = ?').bind(user.email.toLowerCase()),
    );
  }
  await db.batch(statements);
  return user;
}

/* ----------------------------- moderation ----------------------------- */

/**
 * The profile/report join used by every moderation read. Reporter and handler
 * are LEFT JOINed because those FKs are nulled when an account is deleted;
 * the target is an INNER JOIN (a report cannot outlive its target).
 */
const REPORT_SELECT = `
  SELECT r.*,
         rep.username     AS reporter_username,
         rep.display_name AS reporter_display_name,
         tgt.username     AS target_username,
         tgt.display_name AS target_display_name,
         handler.username AS handler_username
  FROM reports r
  LEFT JOIN users rep ON rep.id = r.reporter_id
  JOIN users tgt ON tgt.id = r.target_user_id
  LEFT JOIN users handler ON handler.id = r.handled_by`;

export async function createReport(
  db: D1Database,
  input: {
    reporterId: string;
    targetUserId: string;
    reason: string;
    details: string | null;
  },
): Promise<string> {
  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO reports
         (id, reporter_id, target_user_id, reason, details, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .bind(id, input.reporterId, input.targetUserId, input.reason, input.details, ts, ts)
    .run();
  return id;
}

/** The viewer's still-open report against a profile, if any (dedupe on submit). */
export async function getOpenReportByReporter(
  db: D1Database,
  reporterId: string,
  targetUserId: string,
): Promise<ReportRow | null> {
  return db
    .prepare(`${REPORT_SELECT} WHERE r.reporter_id = ? AND r.target_user_id = ? AND r.status = 'open' ORDER BY r.created_at DESC LIMIT 1`)
    .bind(reporterId, targetUserId)
    .first<ReportRow>();
}

export function getReportById(db: D1Database, id: string): Promise<ReportRow | null> {
  return db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).bind(id).first<ReportRow>();
}

/** Reports newest-first, optionally narrowed to one workflow state. */
export async function listReports(
  db: D1Database,
  status: ReportStatus | 'all' = 'open',
  limit = 100,
  offset = 0,
): Promise<ReportRow[]> {
  const statement =
    status === 'all'
      ? db.prepare(
          `${REPORT_SELECT}
           ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC
           LIMIT ? OFFSET ?`,
        ).bind(limit, offset)
      : db.prepare(`${REPORT_SELECT} WHERE r.status = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
          .bind(status, limit, offset);
  const result = await statement.all<ReportRow>();
  return result.results ?? [];
}

export async function setReportStatus(
  db: D1Database,
  id: string,
  status: ReportStatus,
  resolution: string | null,
  handledBy: string,
): Promise<void> {
  const ts = now();
  await db
    .prepare(
      `UPDATE reports
       SET status = ?, resolution = ?, handled_by = ?, handled_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, resolution, handledBy, ts, ts, id)
    .run();
}

export interface ReportCounts {
  open: number;
  resolved: number;
  dismissed: number;
}

/** Reports filed by one user, newest first (the `/reports` inbox). */
export async function listMyReports(
  db: D1Database,
  reporterId: string,
  limit = 100,
): Promise<ReportRow[]> {
  const result = await db
    .prepare(`${REPORT_SELECT} WHERE r.reporter_id = ? ORDER BY r.created_at DESC LIMIT ?`)
    .bind(reporterId, limit)
    .all<ReportRow>();
  return result.results ?? [];
}

const RECEIPT_SELECT = `
  SELECT rr.*,
         a.username     AS admin_username,
         a.display_name AS admin_display_name
  FROM report_receipts rr
  LEFT JOIN users a ON a.id = rr.admin_id`;

export async function createReportReceipt(
  db: D1Database,
  input: { reportId: string; adminId: string; body: string },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO report_receipts (id, report_id, admin_id, body, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(id, input.reportId, input.adminId, input.body, now())
    .run();
  return id;
}

/** Every receipt on reports filed by `reporterId`, oldest first. */
export async function listReceiptsForReporter(
  db: D1Database,
  reporterId: string,
  limit = 500,
): Promise<ReportReceiptRow[]> {
  const result = await db
    .prepare(
      `${RECEIPT_SELECT}
       JOIN reports r ON r.id = rr.report_id
       WHERE r.reporter_id = ?
       ORDER BY rr.created_at ASC
       LIMIT ?`,
    )
    .bind(reporterId, limit)
    .all<ReportReceiptRow>();
  return result.results ?? [];
}

/** Marks every unread receipt on this reporter's reports as read. */
export async function markReceiptsReadForReporter(
  db: D1Database,
  reporterId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE report_receipts SET read_at = ?
       WHERE read_at IS NULL
         AND report_id IN (SELECT id FROM reports WHERE reporter_id = ?)`,
    )
    .bind(now(), reporterId)
    .run();
}

/** Drives the unread badge on the console's Reports menu. */
export async function countUnreadReceipts(db: D1Database, reporterId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM report_receipts rr
       JOIN reports r ON r.id = rr.report_id
       WHERE r.reporter_id = ? AND rr.read_at IS NULL`,
    )
    .bind(reporterId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Resolves every still-open report against a target (used when banning).
 */
export async function resolveOpenReportsForTarget(
  db: D1Database,
  targetUserId: string,
  handledBy: string,
  resolution: string | null,
): Promise<void> {
  const ts = now();
  await db
    .prepare(
      `UPDATE reports
       SET status = 'resolved', resolution = ?, handled_by = ?, handled_at = ?, updated_at = ?
       WHERE target_user_id = ? AND status = 'open'`,
    )
    .bind(resolution, handledBy, ts, ts, targetUserId)
    .run();
}

export async function countReports(db: D1Database): Promise<ReportCounts> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0)      AS open,
         COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0)  AS resolved,
         COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0) AS dismissed
       FROM reports`,
    )
    .first<ReportCounts>();
  return row ?? { open: 0, resolved: 0, dismissed: 0 };
}

/**
 * The ban that currently applies to `userId`, if any. Authoritative (D1, not a
 * cache) because every gate — sign-in, session use, public profile — depends on
 * it; lifted and expired rows never match.
 */
export function getActiveBan(db: D1Database, userId: string): Promise<BanStateRow | null> {
  return db
    .prepare(
      `SELECT * FROM user_bans
       WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(userId, now())
    .first<BanStateRow>();
}

/** The stored ban row regardless of state, for the admin console. */
export function getBan(db: D1Database, userId: string): Promise<BanStateRow | null> {
  return db.prepare('SELECT * FROM user_bans WHERE user_id = ?').bind(userId).first<BanStateRow>();
}

const BAN_SELECT = `
  SELECT b.*,
         u.username  AS username,
         u.display_name AS display_name,
         a.username  AS created_by_username,
         r.username  AS revoked_by_username
  FROM user_bans b
  JOIN users u ON u.id = b.user_id
  LEFT JOIN users a ON a.id = b.created_by
  LEFT JOIN users r ON r.id = b.revoked_by`;

/** Ban history for the admin console: active rows first, then newest. */
export async function listBans(db: D1Database, limit = 100): Promise<UserBanRow[]> {
  const result = await db
    .prepare(
      `${BAN_SELECT}
       ORDER BY CASE WHEN b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)
                     THEN 0 ELSE 1 END,
                b.created_at DESC
       LIMIT ?`,
    )
    .bind(now(), limit)
    .all<UserBanRow>();
  return result.results ?? [];
}

export async function countActiveBans(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM user_bans
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(now())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Applies (or replaces) an account's ban. One row per account: a re-ban resets
 * the previous `revoked_at`/`created_at`, and `moderation_actions` keeps the
 * history, so this table only ever describes the current/latest decision.
 */
export async function upsertBan(
  db: D1Database,
  input: {
    userId: string;
    reason: string;
    note: string | null;
    createdBy: string;
    expiresAt: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_bans (user_id, reason, note, created_by, created_at, expires_at, revoked_at, revoked_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         reason = excluded.reason,
         note = excluded.note,
         created_by = excluded.created_by,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         revoked_at = NULL,
         revoked_by = NULL`,
    )
    .bind(
      input.userId,
      input.reason,
      input.note,
      input.createdBy,
      now(),
      input.expiresAt,
    )
    .run();
}

export async function revokeBan(
  db: D1Database,
  userId: string,
  revokedBy: string,
): Promise<void> {
  await db
    .prepare('UPDATE user_bans SET revoked_at = ?, revoked_by = ? WHERE user_id = ?')
    .bind(now(), revokedBy, userId)
    .run();
}

export async function logModerationAction(
  db: D1Database,
  input: {
    actorId: string;
    action: string;
    targetUserId?: string | null;
    reportId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO moderation_actions
         (id, actor_id, action, target_user_id, report_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      input.actorId,
      input.action,
      input.targetUserId ?? null,
      input.reportId ?? null,
      input.note ?? null,
      now(),
    )
    .run();
}

const ACTION_SELECT = `
  SELECT m.*,
         a.username AS actor_username,
         t.username AS target_username
  FROM moderation_actions m
  LEFT JOIN users a ON a.id = m.actor_id
  LEFT JOIN users t ON t.id = m.target_user_id`;

export async function listModerationActions(
  db: D1Database,
  limit = 50,
): Promise<ModerationActionRow[]> {
  const result = await db
    .prepare(`${ACTION_SELECT} ORDER BY m.created_at DESC LIMIT ?`)
    .bind(limit)
    .all<ModerationActionRow>();
  return result.results ?? [];
}
