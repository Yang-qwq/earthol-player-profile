/**
 * User-facing report form. Reached from the profile menu, requires sign-in
 * (the route enforces it), and only ever renders one of four states: the form,
 * a submitted confirmation, an "already reported" notice, or a blocked notice
 * (own profile / already restricted). Everything is escaped by JSX.
 */
import { Layout } from './layout';
import type { UserRow } from '../db/types';
import { MAX_REPORT_DETAILS, REPORT_REASON_KEYS, type ReportReason } from '../lib/moderation';
import type { Locale, TranslateFn } from '../i18n';

export type ReportMode = 'form' | 'sent' | 'already' | 'blocked';

export interface ReportPageProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  target: UserRow;
  reasons: readonly ReportReason[];
  mode: ReportMode;
  /** Extra localized explanation for `blocked` / `already` states. */
  notice?: string;
  error?: string;
  csrfToken: string;
  currentUser: { username: string; displayName?: string | null } | null;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
}

function displayName(user: UserRow): string {
  return user.display_name || `@${user.username}`;
}

function targetInitials(user: UserRow): string {
  const source = user.display_name || user.username || '?';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function ReportPage({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  target,
  reasons,
  mode,
  notice,
  error,
  csrfToken,
  currentUser,
  nonce,
  t,
  locale,
}: ReportPageProps) {
  const username = target.username ?? '';
  const profilePath = `/${encodeURIComponent(username)}`;

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={t('report.title', { username })}
      robots="noindex, nofollow"
      csrfToken={csrfToken}
      currentUser={currentUser}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={`/report/${username}`}
    >
      <section class="mx-auto max-w-2xl space-y-5 pt-2">
        <div class="flex items-center gap-3">
          <a href={profilePath} class="btn-ghost px-3 py-1.5 text-sm">
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              arrow_back
            </span>
            {t('report.back')}
          </a>
        </div>

        <div class="card p-6">
          <div class="flex items-start gap-3">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
              <span class="material-symbols-outlined" aria-hidden="true">
                flag
              </span>
            </span>
            <div>
              <h1 class="text-xl font-bold tracking-tight">{t('report.heading')}</h1>
              <p class="mt-1 text-sm text-muted-foreground">{t('report.subtitle')}</p>
            </div>
          </div>

          <div class="mt-5 flex items-center gap-3 rounded-2xl bg-muted p-3">
            {target.avatar_url ? (
              <img
                src={target.avatar_url}
                alt=""
                width="44"
                height="44"
                class="h-11 w-11 rounded-xl object-cover"
              />
            ) : (
              <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {targetInitials(target)}
              </div>
            )}
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold">{displayName(target)}</p>
              <a href={profilePath} class="truncate text-xs text-muted-foreground hover:text-primary hover:underline">
                @{username}
              </a>
            </div>
          </div>

          {error ? (
            <p class="mt-4 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {mode === 'form' ? (
            <form method="post" action={`/report/${encodeURIComponent(username)}`} class="mt-5 space-y-5">
              <input type="hidden" name="_csrf" value={csrfToken} />

              <fieldset>
                <legend class="label">{t('report.reasonLabel')}</legend>
                <div class="mt-2 space-y-2">
                  {reasons.map((reason, index) => (
                    <label
                      key={reason}
                      class="flex cursor-pointer items-center gap-3 rounded-2xl border border-border px-4 py-3 text-sm transition hover:bg-muted"
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={reason}
                        required
                        checked={index === 0}
                        class="h-4 w-4 accent-primary"
                      />
                      <span class="font-medium">{t(REPORT_REASON_KEYS[reason])}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label class="label" for="report-details">
                  {t('report.detailsLabel')}
                </label>
                <textarea
                  id="report-details"
                  name="details"
                  rows={5}
                  maxlength={MAX_REPORT_DETAILS}
                  placeholder={t('report.detailsPlaceholder')}
                  class="field w-full"
                />
              </div>

              <p class="rounded-2xl bg-muted px-4 py-3 text-xs text-muted-foreground">
                {t('report.privacy')}
              </p>

              <div class="flex flex-wrap items-center gap-2">
                <button type="submit" class="btn-primary">
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    send
                  </span>
                  {t('report.submit')}
                </button>
                <a href={profilePath} class="btn-outline">
                  {t('report.cancel')}
                </a>
              </div>
            </form>
          ) : (
            <div class="mt-5">
              <p
                class={
                  mode === 'blocked'
                    ? 'rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground'
                    : 'rounded-2xl bg-success/10 px-4 py-3 text-sm text-success'
                }
                role="status"
              >
                {mode === 'sent'
                  ? t('report.sentBody')
                  : mode === 'already'
                    ? t('report.alreadyBody')
                    : notice ?? t('report.blockedFallback')}
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <a href={profilePath} class="btn-outline">
                  {t('report.back')}
                </a>
                {mode === 'sent' ? (
                  <a href={currentUser?.username ? '/dashboard' : '/'} class="btn-ghost">
                    {t('report.done')}
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
