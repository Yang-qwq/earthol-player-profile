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
  getActiveBan,
  getFollowStartedAt,
  getProfileLayout,
  getUserByUsername,
  isFollowing,
  listBlockViewers,
  listFields,
  listFollowing,
  listFollowingIds,
  listFollowers,
  listProfileBlocks,
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
import {
  canViewBlock,
  conditionsOfRow,
  groupViewerLists,
  isBlockVisibility,
  normaliseTagValues,
  type AudienceContext,
} from '../lib/audience';
import { cacheableBlocks } from '../lib/blocks';

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
  // A banned profile is invisible to everyone else (404, same as a missing
  // handle) and sends its owner to the suspension notice. Admins get a
  // noindex, uncached preview so they can review the account. Checked before
  // the KV cache so a stale cached copy can never outlive a ban.
  const activeBan = await getActiveBan(c.env.DB, user.id);
  if (activeBan) {
    if (isOwner) return c.redirect('/suspended');
    if (!c.get('isAdmin')) return c.notFound();
  }
  if (user.visibility === 'private' && !isOwner) return c.notFound();

  const canonical = `${appUrl(c.env)}/${user.username}`;
  const cacheable = !viewer && user.visibility === 'public';
  const robots =
    activeBan || user.visibility !== 'public' ? 'noindex, nofollow' : undefined;
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
  const [fields, tags, followerCount, followingCount, isFollowingFlag, blockRows, storedFieldsPosition] = await Promise.all([
    listFields(c.env.DB, user.id),
    listUserTags(c.env.DB, user.id),
    countFollowers(c.env.DB, user.id),
    countFollowing(c.env.DB, user.id),
    viewer && !isOwner
      ? isFollowing(c.env.DB, viewer.id, user.id)
      : Promise.resolve(false),
    listProfileBlocks(c.env.DB, user.id),
    getProfileLayout(c.env.DB, user.id),
  ]);

  // Hidden tags are visible only to their owner. A value-matching rule would be
  // an enumeration oracle because any signed-in user can set arbitrary tag values
  // and probe whether another user's hidden tag appears; without a new consent
  // / allowlist data model, the only non-enumerable audience is the owner.
  let visibleTags = tags.filter((tag) => !tag.hidden || isOwner);

  // Profile blocks, audience-filtered. The block audience is computed from the
  // OWNER's tags (hidden ones included — `hidden` is an owner-only display flag
  // and must not silently disable `same_tag`) and, only when a base audience or
  // a condition can matter, the VIEWER's tags, follow edges, and account age.
  // The allow/deny lists live in a child table, so they are grouped by block id
  // first; the anonymous cache path needs them too, because a block with a
  // listed user must never be baked into the shared copy.
  const viewerLists =
    blockRows.length > 0
      ? groupViewerLists(await listBlockViewers(c.env.DB, user.id))
      : new Map();
  const conditionsFor = (row: (typeof blockRows)[number]) =>
    conditionsOfRow(row, viewerLists.get(row.id));
  const viewerTagsNeeded =
    !cacheable &&
    blockRows.some((row) => {
      const conditions = conditionsFor(row);
      return (
        (isBlockVisibility(row.visibility) && row.visibility === 'same_tag') ||
        conditions.requiredTags.length > 0 ||
        conditions.excludedTags.length > 0
      );
    });
  // A follow start time is needed for `minFollowDays` and also tells us whether
  // the viewer follows the owner at all (the `followers` / `mutual` relations).
  const followStartNeeded =
    !cacheable && blockRows.some((row) => conditionsFor(row).minFollowDays !== null);
  const viewerFollowsNeeded =
    !cacheable &&
    blockRows.some((row) => {
      const relation = conditionsFor(row).relation;
      return relation === 'followers' || relation === 'mutual';
    });
  const ownerFollowsNeeded =
    !cacheable &&
    blockRows.some((row) => {
      const relation = conditionsFor(row).relation;
      return relation === 'following' || relation === 'mutual';
    });
  const [viewerTagRows, followStartedAt, ownerFollowsViewer] = await Promise.all([
    viewerTagsNeeded && viewer && !isOwner ? listUserTags(c.env.DB, viewer.id) : Promise.resolve([]),
    (followStartNeeded || viewerFollowsNeeded) && viewer && !isOwner
      ? getFollowStartedAt(c.env.DB, viewer.id, user.id)
      : Promise.resolve(null),
    ownerFollowsNeeded && viewer && !isOwner
      ? isFollowing(c.env.DB, user.id, viewer.id)
      : Promise.resolve(false),
  ]);
  const audience: AudienceContext = {
    isOwner,
    viewerIsAuthenticated: Boolean(viewer),
    viewerId: viewer?.id ?? null,
    viewerTagValues: normaliseTagValues(viewerTagRows.map((tag) => tag.value)),
    ownerTagValues: normaliseTagValues(tags.map((tag) => tag.value)),
    viewerFollowsOwner: followStartedAt !== null,
    ownerFollowsViewer,
    followStartedAt,
    viewerAccountCreatedAt: viewer?.created_at ?? null,
    now: Date.now(),
  };
  // The cacheable path is the profile-cache contract: the one anonymous HTML
  // copy served to every visitor may embed only viewer-independent blocks, so
  // it is filtered by `cacheableBlocks` (provably `public` *and* no conditions)
  // and derived from the owner's rows alone — never from the viewer. The
  // non-cacheable path may include viewer-dependent audiences and conditions,
  // which logged-in viewers are never served from cache.
  const renderBlocks = cacheable
    ? cacheableBlocks(blockRows, viewerLists)
    : blockRows.filter((row) => {
        const visibility = isBlockVisibility(row.visibility) ? row.visibility : null;
        // A row with an unknown visibility is not viewable by a non-owner
        // (fail closed) — never `as BlockVisibility`.
        if (visibility === null) return isOwner;
        return canViewBlock(visibility, conditionsFor(row), audience);
      });

  // The stored position counts ALL of the owner's blocks; a viewer may see only
  // a subset, so map it onto the visible list by counting the visible blocks
  // that sit before the stored anchor. A hidden block therefore never pushes
  // the key/value card further down than the owner intended.
  const visibleBlockIds = new Set(renderBlocks.map((row) => row.id));
  const fieldsPosition = blockRows.reduce(
    (count, row, index) =>
      count + (index < storedFieldsPosition && visibleBlockIds.has(row.id) ? 1 : 0),
    0,
  );

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
      blocks={renderBlocks}
      blockViewers={viewerLists}
      fieldsPosition={fieldsPosition}
      restricted={Boolean(activeBan)}
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
  const activeBan = await getActiveBan(c.env.DB, user.id);
  if (activeBan) {
    if (isOwner) return c.redirect('/suspended');
    if (!c.get('isAdmin')) return c.notFound();
  }
  if (user.visibility === 'private' && !isOwner) return c.notFound();

  const variant = kind === 'followers' ? ':followers' : ':following';
  const canonical = `${appUrl(c.env)}/${user.username}/${kind}`;
  const cacheable = !viewer && user.visibility === 'public';
  const robots =
    activeBan || user.visibility !== 'public' ? 'noindex, nofollow' : undefined;
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
