/**
 * KV-backed sessions. The `sid` cookie holds a random token while KV is keyed
 * by its SHA-256 hash, so a leaked KV dump cannot be replayed as a cookie.
 * Active sessions are refreshed in place once they pass half their TTL.
 */
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { randomToken, sha256Hex } from './crypto';

const COOKIE_NAME = 'sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const REFRESH_THRESHOLD_SECONDS = 60 * 60 * 24 * 15;

interface SessionData {
  userId: string;
  createdAt: number;
}

function keyFor(hashedToken: string): string {
  return `session:${hashedToken}`;
}

/**
 * Reverse index (`session:user:<userId>:<hash>`) so every session of one
 * account can be revoked when that account is banned. It carries no data; its
 * only job is enumerability, and it expires with the session.
 */
function userIndexKey(userId: string, hashedToken: string): string {
  return `session:user:${userId}:${hashedToken}`;
}

function isSecure(c: Context<AppContext>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export async function createSession(c: Context<AppContext>, userId: string): Promise<void> {
  const token = randomToken(32);
  const hashed = await sha256Hex(token);
  const data: SessionData = { userId, createdAt: Date.now() };

  await Promise.all([
    c.env.KV.put(keyFor(hashed), JSON.stringify(data), {
      expirationTtl: SESSION_TTL_SECONDS,
    }),
    c.env.KV.put(userIndexKey(userId, hashed), '1', {
      expirationTtl: SESSION_TTL_SECONDS,
    }),
  ]);

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(
  c: Context<AppContext>,
  token: string,
): Promise<SessionData | null> {
  const hashed = await sha256Hex(token);
  const raw = await c.env.KV.get(keyFor(hashed));
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as SessionData;
    if (Date.now() - data.createdAt > (SESSION_TTL_SECONDS - REFRESH_THRESHOLD_SECONDS) * 1000) {
      await c.env.KV.put(keyFor(hashed), raw, { expirationTtl: SESSION_TTL_SECONDS });
      data.createdAt = Date.now();
    }
    return data;
  } catch {
    return null;
  }
}

export async function destroySession(c: Context<AppContext>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const hashed = await sha256Hex(token);
    const data = await readSession(c, token);
    await Promise.all([
      c.env.KV.delete(keyFor(hashed)),
      data ? c.env.KV.delete(userIndexKey(data.userId, hashed)) : Promise.resolve(),
    ]);
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

/**
 * Deletes every session belonging to `userId` (used when an account is banned).
 * Best-effort: a KV list failure is non-fatal because the ban gate in
 * `loadUser` also refuses a banned account's still-valid session.
 */
export async function revokeUserSessions(kv: KVNamespace, userId: string): Promise<void> {
  const prefix = `session:user:${userId}:`;
  try {
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, cursor });
      await Promise.all(
        page.keys.flatMap((key) => {
          const hashed = key.name.slice(prefix.length);
          return hashed ? [kv.delete(key.name), kv.delete(keyFor(hashed))] : [kv.delete(key.name)];
        }),
      );
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch {
    /* the D1 ban check remains authoritative */
  }
}

export function getSessionToken(c: Context<AppContext>): string | undefined {
  return getCookie(c, COOKIE_NAME);
}
