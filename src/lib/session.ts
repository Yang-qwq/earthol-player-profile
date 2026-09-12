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

function isSecure(c: Context<AppContext>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export async function createSession(c: Context<AppContext>, userId: string): Promise<void> {
  const token = randomToken(32);
  const hashed = await sha256Hex(token);
  const data: SessionData = { userId, createdAt: Date.now() };

  await c.env.KV.put(keyFor(hashed), JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

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
    await c.env.KV.delete(keyFor(hashed));
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function getSessionToken(c: Context<AppContext>): string | undefined {
  return getCookie(c, COOKIE_NAME);
}
