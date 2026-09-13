/**
 * All D1 access lives here: one function per query, grouped by table with
 * section banners below. Callers pass a `D1Database` (usually `c.env.DB`) and
 * never build SQL themselves.
 */
import type {
  FieldInput,
  FieldRow,
  IdentityRow,
  LoginTokenRow,
  ProfileInput,
  TagCategoryRow,
  TagInput,
  UserRow,
  UserTagRow,
} from './types';

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
      `SELECT * FROM users
       WHERE username IS NOT NULL AND visibility = 'public'
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(limit)
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
  const statement = q
    ? db
        .prepare(
          `SELECT t.value AS value, COUNT(*) AS uses
           FROM user_tags t
           JOIN users u ON u.id = t.user_id
           WHERE t.category_id = ? AND u.visibility != 'private' AND t.hidden = 0
             AND t.value LIKE ? ESCAPE '\\'
           GROUP BY t.value
           ORDER BY uses DESC, t.value ASC
           LIMIT ?`,
        )
        .bind(categoryId, `%${escapeLike(q)}%`, limit)
    : db
        .prepare(
          `SELECT t.value AS value, COUNT(*) AS uses
           FROM user_tags t
           JOIN users u ON u.id = t.user_id
           WHERE t.category_id = ? AND u.visibility != 'private' AND t.hidden = 0
           GROUP BY t.value
           ORDER BY uses DESC, t.value ASC
           LIMIT ?`,
        )
        .bind(categoryId, limit);
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
  if (!q) {
    const result = await db
      .prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<UserRow>();
    return result.results ?? [];
  }
  const like = `%${q}%`;
  const result = await db
    .prepare(
      `SELECT * FROM users
       WHERE lower(username) LIKE ? OR lower(email) LIKE ? OR lower(display_name) LIKE ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(like, like, like, limit, offset)
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
