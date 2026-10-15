/**
 * Small API surface: username availability (htmx, returns an HTML fragment),
 * tag autocomplete (JSON, auth-required), the follow toggle (htmx fragment,
 * auth-required), and the public sitemap. Abuse-prone endpoints are
 * rate-limited per client IP.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { UserRow } from '../db/types';
import { FollowControl } from '../views/profile';
import {
  countFollowers,
  follow,
  getUserByUsername,
  isFollowing,
  isUsernameReserved,
  isUsernameTaken,
  listTagSuggestions,
  listUsernames,
  unfollow,
} from '../db/queries';
import { invalidateProfiles } from '../lib/profile-cache';
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

/** Renders just the `data-follow-control` cluster for an in-place htmx swap.
    `forced` carries the fresh state right after a toggle, avoiding re-queries. */
async function renderFollowControl(
  c: Context<AppContext>,
  viewer: UserRow | null,
  target: UserRow,
  notice?: string,
  forced?: { following: boolean; count: number },
) {
  const t = c.get('t');
  const isOwner = Boolean(viewer && viewer.id === target.id);
  let following = false;
  let count = 0;
  if (forced) {
    following = forced.following;
    count = forced.count;
  } else if (viewer && !isOwner) {
    [following, count] = await Promise.all([
      isFollowing(c.env.DB, viewer.id, target.id),
      countFollowers(c.env.DB, target.id),
    ]);
  }
  return c.html(
    <FollowControl
      username={target.username ?? ''}
      isOwner={isOwner}
      isLoggedIn={Boolean(viewer)}
      isFollowing={following}
      followerCount={count}
      csrfToken={c.get('csrfToken')}
      notice={notice}
      t={t}
    />,
  );
}

/**
 * Toggles the follow edge between the signed-in viewer and `:username`
 * (follows if absent, unfollows if present). Returns the fresh follow
 * cluster as an htmx fragment, or redirects back to the profile when the
 * request is a plain form fallback. Only the followed profile's cached HTML
 * is affected (its follower count), so that handle is the one invalidated.
 */
apiRoutes.post('/api/follow/:username', async (c) => {
  const t = c.get('t');
  const viewer = c.get('user');
  const username = c.req.param('username').toLowerCase();
  const target = await getUserByUsername(c.env.DB, username);
  if (!target) return c.notFound();

  const isHtmx = Boolean(c.req.header('HX-Request'));
  const path = `/${target.username}`;
  const fail = (notice: string) =>
    isHtmx ? renderFollowControl(c, viewer ?? null, target, notice) : c.redirect(path);

  if (!viewer) {
    return isHtmx
      ? c.text('Unauthorized', 401)
      : c.redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (viewer.id === target.id) return fail(t('profile.err.self'));

  const limit = await rateLimit(c.env.KV, `follow:${viewer.id}`, 30, 3600);
  if (!limit.allowed) return fail(t('profile.err.rateLimited'));

  const wasFollowing = await isFollowing(c.env.DB, viewer.id, target.id);
  if (wasFollowing) {
    await unfollow(c.env.DB, viewer.id, target.id);
  } else {
    await follow(c.env.DB, viewer.id, target.id);
  }
  const nowFollowing = !wasFollowing;
  const followerCount = await countFollowers(c.env.DB, target.id);
  await invalidateProfiles(c.env.KV, [target.username]);

  // Plain form fallback (no htmx): the profile page re-renders fresh for a
  // logged-in viewer, so a redirect is enough to show the new state.
  if (!isHtmx) return c.redirect(path);

  return renderFollowControl(c, viewer ?? null, target, undefined, {
    following: nowFollowing,
    count: followerCount,
  });
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
