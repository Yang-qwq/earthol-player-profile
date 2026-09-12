/**
 * Locale resolution middleware + `lang` cookie helpers.
 * Resolution order: `lang` cookie → `Accept-Language` header → `en`.
 */
import { getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  parseAcceptLanguage,
  type Locale,
} from '../i18n';

const COOKIE_NAME = 'lang';
const TTL_SECONDS = 60 * 60 * 24 * 365;

function isSecure(c: Context<AppContext>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function setLocaleCookie(c: Context<AppContext>, locale: Locale): void {
  setCookie(c, COOKIE_NAME, locale, {
    httpOnly: false,
    secure: isSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export function getRequestLocale(c: Context<AppContext>): Locale {
  const cookie = getCookie(c, COOKIE_NAME);
  if (isLocale(cookie)) return cookie;
  return parseAcceptLanguage(c.req.header('Accept-Language')) ?? DEFAULT_LOCALE;
}

export const resolveLocale: MiddlewareHandler<AppContext> = async (c, next) => {
  const locale = getRequestLocale(c);
  c.set('locale', locale);
  c.set('t', getTranslator(locale));
  await next();
};
