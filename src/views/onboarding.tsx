/** First-run handle claim form; posts to `/onboarding`. */
import { Layout } from './layout';
import type { Locale, TranslateFn } from '../i18n';

export interface OnboardingProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  csrfToken: string;
  error?: string;
  username?: string;
  displayName?: string;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
}

export function Onboarding({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  csrfToken,
  error,
  username = '',
  displayName = '',
  nonce,
  t,
  locale,
  pathname,
}: OnboardingProps) {
  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={t('onboard.title')}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
    >
      <section class="mx-auto max-w-lg pt-4">
        <div class="card overflow-hidden">
          <div class="space-y-1.5 p-6 pb-0">
            <h1 class="text-2xl font-bold tracking-tight">{t('onboard.heading')}</h1>
            <p class="text-sm text-muted-foreground">{t('onboard.subtitle')}</p>
          </div>

          <div class="space-y-4 p-6">
            {error ? (
              <p class="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/25">
                {error}
              </p>
            ) : null}

            <form method="post" action="/onboarding" class="space-y-4">
              <input type="hidden" name="_csrf" value={csrfToken} />

              <div>
                <label class="label" for="username">
                  {t('onboard.handleLabel')}
                </label>
                <div class="flex items-center rounded-full border border-border bg-muted pr-1 transition focus-within:border-primary focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
                  <span class="pl-4 text-muted-foreground">/</span>
                  <input
                    id="username"
                    name="username"
                    value={username}
                    required
                    minlength={3}
                    maxlength={30}
                    autocomplete="off"
                    placeholder="yourname"
                    class="w-full bg-transparent px-2 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                    hx-get="/api/username-available"
                    hx-trigger="keyup changed delay:400ms"
                    hx-target="#username-status"
                    hx-swap="innerHTML"
                  />
                </div>
                <div id="username-status" class="mt-1.5 min-h-5 px-1 text-xs text-muted-foreground">
                  {t('onboard.handleHint')}
                </div>
              </div>

              <div>
                <label class="label" for="display_name">
                  {t('onboard.displayNameLabel')}
                </label>
                <input
                  id="display_name"
                  name="display_name"
                  value={displayName}
                  maxlength={80}
                  placeholder="Ada Lovelace"
                  class="field"
                />
              </div>

              <button type="submit" class="btn-primary w-full py-3">
                {t('onboard.submit')}
              </button>
            </form>
          </div>
        </div>
      </section>
    </Layout>
  );
}
