/**
 * Public pages: the landing page and the `GET /:username` catch-all. This
 * router is mounted last, so any new top-level route must live elsewhere.
 * Anonymous `public` profiles are served from the locale-scoped KV HTML cache.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { Layout } from '../views/layout';
import { Home } from '../views/home';
import { Profile } from '../views/profile';
import { FollowList } from '../views/follows';
import {
  countFollowers,
  countFollowing,
  getUserByUsername,
  isFollowing,
  listFields,
  listFollowing,
  listFollowingIds,
  listFollowers,
  listUserTags,
} from '../db/queries';
import {
  NONCE_PLACEHOLDER,
  getCachedProfile,
  setCachedProfile,
  withNonce,
} from '../lib/profile-cache';
import { navUser } from '../lib/view';
import { appUrl } from '../lib/env';

export const publicRoutes = new Hono<AppContext>();

publicRoutes.get('/', (c) => {
  const t = c.get('t');
  return c.html(
    <Layout
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      logoUrl={c.get('settings').logoUrl}
      customCss={c.get('settings').customCss}
      customJs={c.get('settings').customJs}
      customFooter={c.get('settings').customFooter}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(c.get('user'))}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
      pathname="/"
      isAdmin={c.get('isAdmin')}
    >
      <Home
        appName={c.get('appName')}
        t={t}
        copy={c.get('settings').landingCopy}
        ctaPrimaryUrl={c.get('settings').landingCtaPrimaryUrl}
        ctaSecondaryUrl={c.get('settings').landingCtaSecondaryUrl}
        loggedIn={Boolean(c.get('user'))}
      />
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
  const nonce = c.get('secureHeadersNonce') ?? '';

  if (cacheable) {
    const cached = await getCachedProfile(c.env.KV, locale, username);
    if (cached) {
      return c.body(withNonce(cached, nonce), 200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=60',
      });
    }
  }

  // The follow counts are attributes of the profiled user (viewer-independent),
  // so they are safe to bake into the cached anonymous HTML; the follow state
  // is viewer-specific and only logged-in viewers ever reach this code path
  // with a fresh render.
  const [fields, tags, followerCount, followingCount, isFollowingFlag] = await Promise.all([
    listFields(c.env.DB, user.id),
    listUserTags(c.env.DB, user.id),
    countFollowers(c.env.DB, user.id),
    countFollowing(c.env.DB, user.id),
    viewer && !isOwner
      ? isFollowing(c.env.DB, viewer.id, user.id)
      : Promise.resolve(false),
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
      logoUrl={c.get('settings').logoUrl}
      customCss={c.get('settings').customCss}
      customJs={c.get('settings').customJs}
      customFooter={c.get('settings').customFooter}
      user={user}
      fields={fields}
      tags={visibleTags}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(viewer)}
      isOwner={isOwner}
      isFollowing={isFollowingFlag}
      followerCount={followerCount}
      followingCount={followingCount}
      canonical={canonical}
      robots={robots}
      nonce={cacheable ? NONCE_PLACEHOLDER : nonce}
      t={t}
      locale={locale}
      pathname={`/${user.username}`}
      isAdmin={c.get('isAdmin')}
    />
  );
  const html = page.toString();

  if (cacheable) {
    await setCachedProfile(c.env.KV, locale, username, html);
    return c.body(withNonce(html, nonce), 200, {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
    });
  }

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
  });
});

/**
 * The `/:username/followers` and `/:username/following` list pages. Each is
 * cached as its own profile-HTML variant (`:followers` / `:following`), and
 * only for anonymous viewers of `public` profiles — same rule as the profile
 * page itself. `private` profiles 404 for everyone but the owner, and
 * `unlisted` ones render with `noindex` and are never cached.
 */
async function followListPage(c: Context<AppContext>, kind: 'followers' | 'following') {
  const locale = c.get('locale');
  const t = c.get('t');
  const username = (c.req.param('username') ?? '').toLowerCase();
  const user = await getUserByUsername(c.env.DB, username);
  if (!user) return c.notFound();

  const viewer = c.get('user');
  const isOwner = Boolean(viewer && viewer.id === user.id);
  if (user.visibility === 'private' && !isOwner) return c.notFound();

  const variant = kind === 'followers' ? ':followers' : ':following';
  const canonical = `${appUrl(c.env)}/${user.username}/${kind}`;
  const cacheable = !viewer && user.visibility === 'public';
  const robots = user.visibility === 'public' ? undefined : 'noindex, nofollow';
  const nonce = c.get('secureHeadersNonce') ?? '';

  if (cacheable) {
    const cached = await getCachedProfile(c.env.KV, locale, username, variant);
    if (cached) {
      return c.body(withNonce(cached, nonce), 200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=60',
      });
    }
  }

  const [followerCount, followingCount, rows] = await Promise.all([
    countFollowers(c.env.DB, user.id),
    countFollowing(c.env.DB, user.id),
    kind === 'followers'
      ? listFollowers(c.env.DB, user.id)
      : listFollowing(c.env.DB, user.id),
  ]);

  // Per-row follow toggle state: one batched lookup for the signed-in viewer.
  const followingIds =
    viewer && rows.length > 0
      ? await listFollowingIds(c.env.DB, viewer.id, rows.map((row) => row.id))
      : [];

  const page = (
    <FollowList
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      logoUrl={c.get('settings').logoUrl}
      customCss={c.get('settings').customCss}
      customJs={c.get('settings').customJs}
      customFooter={c.get('settings').customFooter}
      target={user}
      kind={kind}
      rows={rows}
      followerCount={followerCount}
      followingCount={followingCount}
      followingIds={followingIds}
      viewerId={viewer?.id ?? null}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(viewer)}
      canonical={canonical}
      robots={robots}
      nonce={cacheable ? NONCE_PLACEHOLDER : nonce}
      t={t}
      locale={locale}
      pathname={`/${user.username}/${kind}`}
      isAdmin={c.get('isAdmin')}
    />
  );
  const html = page.toString();

  if (cacheable) {
    await setCachedProfile(c.env.KV, locale, username, html, variant);
    return c.body(withNonce(html, nonce), 200, {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
    });
  }

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
  });
}

publicRoutes.get('/:username/followers', (c) => followListPage(c, 'followers'));
publicRoutes.get('/:username/following', (c) => followListPage(c, 'following'));
