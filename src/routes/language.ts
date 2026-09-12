/**
 * Language switcher route: `GET /language/:code?next=/path`.
 * Persists the choice in the `lang` cookie (read back by the locale
 * middleware) and redirects back to `next`. Mounted before `publicRoutes`
 * so the `:code` segment is not swallowed by the `/:username` catch-all.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { isLocale, type Locale } from '../i18n';
import { setLocaleCookie } from '../middleware/locale';
import { safeRedirectPath } from '../lib/validate';
import { appUrl } from '../lib/env';

export const languageRoutes = new Hono<AppContext>();

languageRoutes.get('/language/:code', (c) => {
  const code = c.req.param('code');
  if (isLocale(code)) setLocaleCookie(c, code as Locale);
  return c.redirect(safeRedirectPath(c.req.query('next'), appUrl(c.env)) ?? '/');
});
