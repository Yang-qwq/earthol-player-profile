/**
 * Public profile page. Renders the card, tags, key/value fields, and the
 * client-side share tools (QR + NFC), plus an inline `SHARE_SCRIPT` that is
 * locale-agnostic (UI strings arrive as a JSON literal).
 */
import { Layout } from './layout';
import type { FieldRow, UserRow, UserTagRow } from '../db/types';
import { renderMfmBio } from '../lib/mfm';
import { tagChipClasses } from '../lib/tags';
import { themeStyle } from '../lib/themes';
import { isSafeUrl } from '../lib/validate';
import type { Locale, TranslateFn } from '../i18n';

export interface ProfileProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  user: UserRow;
  fields: FieldRow[];
  tags: UserTagRow[];
  csrfToken: string;
  currentUser?: { username: string; displayName?: string | null } | null;
  isOwner?: boolean;
  isFollowing?: boolean;
  followerCount?: number;
  followingCount?: number;
  canonical?: string;
  robots?: string;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  isAdmin?: boolean;
}

export function initials(user: UserRow): string {
  const source = user.display_name || user.username || '?';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * The follow button cluster shown on a profile (and per row on the
 * followers/following list pages): owners get an edit link, logged-in
 * visitors get a follow/unfollow toggle (htmx swaps this whole block in place
 * via `POST /api/follow/:username`; the native form fallback reloads the
 * page), and anonymous visitors get a link into sign-in with the profile as
 * `next`.
 */
export function FollowControl(props: {
  username: string;
  isOwner: boolean;
  isLoggedIn: boolean;
  isFollowing: boolean;
  csrfToken: string;
  notice?: string;
  t: TranslateFn;
}) {
  const { username, isOwner, isLoggedIn, isFollowing, csrfToken, notice, t } = props;
  const followUrl = `/api/follow/${encodeURIComponent(username)}`;
  const loginUrl = `/login?next=${encodeURIComponent(`/${username}`)}`;

  if (isOwner) {
    return (
      <div class="flex shrink-0 items-center gap-2" data-follow-control>
        <a class="btn-outline" href="/dashboard">
          <span class="material-symbols-outlined icon-sm" aria-hidden="true">
            edit
          </span>
          {t('profile.edit')}
        </a>
        {notice ? (
          <span class="text-xs text-danger" role="status">
            {notice}
          </span>
        ) : null}
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div class="flex shrink-0 items-center gap-2" data-follow-control>
        <a class="btn-primary" href={loginUrl}>
          <span class="material-symbols-outlined icon-sm" aria-hidden="true">
            person_add
          </span>
          {t('profile.follow')}
        </a>
      </div>
    );
  }

  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2" data-follow-control>
      <form
        method="post"
        action={followUrl}
        hx-post={followUrl}
        hx-target="closest [data-follow-control]"
        hx-swap="outerHTML"
        hx-scroll="false"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <button
          type="submit"
          class={isFollowing ? 'btn-outline' : 'btn-primary'}
          aria-pressed={isFollowing}
          aria-label={t(isFollowing ? 'profile.following' : 'profile.follow')}
          title={t(isFollowing ? 'profile.following' : 'profile.follow')}
        >
          <span class="material-symbols-outlined icon-sm" aria-hidden="true">
            {isFollowing ? 'check_circle' : 'person_add'}
          </span>
          {t(isFollowing ? 'profile.following' : 'profile.follow')}
        </button>
      </form>
      {notice ? (
        <span class="text-xs text-danger" role="status">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The follower/following stats row shown under the profile header (and on the
 * two list pages). Both counts are attributes of the profiled user, not the
 * viewer, so the row is safe to bake into the cached anonymous HTML.
 */
export function FollowStats(props: {
  username: string;
  followerCount: number;
  followingCount: number;
  t: TranslateFn;
}) {
  const { username, followerCount, followingCount, t } = props;
  return (
    <div class="flex items-center gap-4 text-sm">
      <a class="hover:underline" href={`/${encodeURIComponent(username)}/followers`}>
        <span class="font-bold tabular-nums">{followerCount}</span>{' '}
        <span class="text-muted-foreground">{t('profile.followers')}</span>
      </a>
      <a class="hover:underline" href={`/${encodeURIComponent(username)}/following`}>
        <span class="font-bold tabular-nums">{followingCount}</span>{' '}
        <span class="text-muted-foreground">{t('profile.following')}</span>
      </a>
    </div>
  );
}

// Client-side share tools: lazy-loads `qrcode-generator` from unpkg (already
// allowed by the CSP), renders an SVG QR, exports it as PNG, and writes the
// profile URL to an NFC tag via WebNFC. Strings are injected as a JSON literal
// so the logic stays locale-agnostic. No eval, CSP-compatible.
const SHARE_SCRIPT = (s: Record<string, string>) =>
  `(function(){var S=${JSON.stringify(s)};function init(){var root=document.querySelector('[data-share]');if(!root)return;var url=root.getAttribute('data-share-url')||'';var qrBox=root.querySelector('[data-share-qr]');var status=root.querySelector('[data-share-status]');var copyBtn=root.querySelector('[data-share-copy]');var genBtn=root.querySelector('[data-share-generate]');var dlBtn=root.querySelector('[data-share-download]');var nfcBtn=root.querySelector('[data-share-nfc]');var nfcStatus=root.querySelector('[data-share-nfc-status]');var qr=null;function set(el,msg){if(el)el.textContent=msg;}function ensureQrcode(cb,fail){if(typeof qrcode==='function'){cb();return;}var existing=document.querySelector('script[data-share-qr-lib]');if(existing){existing.addEventListener('load',cb);existing.addEventListener('error',fail);return;}var s=document.createElement('script');s.src='https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';s.setAttribute('data-share-qr-lib','');s.addEventListener('load',cb);s.addEventListener('error',fail);document.head.appendChild(s);}function renderQr(){if(!url)return;ensureQrcode(function(){try{var q=qrcode(0,'M');q.addData(url);q.make();qr=q;if(qrBox){qrBox.classList.add('is-ready');qrBox.innerHTML=q.createSvgTag({cellSize:6,margin:2,scalable:true});}if(genBtn)genBtn.disabled=true;if(dlBtn)dlBtn.disabled=false;}catch(e){if(qrBox)qrBox.textContent=S.qrFailed;if(genBtn)genBtn.disabled=false;}},function(){if(qrBox)qrBox.textContent=S.qrFailed;if(genBtn)genBtn.disabled=false;});}function fallbackCopy(cb){var ta=document.createElement('textarea');ta.value=url;ta.setAttribute('readonly','');ta.style.position='absolute';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');cb();}catch(e){}document.body.removeChild(ta);}function copy(){if(!url)return;function done(){set(status,S.copied);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done).catch(function(){fallbackCopy(done);});}else{fallbackCopy(done);}}function download(){if(!qr)return;var n=qr.getModuleCount(),scale=10,margin=4,size=(n+margin*2)*scale;var canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;var ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000000';for(var r=0;r<n;r++){for(var c=0;c<n;c++){if(qr.isDark(r,c))ctx.fillRect((c+margin)*scale,(r+margin)*scale,scale,scale);}}var a=document.createElement('a');a.download='profile-qr.png';a.href=canvas.toDataURL('image/png');a.click();}var reader=null,abort=null,busy=false,writing=false;if(!('NDEFReader' in window)||!window.isSecureContext){set(nfcStatus,S.nfcUnsupported);}else{set(nfcStatus,S.nfcReady);if(nfcBtn)nfcBtn.disabled=false;}function fail(err){var msg=err&&err.message?err.message:'';set(nfcStatus,S.nfcError.replace('{message}',msg));busy=false;writing=false;if(nfcBtn)nfcBtn.disabled=false;}function writeNfc(){if(!url||busy)return;busy=true;writing=false;if(nfcBtn)nfcBtn.disabled=true;try{reader=new NDEFReader();abort=new AbortController();var scanning=reader.scan({signal:abort.signal});reader.addEventListener('reading',function(){if(writing)return;writing=true;set(nfcStatus,S.nfcWriting);reader.write({records:[{recordType:'url',data:url}]}).then(function(){set(nfcStatus,S.nfcSuccess);if(abort)abort.abort();writing=false;busy=false;if(nfcBtn)nfcBtn.disabled=false;}).catch(function(err){writing=false;fail(err);});});reader.addEventListener('readingerror',function(){if(writing)return;set(nfcStatus,S.nfcReadError);});set(nfcStatus,S.nfcWaiting);scanning.catch(fail);}catch(err){fail(err);}}if(copyBtn)copyBtn.addEventListener('click',copy);if(genBtn)genBtn.addEventListener('click',renderQr);if(dlBtn)dlBtn.addEventListener('click',download);if(nfcBtn)nfcBtn.addEventListener('click',writeNfc);}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}})();`;

export function Profile({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  user,
  fields,
  tags,
  csrfToken,
  currentUser,
  isOwner,
  isFollowing,
  followerCount,
  followingCount,
  canonical,
  robots,
  nonce,
  t,
  locale,
  pathname,
  isAdmin,
}: ProfileProps) {
  const theme = themeStyle(user.theme);
  const name = user.display_name || `@${user.username}`;
  const description =
    user.headline ||
    t('profile.defaultDescription', { username: user.username ?? '', appName });
  const shareUrl = canonical ?? '';
  // og:image must be an absolute URL; uploaded avatars are same-origin paths.
  const ogImage =
    user.avatar_url && user.avatar_url.startsWith('/')
      ? canonical
        ? `${new URL(canonical).origin}${user.avatar_url}`
        : undefined
      : user.avatar_url;

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={name}
      description={description}
      csrfToken={csrfToken}
      currentUser={currentUser}
      canonical={canonical}
      robots={robots}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin={isAdmin}
      og={{
        title: `${name} (@${user.username})`,
        description,
        url: canonical ?? '',
        image: ogImage,
        type: 'profile',
      }}
    >
      <section class="mx-auto max-w-2xl pt-2">
        <div class="card overflow-hidden">
          <div class={`h-28 bg-gradient-to-r ${theme.accent}`} />
          <div class="px-6 pb-6">
            <div class="-mt-14 flex">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={name}
                  width="96"
                  height="96"
                  class={`h-24 w-24 rounded-2xl border-4 border-card bg-muted object-cover shadow-card ring-2 ${theme.ring}`}
                />
              ) : (
                <div
                  class={`grid h-24 w-24 place-items-center rounded-2xl border-4 border-card bg-gradient-to-br ${theme.accent} text-3xl font-bold text-white shadow-card`}
                >
                  {initials(user)}
                </div>
              )}
            </div>

            <div class="mt-4 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <h1 class="truncate text-2xl font-bold tracking-tight">{name}</h1>
                <p class="truncate text-sm font-medium text-muted-foreground">@{user.username}</p>
              </div>
              {/* Follow actions: real toggle for signed-in visitors (htmx
                  swaps the cluster in place), sign-in prompt for anonymous
                  viewers, edit shortcut for the owner. The report option in
                  the menu stays hidden until that feature ships. */}
              <div class="flex shrink-0 items-center gap-1.5">
                <FollowControl
                  username={user.username ?? ''}
                  isOwner={Boolean(isOwner)}
                  isLoggedIn={Boolean(currentUser)}
                  isFollowing={Boolean(isFollowing)}
                  csrfToken={csrfToken}
                  t={t}
                />
                <div class="dropdown" data-dropdown>
                  <button
                    type="button"
                    class="btn-icon"
                    data-dropdown-toggle
                    aria-label={t('profile.more')}
                    title={t('profile.more')}
                    aria-haspopup="menu"
                    aria-expanded="false"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">
                      more_horiz
                    </span>
                  </button>
                  <div class="dropdown-menu" data-dropdown-menu role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      data-profile-report
                      class="hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                        report
                      </span>
                      {t('profile.report')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3">
              <FollowStats
                username={user.username ?? ''}
                followerCount={followerCount ?? 0}
                followingCount={followingCount ?? 0}
                t={t}
              />
            </div>

            {user.headline ? <p class="mt-2 text-foreground/90">{user.headline}</p> : null}

            <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {user.pronouns ? <span>{user.pronouns}</span> : null}
              {user.location ? <span>{user.location}</span> : null}
              {user.website ? (
                <a
                  class="font-semibold text-primary hover:underline"
                  href={user.website}
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                >
                  {user.website.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
            </div>

            {user.bio ? (
              <div
                class="mfm-bio mt-5 leading-relaxed text-foreground/85"
                dangerouslySetInnerHTML={{ __html: renderMfmBio(user.bio) }}
              />
            ) : null}

            {tags.length > 0 ? (
              <div class="mt-5 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span key={tag.id} class={`chip ${tagChipClasses(tag.category_color)}`}>
                  <span class="text-[10px] font-bold uppercase tracking-wider opacity-70">
                    {tag.category_name}
                  </span>
                  <span>{tag.value}</span>
                  {isOwner && tag.hidden ? (
                    <span class="material-symbols-outlined icon-xs opacity-70" aria-hidden="true">
                      visibility_off
                    </span>
                  ) : null}
                </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {fields.length > 0 ? (
          <dl class="mt-5 grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div class="card px-4 py-3.5">
                <dt class="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </dt>
                <dd class="mt-1 break-words text-sm font-medium">
                  {isSafeUrl(field.value) ? (
                    <a
                      class="font-semibold text-primary hover:underline"
                      href={field.value.trim()}
                      rel="nofollow noopener noreferrer"
                      target="_blank"
                    >
                      {field.value.trim().replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span class="text-foreground/90">{field.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {shareUrl ? (
          <section class="mt-5" data-share data-share-url={shareUrl}>
            <div class="card p-6">
              <div class="mb-5 flex items-center gap-3">
                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <span class="material-symbols-outlined" aria-hidden="true">
                    qr_code_2
                  </span>
                </span>
                <div>
                  <h2 class="text-lg font-bold tracking-tight">{t('profile.shareHeading')}</h2>
                  <p class="mt-0.5 text-sm text-muted-foreground">{t('profile.shareSubtitle')}</p>
                </div>
              </div>

              <div class="grid gap-6 sm:grid-cols-[13rem_1fr]">
                <div class="flex flex-col items-center gap-3">
                  <div data-share-qr class="share-qr-box">
                    <span class="px-2 text-xs text-muted-foreground">
                      {t('profile.qrPlaceholder')}
                    </span>
                  </div>
                  <div class="flex flex-wrap justify-center gap-2">
                    <button type="button" data-share-generate class="btn-outline">
                      <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                        qr_code_2
                      </span>
                      {t('profile.qrGenerate')}
                    </button>
                    <button type="button" data-share-download class="btn-outline" disabled>
                      <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                        download
                      </span>
                      {t('profile.qrDownload')}
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-4">
                  <div>
                    <label class="label" for="share-url">
                      {t('profile.shareUrl')}
                    </label>
                    <div class="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="share-url"
                        readonly
                        value={shareUrl}
                        class="field font-mono text-xs"
                        data-share-input
                      />
                      <button type="button" data-share-copy class="btn-outline shrink-0">
                        <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                          content_copy
                        </span>
                        {t('profile.copyLink')}
                      </button>
                    </div>
                    <p data-share-status class="mt-1.5 min-h-4 text-xs text-success" aria-live="polite" />
                  </div>

                  <div class="rounded-2xl bg-muted p-4">
                    <div class="mb-2 flex items-center gap-2">
                      <span class="material-symbols-outlined icon-sm text-primary" aria-hidden="true">
                        nfc
                      </span>
                      <span class="text-sm font-semibold">{t('profile.nfcHeading')}</span>
                    </div>
                    <button type="button" data-share-nfc class="btn-primary w-full sm:w-auto" disabled>
                      <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                        contactless
                      </span>
                      {t('profile.nfcWrite')}
                    </button>
                    <p data-share-nfc-status class="mt-2 text-xs text-muted-foreground" aria-live="polite">
                      {t('profile.nfcChecking')}
                    </p>
                    <p class="mt-1 text-xs text-muted-foreground">{t('profile.nfcHint')}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: SHARE_SCRIPT({
              qrFailed: t('profile.qrFailed'),
              copied: t('profile.copied'),
              nfcUnsupported: t('profile.nfcUnsupported'),
              nfcReady: t('profile.nfcReady'),
              nfcWaiting: t('profile.nfcWaiting'),
              nfcWriting: t('profile.nfcWriting'),
              nfcSuccess: t('profile.nfcSuccess'),
              nfcError: t('profile.nfcError'),
              nfcReadError: t('profile.nfcReadError'),
            }),
          }}
        />
      </section>
    </Layout>
  );
}
