/**
 * The suspension notice shown to a banned account (and the only page the
 * `enforceBan` middleware lets it reach, besides sign-out and static assets).
 * The ban reason is a moderation enum, so it is translated when known and
 * rendered as escaped text otherwise.
 */
import { Layout } from './layout';
import type { BanStateRow } from '../db/types';
import { REPORT_REASON_KEYS, isReportReason } from '../lib/moderation';
import type { Locale, TranslateFn } from '../i18n';

export interface SuspendedPageProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  ban: BanStateRow;
  csrfToken: string;
  currentUser: { username: string; displayName?: string | null } | null;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function SuspendedPage({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  ban,
  csrfToken,
  currentUser,
  nonce,
  t,
  locale,
}: SuspendedPageProps) {
  const reason = isReportReason(ban.reason) ? t(REPORT_REASON_KEYS[ban.reason]) : ban.reason;
  const expiresAt = ban.expires_at;
  const until = expiresAt === null ? null : new Date(expiresAt).toISOString().slice(0, 10);
  const daysLeft =
    expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={t('suspended.title')}
      robots="noindex, nofollow"
      csrfToken={csrfToken}
      currentUser={currentUser}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname="/suspended"
    >
      <section class="mx-auto max-w-xl pt-10">
        <div class="card p-7 text-center">
          <span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger">
            <span class="material-symbols-outlined" aria-hidden="true">
              gavel
            </span>
          </span>
          <h1 class="mt-4 text-2xl font-bold tracking-tight">{t('suspended.heading')}</h1>
          <p class="mt-2 text-sm text-muted-foreground">{t('suspended.body')}</p>

          <dl class="mt-6 space-y-3 text-left">
            <div class="rounded-2xl bg-muted px-4 py-3">
              <dt class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('suspended.reason')}
              </dt>
              <dd class="mt-1 text-sm font-medium">{reason}</dd>
            </div>
            <div class="rounded-2xl bg-muted px-4 py-3">
              <dt class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('suspended.expires')}
              </dt>
              <dd class="mt-1 text-sm font-medium">
                {expiresAt === null
                  ? t('suspended.permanent')
                  : t('suspended.until', { date: until ?? '', days: daysLeft ?? 0 })}
              </dd>
            </div>
          </dl>

          <p class="mt-5 text-xs text-muted-foreground">{t('suspended.appeal')}</p>

          <form method="post" action="/auth/logout" class="mt-6">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <button type="submit" class="btn-outline">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                logout
              </span>
              {t('suspended.signOut')}
            </button>
          </form>
        </div>
      </section>
    </Layout>
  );
}
