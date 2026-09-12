/**
 * Double-submit CSRF protection: a readable `csrf` cookie must equal the
 * `_csrf` form field on every unsafe method (enforced in `middleware/auth.ts`).
 */
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { randomToken, timingSafeEqual } from './crypto';

const COOKIE_NAME = 'csrf';
const TTL_SECONDS = 60 * 60 * 24 * 7;

function isSecure(c: Context<AppContext>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function ensureCsrfCookie(c: Context<AppContext>): string {
  const existing = getCookie(c, COOKIE_NAME);
  if (existing) return existing;

  const token = randomToken(24);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: false,
    secure: isSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: TTL_SECONDS,
  });
  return token;
}

export function verifyCsrf(c: Context<AppContext>, submitted: string | undefined): boolean {
  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie || !submitted) return false;
  return timingSafeEqual(cookie, submitted);
}
