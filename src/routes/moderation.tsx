/**
 * User-facing moderation pages: the report form (`/report/:username`) and the
 * suspension notice (`/suspended`). Mounted before the `/:username` catch-all
 * in `publicRoutes`. Reports are auth-gated, deduplicated per reporter/target,
 * and rate-limited; the admin queue lives in `src/routes/admin.tsx`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { ReportPage } from '../views/report';
import { SuspendedPage } from '../views/suspended';
import {
  createReport,
  getActiveBan,
  getOpenReportByReporter,
  getUserByUsername,
} from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { MAX_REPORT_DETAILS, REPORT_REASONS, isReportReason } from '../lib/moderation';
import { text } from '../lib/validate';
import { navUser } from '../lib/view';

export const moderationRoutes = new Hono<AppContext>();

moderationRoutes.get('/suspended', async (c) => {
  const viewer = c.get('user');
  if (!viewer) return c.redirect('/login');

  const ban = c.get('ban') ?? (await getActiveBan(c.env.DB, viewer.id));
  if (!ban) return c.redirect('/');

  const settings = c.get('settings');
  return c.html(
    <SuspendedPage
      appName={c.get('appName')}
      faviconUrl={settings.faviconUrl}
      logoUrl={settings.logoUrl}
      customCss={settings.customCss}
      customJs={settings.customJs}
      customFooter={settings.customFooter}
      ban={ban}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(viewer)}
      nonce={c.get('secureHeadersNonce')}
      t={c.get('t')}
      locale={c.get('locale')}
    />,
    403,
    { 'Cache-Control': 'no-store' },
  );
});

async function reportTarget(c: Context<AppContext>) {
  const username = (c.req.param('username') ?? '').toLowerCase();
  const target = username ? await getUserByUsername(c.env.DB, username) : null;
  return target;
}

moderationRoutes.get('/report/:username', requireAuth, async (c) => {
  const t = c.get('t');
  const viewer = c.get('user')!;
  const target = await reportTarget(c);
  // A private profile behaves exactly like it does on the public route.
  if (!target || !target.username) return c.notFound();
  if (target.visibility === 'private' && target.id !== viewer.id) return c.notFound();

  const settings = c.get('settings');
  let mode: 'form' | 'sent' | 'already' | 'blocked' = 'form';
  let notice: string | undefined;

  if (target.id === viewer.id) {
    mode = 'blocked';
    notice = t('report.self');
  } else if (await getActiveBan(c.env.DB, target.id)) {
    mode = 'blocked';
    notice = t('report.suspended');
  } else {
    const open = await getOpenReportByReporter(c.env.DB, viewer.id, target.id);
    if (open) mode = c.req.query('sent') === '1' ? 'sent' : 'already';
    else if (c.req.query('sent') === '1') mode = 'sent';
  }

  const errorCode = c.req.query('error');
  const error =
    errorCode === 'invalid_reason'
      ? t('report.err.invalidReason')
      : errorCode === 'rate_limited'
        ? t('report.err.rateLimited')
        : undefined;

  return c.html(
    <ReportPage
      appName={c.get('appName')}
      faviconUrl={settings.faviconUrl}
      logoUrl={settings.logoUrl}
      customCss={settings.customCss}
      customJs={settings.customJs}
      customFooter={settings.customFooter}
      target={target}
      reasons={REPORT_REASONS}
      mode={mode}
      notice={notice}
      error={error}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(viewer)}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
    />,
    200,
    { 'Cache-Control': 'no-store' },
  );
});

moderationRoutes.post('/report/:username', requireAuth, async (c) => {
  const viewer = c.get('user')!;
  const target = await reportTarget(c);
  const back = `/report/${encodeURIComponent((c.req.param('username') ?? '').toLowerCase())}`;
  if (!target || !target.username) return c.notFound();
  if (target.visibility === 'private' && target.id !== viewer.id) return c.notFound();

  // Self-reports and reports against an already restricted account are not
  // accepted; both render an explanatory state on the GET page.
  if (target.id === viewer.id || (await getActiveBan(c.env.DB, target.id))) {
    return c.redirect(back);
  }

  // One open report per reporter/target keeps the queue meaningful and makes a
  // double submit harmless.
  if (await getOpenReportByReporter(c.env.DB, viewer.id, target.id)) {
    return c.redirect(`${back}?sent=1`);
  }

  const body = await c.req.parseBody();
  const reason = body.reason;
  if (!isReportReason(reason)) return c.redirect(`${back}?error=invalid_reason`);
  const details = text(body.details, MAX_REPORT_DETAILS) || null;

  const ip = clientIp(c.req.raw.headers);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(c.env.KV, `report:user:${viewer.id}`, 5, 3600),
    rateLimit(c.env.KV, `report:ip:${ip}`, 20, 3600),
  ]);
  if (!userLimit.allowed || !ipLimit.allowed) {
    return c.redirect(`${back}?error=rate_limited`);
  }

  await createReport(c.env.DB, {
    reporterId: viewer.id,
    targetUserId: target.id,
    reason,
    details,
  });

  return c.redirect(`${back}?sent=1`);
});
