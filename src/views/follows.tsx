/**
 * The `GET /:username/followers` and `GET /:username/following` list pages.
 * Each row links to the user's profile; signed-in viewers also get a follow
 * toggle per row (the viewer's own row, when present, shows none).
 */
import { Layout } from './layout';
import { FollowControl, FollowStats, initials } from './profile';
import type { UserRow } from '../db/types';
import type { Locale, TranslateFn } from '../i18n';

export interface FollowListProps {
  appName: string;
  faviconUrl: string;
  logoUrl?: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  /** The profile whose followers/following are listed. */
  target: UserRow;
  kind: 'followers' | 'following';
  rows: UserRow[];
  followerCount: number;
  followingCount: number;
  /** Ids of `rows` the signed-in viewer already follows. */
  followingIds: string[];
  /** The signed-in viewer's id (null when anonymous), for the per-row toggle. */
  viewerId: string | null;
  csrfToken: string;
  currentUser?: { username: string; displayName?: string | null } | null;
  canonical?: string;
  robots?: string;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  isAdmin?: boolean;
}

export function FollowList({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  target,
  kind,
  rows,
  followerCount,
  followingCount,
  followingIds,
  viewerId,
  csrfToken,
  currentUser,
  canonical,
  robots,
  nonce,
  t,
  locale,
  pathname,
  isAdmin,
}: FollowListProps) {
  const name = target.display_name || `@${target.username}`;
  const heading = t(kind === 'followers' ? 'profile.followersOf' : 'profile.followingOf', { name });
  const empty = t(kind === 'followers' ? 'profile.followersEmpty' : 'profile.followingEmpty');
  const followingSet = new Set(followingIds);

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={heading}
      description={heading}
      csrfToken={csrfToken}
      currentUser={currentUser}
      canonical={canonical}
      robots={robots}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin={isAdmin}
    >
      <section class="mx-auto max-w-2xl pt-2">
        <a
          class="btn-ghost -ml-2 mb-3"
          href={`/${encodeURIComponent(target.username ?? '')}`}
        >
          <span class="material-symbols-outlined icon-sm" aria-hidden="true">
            arrow_back
          </span>
          {t('profile.backToProfile')}
        </a>

        <div class="card p-6">
          <div class="flex items-center gap-4">
            {target.avatar_url ? (
              <img
                src={target.avatar_url}
                alt={name}
                width="56"
                height="56"
                class="h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div class="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-muted text-xl font-bold text-muted-foreground">
                {initials(target)}
              </div>
            )}
            <div class="min-w-0">
              <h1 class="truncate text-lg font-bold tracking-tight">{heading}</h1>
              <div class="mt-1.5">
                <FollowStats
                  username={target.username ?? ''}
                  followerCount={followerCount}
                  followingCount={followingCount}
                  t={t}
                />
              </div>
            </div>
          </div>
        </div>

        {rows.length > 0 ? (
          <ul class="card mt-4 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} class="flex items-center gap-3 px-4 py-3">
                <a
                  class="flex min-w-0 flex-1 items-center gap-3"
                  href={`/${encodeURIComponent(row.username ?? '')}`}
                >
                  {row.avatar_url ? (
                    <img
                      src={row.avatar_url}
                      alt={row.display_name || `@${row.username}`}
                      width="40"
                      height="40"
                      class="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">
                      {initials(row)}
                    </div>
                  )}
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold">
                      {row.display_name || `@${row.username}`}
                    </span>
                    <span class="block truncate text-xs text-muted-foreground">
                      @{row.username}
                    </span>
                  </span>
                </a>
                {viewerId && viewerId !== row.id ? (
                  <FollowControl
                    username={row.username ?? ''}
                    isOwner={false}
                    isLoggedIn
                    isFollowing={followingSet.has(row.id)}
                    csrfToken={csrfToken}
                    t={t}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div class="card mt-4 p-6 text-sm text-muted-foreground">{empty}</div>
        )}
      </section>
    </Layout>
  );
}
