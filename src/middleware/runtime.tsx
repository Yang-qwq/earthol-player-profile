/**
 * Per-request runtime middleware (runs after `loadUser`, which sets `isAdmin`).
 * Loads cached settings, exposes `c.get('settings')` / `c.get('appName')` to
 * every handler, and enforces maintenance mode for everyone except admins.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import { getSettings, resolveAppName } from '../lib/settings';
import { Layout } from '../views/layout';

/** Reachable during maintenance so admins can sign in and health checks pass. */
function isAllowedDuringMaintenance(path: string): boolean {
  return (
    path === '/health' ||
    path === '/login' ||
    path.startsWith('/auth/') ||
    path.startsWith('/language/')
  );
}

export const loadRuntime: MiddlewareHandler<AppContext> = async (c, next) => {
  const settings = await getSettings(c.env);
  const appName = resolveAppName(c.env, settings);
  c.set('settings', settings);
  c.set('appName', appName);

  if (settings.maintenanceMode && !c.get('isAdmin')) {
    const path = new URL(c.req.url).pathname;
    if (!isAllowedDuringMaintenance(path)) {
      const t = c.get('t');
      return c.html(
        <Layout
          appName={appName}
          faviconUrl={settings.faviconUrl}
          nonce={c.get('secureHeadersNonce')}
          t={t}
          locale={c.get('locale')}
          pathname={path}
        >
          <section class="mx-auto max-w-md pt-16 text-center">
            <h1 class="text-2xl font-bold tracking-tight">{t('maintenance.heading')}</h1>
            <p class="mt-2 text-muted-foreground">{t('maintenance.body')}</p>
          </section>
        </Layout>,
        503,
      );
    }
  }

  await next();
};
