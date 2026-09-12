/** Marketing landing page for signed-out visitors (a shortcut for users). */
import type { TranslateFn } from '../i18n';

export interface HomeProps {
  appName: string;
  t: TranslateFn;
  loggedIn?: boolean;
}

export function Home({ appName, t, loggedIn }: HomeProps) {
  const steps = [
    { title: t('home.step1Title'), body: t('home.step1Body') },
    { title: t('home.step2Title'), body: t('home.step2Body') },
    { title: t('home.step3Title'), body: t('home.step3Body') },
  ];

  return (
    <section class="flex flex-col items-start gap-10 py-6">
      <span class="chip border border-primary/30 bg-primary/10 text-primary">
        <span class="h-1.5 w-1.5 rounded-full bg-primary" />
        {t('home.badge')}
      </span>

      <div class="space-y-5">
        <h1 class="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          {t('home.heroLead')}
          <span class="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            {t('home.heroAccent')}
          </span>
          {t('home.heroTail')}
        </h1>
        <p class="max-w-2xl text-lg text-muted-foreground">{t('home.subtitle', { appName })}</p>
      </div>

      <div class="flex flex-wrap gap-3">
        <a href={loggedIn ? '/dashboard' : '/login'} class="btn-primary px-6 py-3 text-base">
          {loggedIn ? t('nav.dashboard') : t('home.ctaClaim')}
        </a>
        <a href="#how" class="btn-outline px-6 py-3 text-base">
          {t('home.ctaHow')}
        </a>
      </div>

      <div id="how" class="grid w-full gap-4 pt-6 sm:grid-cols-3">
        {steps.map((step) => (
          <div class="card p-6">
            <h3 class="font-semibold">{step.title}</h3>
            <p class="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
