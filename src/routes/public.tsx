/**
 * Public pages: the landing page and the `GET /:username` catch-all. This
 * router is mounted last, so any new top-level route must live elsewhere.
 * Anonymous `public` profiles are served from the locale-scoped KV HTML cache.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { Layout } from '../views/layout';
import { Home } from '../views/home';
import { Profile } from '../views/profile';
import { getUserByUsername, listFields, listUserTags } from '../db/queries';
import { getCachedProfile, setCachedProfile } from '../lib/profile-cache';
import { navUser } from '../lib/view';
import { appUrl } from '../lib/env';

export const publicRoutes = new Hono<AppContext>();

publicRoutes.get('/', (c) => {
  const t = c.get('t');
  return c.html(
    <Layout
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(c.get('user'))}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
      pathname="/"
      isAdmin={c.get('isAdmin')}
    >
      <Home appName={c.get('appName')} t={t} loggedIn={Boolean(c.get('user'))} />
    </Layout>,
  );
});

publicRoutes.get('/:username', async (c) => {
  const locale = c.get('locale');
  const t = c.get('t');
  const username = c.req.param('username').toLowerCase();
  const user = await getUserByUsername(c.env.DB, username);
  if (!user) return c.notFound();

  const viewer = c.get('user');
  const isOwner = Boolean(viewer && viewer.id === user.id);
  if (user.visibility === 'private' && !isOwner) return c.notFound();

  const canonical = `${appUrl(c.env)}/${user.username}`;
  const cacheable = !viewer && user.visibility === 'public';
  const robots = user.visibility === 'public' ? undefined : 'noindex, nofollow';

  if (cacheable) {
    const cached = await getCachedProfile(c.env.KV, locale, username);
    if (cached) {
      return c.body(cached, 200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=60',
      });
    }
  }

  const [fields, tags] = await Promise.all([
    listFields(c.env.DB, user.id),
    listUserTags(c.env.DB, user.id),
  ]);

  // Hidden tags stay invisible unless the viewer carries the same value
  // (case-insensitive). Anonymous viewers carry nothing, so they never see them.
  let visibleTags = tags;
  if (!isOwner && tags.some((tag) => tag.hidden)) {
    const viewerTags = viewer ? await listUserTags(c.env.DB, viewer.id) : [];
    const viewerValues = new Set(viewerTags.map((tag) => tag.value.trim().toLowerCase()));
    visibleTags = tags.filter(
      (tag) => !tag.hidden || viewerValues.has(tag.value.trim().toLowerCase()),
    );
  }

  const page = (
    <Profile
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      user={user}
      fields={fields}
      tags={visibleTags}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(viewer)}
      isOwner={isOwner}
      canonical={canonical}
      robots={robots}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={locale}
      pathname={`/${user.username}`}
      isAdmin={c.get('isAdmin')}
    />
  );
  const html = page.toString();

  if (cacheable) {
    await setCachedProfile(c.env.KV, locale, username, html);
    return c.body(html, 200, {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
    });
  }

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
  });
});
