/**
 * Authentication routes: login page, GitHub OAuth flow, magic-link send and
 * consume, and logout. Magic-link tokens are single-use and stored hashed;
 * mail and OAuth failures redirect back with a generic error, never a 500.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import type { UserRow } from '../db/types';
import { Login } from '../views/login';
import {
  createLoginToken,
  consumeLoginToken,
  getLoginToken,
} from '../db/queries';
import { resolveAccount } from '../lib/accounts';
import { createSession, destroySession } from '../lib/session';
import { randomToken, sha256Hex } from '../lib/crypto';
import { magicLinkEmail, getMailer } from '../lib/email';
import { clientIp, rateLimit } from '../lib/ratelimit';
import {
  exchangeGithubCode,
  fetchGithubPrimaryEmail,
  fetchGithubUser,
  githubAuthorizeUrl,
  githubConfigured,
} from '../lib/oauth-github';
import { isValidEmail, normalizeEmail, safeRedirectPath } from '../lib/validate';
import { appUrl } from '../lib/env';
import type { TranslateFn } from '../i18n';

export const authRoutes = new Hono<AppContext>();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

function safeNext(value: unknown, base: string): string | undefined {
  return safeRedirectPath(value, base);
}

function landingFor(user: UserRow): string {
  return user.username ? '/dashboard' : '/onboarding';
}

function errorMessage(code: string | undefined, t: TranslateFn): string | undefined {
  switch (code) {
    case 'github_unavailable':
      return t('login.githubUnavailable');
    case 'github_failed':
      return t('auth.err.githubFailed');
    case 'invalid_token':
      return t('auth.err.invalidToken');
    case 'signup_disabled':
      return t('auth.err.signupDisabled');
    default:
      return undefined;
  }
}

authRoutes.get('/login', (c) => {
  const user = c.get('user');
  if (user) return c.redirect(landingFor(user));

  const t = c.get('t');
  const settings = c.get('settings');
  const next = safeNext(c.req.query('next'), appUrl(c.env));
  return c.html(
    <Login
      appName={c.get('appName')}
      faviconUrl={settings.faviconUrl}
      csrfToken={c.get('csrfToken')}
      githubEnabled={githubConfigured(c.env) && settings.githubLoginEnabled}
      magicEnabled={settings.magicLinkEnabled}
      next={next}
      error={errorMessage(c.req.query('error'), t)}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
      pathname="/login"
    />,
  );
});

authRoutes.get('/auth/github', async (c) => {
  if (!githubConfigured(c.env) || !c.get('settings').githubLoginEnabled) {
    return c.redirect('/login?error=github_unavailable');
  }

  const state = randomToken(16);
  const next = safeNext(c.req.query('next'), appUrl(c.env));
  await c.env.KV.put(`oauth:github:${state}`, JSON.stringify({ next: next ?? null }), {
    expirationTtl: 600,
  });

  const redirectUri = `${appUrl(c.env)}/auth/github/callback`;
  return c.redirect(githubAuthorizeUrl(c.env, state, redirectUri));
});

authRoutes.get('/auth/github/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  if (!state || !code) return c.redirect('/login?error=github_failed');

  const stored = await c.env.KV.get(`oauth:github:${state}`);
  if (!stored) return c.redirect('/login?error=github_failed');
  await c.env.KV.delete(`oauth:github:${state}`);

  let next: string | null = null;
  try {
    next = (JSON.parse(stored) as { next: string | null }).next;
  } catch {
    next = null;
  }

  try {
    const redirectUri = `${appUrl(c.env)}/auth/github/callback`;
    const accessToken = await exchangeGithubCode(c.env, code, redirectUri);
    const ghUser = await fetchGithubUser(accessToken);
    const email = ghUser.email ?? (await fetchGithubPrimaryEmail(accessToken));

    const settings = c.get('settings');
    const user = await resolveAccount(c.env.DB, {
      provider: 'github',
      providerUserId: String(ghUser.id),
      email,
      allowCreate: settings.signupsEnabled,
      defaults: { theme: settings.defaultTheme, visibility: settings.defaultVisibility },
    });
    if (!user) return c.redirect('/login?error=signup_disabled');
    await createSession(c, user.id);

    return c.redirect(safeNext(next, appUrl(c.env)) ?? landingFor(user));
  } catch (error) {
    console.error('GitHub OAuth failed', error);
    return c.redirect('/login?error=github_failed');
  }
});

authRoutes.post('/auth/email', async (c) => {
  const t = c.get('t');
  const locale = c.get('locale');
  const settings = c.get('settings');
  const body = await c.req.parseBody();
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const next = safeNext(body.next, appUrl(c.env));

  const render = (message?: string, error?: string) =>
    c.html(
      <Login
        appName={c.get('appName')}
        faviconUrl={settings.faviconUrl}
        csrfToken={c.get('csrfToken')}
        githubEnabled={githubConfigured(c.env) && settings.githubLoginEnabled}
        magicEnabled={settings.magicLinkEnabled}
        next={next}
        message={message}
        error={error}
        nonce={c.get('secureHeadersNonce')}
        t={t}
        locale={locale}
        pathname="/login"
      />,
      error ? 400 : 200,
    );

  if (!settings.magicLinkEnabled) return render(undefined, t('auth.err.magicDisabled'));
  if (!isValidEmail(rawEmail)) return render(undefined, t('auth.err.invalidEmail'));
  const email = normalizeEmail(rawEmail);

  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(c.env.KV, `email:ip:${ip}`, 10, 3600),
    rateLimit(c.env.KV, `email:addr:${email}`, 5, 3600),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return render(undefined, t('auth.err.rateLimited'));
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await createLoginToken(c.env.DB, {
    tokenHash,
    email,
    expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
  });

  const link =
    `${appUrl(c.env)}/auth/email/verify?token=${encodeURIComponent(token)}` +
    (next ? `&next=${encodeURIComponent(next)}` : '');
  try {
    await getMailer(c.env).send({ to: email, ...magicLinkEmail(t, link, c.get('appName')) });
  } catch (error) {
    console.error('Magic-link email failed', error);
    return render(undefined, t('auth.err.sendFailed'));
  }

  return render(t('auth.emailSent'));
});

authRoutes.get('/auth/email/verify', async (c) => {
  const token = c.req.query('token');
  const next = safeNext(c.req.query('next'), appUrl(c.env));
  if (!token) return c.redirect('/login?error=invalid_token');

  const tokenHash = await sha256Hex(token);
  const row = await getLoginToken(c.env.DB, tokenHash);
  if (!row || row.consumed_at || row.expires_at < Date.now()) {
    return c.redirect('/login?error=invalid_token');
  }

  // Atomic claim: a concurrent request that already consumed the token loses here.
  if (!(await consumeLoginToken(c.env.DB, tokenHash))) {
    return c.redirect('/login?error=invalid_token');
  }
  const settings = c.get('settings');
  const user = await resolveAccount(c.env.DB, {
    provider: 'email',
    providerUserId: row.email,
    email: row.email,
    allowCreate: settings.signupsEnabled,
    defaults: { theme: settings.defaultTheme, visibility: settings.defaultVisibility },
  });
  if (!user) return c.redirect('/login?error=signup_disabled');
  await createSession(c, user.id);

  return c.redirect(next ?? landingFor(user));
});

authRoutes.post('/auth/logout', async (c) => {
  await destroySession(c);
  return c.redirect('/');
});
