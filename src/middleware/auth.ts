/**
 * Authentication middleware. `loadUser` populates the request context from the
 * session (and computes `isAdmin`); `csrfProtection` enforces the double-submit
 * token on unsafe methods; `requireAuth` / `requireAdmin` gate routes.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import { ensureCsrfCookie, verifyCsrf } from '../lib/csrf';
import { getSessionToken, readSession } from '../lib/session';
import { getUserById } from '../db/queries';
import { isAdminUser } from '../lib/admin';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const loadUser: MiddlewareHandler<AppContext> = async (c, next) => {
  c.set('csrfToken', ensureCsrfCookie(c));
  c.set('isAdmin', false);

  const token = getSessionToken(c);
  if (token) {
    const session = await readSession(c, token);
    if (session) {
      const user = await getUserById(c.env.DB, session.userId);
      if (user) {
        c.set('user', user);
        c.set('sessionToken', token);
        // Also lazily promotes ADMIN_EMAILS bootstrap users; reused by requireAdmin + admin nav.
        c.set('isAdmin', await isAdminUser(c.env.DB, user, c.env));
      }
    }
  }

  await next();
};

export const csrfProtection: MiddlewareHandler<AppContext> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const body = await c.req.parseBody();
    const submitted = typeof body._csrf === 'string' ? body._csrf : undefined;
    if (!verifyCsrf(c, submitted)) {
      return c.text('Invalid CSRF token', 403);
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!c.get('user')) {
    const next_ = encodeURIComponent(new URL(c.req.url).pathname);
    return c.redirect(`/login?next=${next_}`);
  }
  await next();
};

/** Guards the admin panel: logged in **and** `c.get('isAdmin')` (set by `loadUser`). */
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    const next_ = encodeURIComponent(new URL(c.req.url).pathname);
    return c.redirect(`/login?next=${next_}`);
  }
  if (!c.get('isAdmin')) {
    const t = c.get('t');
    const message = t ? t('admin.forbidden') : 'Forbidden';
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>403</title></head>` +
        `<body style="font-family:system-ui;padding:3rem;max-width:32rem;margin:auto">` +
        `<h1>403</h1><p>${message}</p><p><a href="/dashboard">/dashboard</a></p></body></html>`,
      403,
    );
  }
  await next();
};
