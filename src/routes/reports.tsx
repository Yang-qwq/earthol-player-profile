/**
 * The reporter-side reports module (`/reports`). Lists every report the signed
 * in user filed, its moderation state, and the in-app receipts moderators sent
 * back. Opening the page marks those receipts read (the badge clears on the
 * next navigation) while still highlighting which ones were new for this
 * render. Mounted before the `/:username` catch-all.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { ReportsInbox } from '../views/reports';
import {
  listMyReports,
  listReceiptsForReporter,
  markReceiptsReadForReporter,
} from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { navUser } from '../lib/view';

export const reportsRoutes = new Hono<AppContext>();

reportsRoutes.get('/reports', requireAuth, async (c) => {
  const user = c.get('user')!;
  const [reports, receipts] = await Promise.all([
    listMyReports(c.env.DB, user.id),
    listReceiptsForReporter(c.env.DB, user.id),
  ]);
  const unread = receipts.filter((receipt) => receipt.read_at === null).length;
  if (unread > 0) await markReceiptsReadForReporter(c.env.DB, user.id);

  const settings = c.get('settings');
  return c.html(
    <ReportsInbox
      appName={c.get('appName')}
      faviconUrl={settings.faviconUrl}
      logoUrl={settings.logoUrl}
      customCss={settings.customCss}
      customJs={settings.customJs}
      customFooter={settings.customFooter}
      csrfToken={c.get('csrfToken')}
      currentUser={navUser(user)}
      isAdmin={c.get('isAdmin')}
      reports={reports}
      receipts={receipts}
      receiptUnread={unread}
      nonce={c.get('secureHeadersNonce')}
      t={c.get('t')}
      locale={c.get('locale')}
    />,
    200,
    { 'Cache-Control': 'no-store' },
  );
});
