/**
 * Application assembly. Sets the security headers/CSP, installs the global
 * middleware chain (locale → user → runtime → CSRF), and mounts routers in
 * order. `publicRoutes` owns the `/:username` catch-all, so it goes last.
 */
import { Hono } from 'hono';
import { secureHeaders, NONCE } from 'hono/secure-headers';
import type { AppContext } from './types';
import { healthRoutes } from './routes/health';
import { publicRoutes } from './routes/public';
import { authRoutes } from './routes/auth';
import { apiRoutes } from './routes/api';
import { onboardingRoutes } from './routes/onboarding';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { languageRoutes } from './routes/language';
import { csrfProtection, loadUser } from './middleware/auth';
import { resolveLocale } from './middleware/locale';
import { loadRuntime } from './middleware/runtime';
import { htmlLang } from './i18n';

export function createApp() {
  const app = new Hono<AppContext>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", NONCE, 'https://unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );

  // Order matters: locale → user (sets isAdmin) → runtime (settings + the
  // maintenance gate, which needs isAdmin) → CSRF.
  app.use('*', resolveLocale);
  app.use('*', loadUser);
  app.use('*', loadRuntime);
  app.use('*', csrfProtection);

  app.route('/', healthRoutes);
  app.route('/', apiRoutes);
  app.route('/', languageRoutes);
  app.route('/', authRoutes);
  app.route('/', onboardingRoutes);
  app.route('/', dashboardRoutes);
  app.route('/', adminRoutes);
  app.route('/', publicRoutes);

  app.notFound((c) => {
    const t = c.get('t');
    return c.html(
      <html lang={htmlLang(c.get('locale'))}>
        <body>
          <h1>404</h1>
          <p>{t ? t('notFound.body') : 'This page drifted off the map.'}</p>
        </body>
      </html>,
      404,
    );
  });

  app.onError((err, c) => {
    console.error(err);
    return c.text('Internal Server Error', 500);
  });

  return app;
}
