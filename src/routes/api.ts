/**
 * Small API surface: username availability (htmx, returns an HTML fragment),
 * tag autocomplete (JSON, auth-required), and the public sitemap. Abuse-prone
 * endpoints are rate-limited per client IP.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import {
  isUsernameReserved,
  isUsernameTaken,
  listTagSuggestions,
  listUsernames,
} from '../db/queries';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { isValidUsername, normalizeUsername } from '../lib/validate';
import { appUrl } from '../lib/env';

export const apiRoutes = new Hono<AppContext>();

apiRoutes.get('/api/username-available', async (c) => {
  const t = c.get('t');
  const ip = clientIp(c.req.raw.headers);
  const limit = await rateLimit(c.env.KV, `uname:${ip}`, 60, 3600);
  if (!limit.allowed) {
    return c.html(
      `<span class="text-muted-foreground">${t('api.rateLimited')}</span>`,
      429,
    );
  }

  const username = normalizeUsername(c.req.query('username') ?? '');

  if (!isValidUsername(username)) {
    return c.html(`<span class="text-danger">${t('api.invalidFormat')}</span>`);
  }
  if (await isUsernameReserved(c.env.DB, username)) {
    return c.html(`<span class="text-danger">${t('dash.err.reserved')}</span>`);
  }
  if (await isUsernameTaken(c.env.DB, username)) {
    return c.html(`<span class="text-danger">${t('api.taken')}</span>`);
  }
  return c.html(`<span class="text-success">${t('api.available')}</span>`);
});

apiRoutes.get('/api/tag-suggestions', async (c) => {
  if (!c.get('user')) return c.json([], 401);

  const categoryId = c.req.query('category_id') ?? '';
  if (!categoryId) return c.json([]);

  const ip = clientIp(c.req.raw.headers);
  const limit = await rateLimit(c.env.KV, `tagsug:${ip}`, 120, 3600);
  if (!limit.allowed) return c.json([]);

  const suggestions = await listTagSuggestions(
    c.env.DB,
    categoryId,
    c.req.query('q') ?? '',
    8,
  );
  return c.json(suggestions, 200, { 'Cache-Control': 'no-store' });
});

apiRoutes.get('/sitemap.xml', async (c) => {
  const users = await listUsernames(c.env.DB, 5000);
  const entries = users
    .map(
      (user) =>
        `  <url><loc>${appUrl(c.env)}/${user.username}</loc>` +
        `<lastmod>${new Date(user.updated_at).toISOString()}</lastmod></url>`,
    )
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries}\n</urlset>`;

  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=UTF-8',
    'Cache-Control': 'public, max-age=3600',
  });
});
