/**
 * Handle-claim flow for freshly created accounts: shows the onboarding form
 * and validates/claims the chosen username before sending users to the
 * dashboard.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { Onboarding } from '../views/onboarding';
import { claimUsername, isUsernameReserved, isUsernameTaken } from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { isValidUsername, normalizeUsername, text } from '../lib/validate';

export const onboardingRoutes = new Hono<AppContext>();

onboardingRoutes.use('/onboarding', requireAuth);

function renderOnboarding(
  c: Context<AppContext>,
  error?: string,
  username = '',
  displayName = '',
) {
  return c.html(
    <Onboarding
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      csrfToken={c.get('csrfToken')}
      error={error}
      username={username}
      displayName={displayName}
      nonce={c.get('secureHeadersNonce')}
      t={c.get('t')}
      locale={c.get('locale')}
      pathname="/onboarding"
    />,
    error ? 400 : 200,
  );
}

onboardingRoutes.get('/onboarding', (c) => {
  const user = c.get('user')!;
  if (user.username) return c.redirect('/dashboard');
  return renderOnboarding(c);
});

onboardingRoutes.post('/onboarding', async (c) => {
  const user = c.get('user')!;
  if (user.username) return c.redirect('/dashboard');

  const t = c.get('t');
  const body = await c.req.parseBody();
  const username = normalizeUsername(typeof body.username === 'string' ? body.username : '');
  const displayName = text(body.display_name, 80);

  if (!isValidUsername(username)) {
    return renderOnboarding(c, t('dash.err.invalidUsername'), username, displayName);
  }
  if (await isUsernameReserved(c.env.DB, username)) {
    return renderOnboarding(c, t('dash.err.reserved'), username, displayName);
  }
  if (await isUsernameTaken(c.env.DB, username)) {
    return renderOnboarding(c, t('dash.err.taken'), username, displayName);
  }

  await claimUsername(c.env.DB, user.id, username, displayName || null);
  return c.redirect('/dashboard');
});
