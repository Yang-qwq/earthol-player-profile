/** Sign-in page: GitHub button (when configured) plus the magic-link form. */
import { Layout } from './layout';
import type { Locale, TranslateFn } from '../i18n';

export interface LoginProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  csrfToken: string;
  githubEnabled: boolean;
  magicEnabled?: boolean;
  next?: string;
  message?: string;
  error?: string;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
}

export function Login({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  csrfToken,
  githubEnabled,
  magicEnabled = true,
  next,
  message,
  error,
  nonce,
  t,
  locale,
  pathname,
}: LoginProps) {
  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={t('login.title')}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
    >
      <section class="mx-auto max-w-md pt-4">
        <div class="card overflow-hidden">
          <div class="space-y-1.5 p-6 pb-0">
            <h1 class="text-2xl font-bold tracking-tight">{t('login.heading')}</h1>
            <p class="text-sm text-muted-foreground">{t('login.subtitle', { appName })}</p>
          </div>

          <div class="space-y-4 p-6">
            {message ? (
              <p class="rounded-xl bg-success/10 px-4 py-3 text-sm text-success ring-1 ring-inset ring-success/25">
                {message}
              </p>
            ) : null}
            {error ? (
              <p class="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/25">
                {error}
              </p>
            ) : null}

            {githubEnabled ? (
              <a
                href={`/auth/github${next ? `?next=${encodeURIComponent(next)}` : ''}`}
                class="btn-outline w-full py-3"
              >
                <span class="material-symbols-outlined" aria-hidden="true">
                  code
                </span>
                {t('login.github')}
              </a>
            ) : (
              <p class="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {t('login.githubUnavailable')}
              </p>
            )}

            {magicEnabled ? (
              <>
                <div class="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span class="h-px flex-1 bg-border" />
                  {t('login.or')}
                  <span class="h-px flex-1 bg-border" />
                </div>

                <form method="post" action="/auth/email" class="space-y-3">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  {next ? <input type="hidden" name="next" value={next} /> : null}
                  <div>
                    <label class="label" for="email">
                      {t('login.emailLabel')}
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autocomplete="email"
                      placeholder="you@example.com"
                      class="field"
                    />
                  </div>
                  <button type="submit" class="btn-primary w-full py-3">
                    {t('login.emailSubmit')}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </Layout>
  );
}
