/**
 * Authentication middleware. `loadUser` populates the request context from the
 * session (and computes `isAdmin`); `csrfProtection` enforces the double-submit
 * token on unsafe methods; `requireAuth` / `requireAdmin` gate routes.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import { ensureCsrfCookie, verifyCsrf } from '../lib/csrf';
import { getSessionToken, readSession } from '../lib/session';
import { getActiveBan, getUserById } from '../db/queries';
import { isAdminUser } from '../lib/admin';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const loadUser: MiddlewareHandler<AppContext> = async (c, next) => {
  c.set('csrfToken', ensureCsrfCookie(c));
  c.set('isAdmin', false);
  c.set('isBanned', false);

  const token = getSessionToken(c);
  if (token) {
    const session = await readSession(c, token);
    if (session) {
      const user = await getUserById(c.env.DB, session.userId);
      if (user) {
        c.set('user', user);
        c.set('sessionToken', token);
        // Authoritative D1 check: a banned account keeps its session data (the
        // ban gate below handles it), but every auth-gated route must know.
        const ban = await getActiveBan(c.env.DB, user.id);
        c.set('ban', ban);
        c.set('isBanned', Boolean(ban));
        // Also lazily promotes ADMIN_EMAILS bootstrap users; reused by requireAdmin + admin nav.
        c.set('isAdmin', await isAdminUser(c.env.DB, user, c.env));
      }
    }
  }

  await next();
};

/**
 * Reachable while banned: the suspension notice itself, sign-out, language
 * switching, health checks, stored objects, and static assets (the suspension
 * page still needs its stylesheet and htmx bundle).
 */
function isAllowedWhileBanned(path: string): boolean {
  return (
    path === '/suspended' ||
    path === '/auth/logout' ||
    path === '/health' ||
    path === '/styles.css' ||
    path.startsWith('/language/') ||
    path.startsWith('/files/') ||
    path.startsWith('/vendor/')
  );
}

/**
 * Sends a signed-in, banned account to `/suspended` for every other route.
 * Session revocation on ban is best-effort (KV index), so this D1-backed gate
 * is what actually stops a surviving cookie from using the dashboard, the
 * admin console, or any mutating endpoint.
 */
export const enforceBan: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!c.get('isBanned')) return next();
  const path = new URL(c.req.url).pathname;
  if (isAllowedWhileBanned(path)) return next();
  if (c.req.header('HX-Request')) return c.text('Forbidden', 403);
  return c.redirect('/suspended');
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
