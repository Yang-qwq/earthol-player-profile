/**
 * Admin panel (`/admin`): runtime settings, reserved handles, and user
 * management. Every route below is gated by `requireAdmin`; each form posts a
 * `_csrf` field handled by the global CSRF middleware, then redirects back to
 * `/admin` carrying a `?saved=`/`?err=` code that `flash()` turns into a
 * localized banner.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { TranslateFn, MessageKey } from '../i18n';
import { AdminView } from '../views/admin';
import { requireAdmin } from '../middleware/auth';
import { navUser } from '../lib/view';
import { envAdminEmails } from '../lib/admin';
import { saveSettings } from '../lib/settings';
import {
  addReservedUsername,
  createTagCategory,
  deleteUser,
  deleteTagCategory,
  findTagCategoryByName,
  getStats,
  getTagCategory,
  getUserById,
  listReservedUsernames,
  listTagCategories,
  removeReservedUsername,
  searchUsers,
  setUserAdmin,
  updateTagCategory,
} from '../db/queries';
import { invalidateAllProfiles, invalidateProfiles } from '../lib/profile-cache';
import { isTagColor } from '../lib/tags';
import { isTheme, isVisibility } from '../lib/themes';
import { isSafeFaviconUrl, text } from '../lib/validate';

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', requireAdmin);

const SAVED_MESSAGES: Record<string, MessageKey> = {
  settings: 'admin.saved.settings',
  reserved: 'admin.saved.reserved',
  tags: 'admin.saved.tags',
  user: 'admin.saved.user',
  deleted: 'admin.saved.deleted',
};

const ERROR_MESSAGES: Record<string, MessageKey> = {
  self: 'admin.err.self',
  tag_name: 'admin.err.tagName',
  tag_duplicate: 'admin.err.tagDuplicate',
};

/** Turn a redirect's `?saved=` / `?err=` code into a localized banner string. */
function flash(c: Context<AppContext>): { message?: string; error?: string } {
  const t = c.get('t') as TranslateFn;
  const saved = c.req.query('saved');
  const key = saved ? SAVED_MESSAGES[saved] : undefined;
  const message = key ? t(key) : undefined;
  const errKey = c.req.query('err') ? ERROR_MESSAGES[c.req.query('err')!] : undefined;
  const error = errKey ? t(errKey) : undefined;
  return { message, error };
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function is(onOff: unknown): boolean {
  return onOff === '1' || onOff === 'true';
}

function normalizeReserved(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(name) ? name : '';
}

adminRoutes.get('/admin', async (c) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const query = (c.req.query('q') ?? '').trim();

  const [users, reserved, tagCategories, stats] = await Promise.all([
    searchUsers(c.env.DB, query, 50, 0),
    listReservedUsernames(c.env.DB),
    listTagCategories(c.env.DB),
    getStats(c.env.DB),
  ]);
  const { message, error } = flash(c);

  return c.html(
    <AdminView
      appName={c.get('appName')}
      csrfToken={c.get('csrfToken')}
      t={t}
      locale={c.get('locale')}
      pathname="/admin"
      currentUser={navUser(user)}
      selfId={user.id}
      envAdminEmails={envAdminEmails(c.env)}
      settings={c.get('settings')}
      stats={stats}
      reserved={reserved}
      tagCategories={tagCategories}
      users={users}
      query={query}
      message={message}
      error={error}
      nonce={c.get('secureHeadersNonce')}
    />,
  );
});

adminRoutes.post('/admin/settings', async (c) => {
  const current = c.get('settings');
  const body = await c.req.parseBody();

  const theme = text(body.default_theme, 30);
  const visibility = text(body.default_visibility, 30);
  // Blank clears the favicon; a non-empty but unsafe value keeps the current one.
  const faviconRaw = text(body.favicon_url, 500);
  const faviconUrl =
    faviconRaw && !isSafeFaviconUrl(faviconRaw) ? current.faviconUrl : faviconRaw;

  await saveSettings(c.env, {
    siteName: text(body.site_name, 60),
    faviconUrl,
    signupsEnabled: is(body.signups_enabled),
    maintenanceMode: is(body.maintenance_mode),
    githubLoginEnabled: is(body.github_login_enabled),
    magicLinkEnabled: is(body.magic_link_enabled),
    defaultTheme: isTheme(theme) ? theme : current.defaultTheme,
    defaultVisibility: isVisibility(visibility) ? visibility : current.defaultVisibility,
  });

  // Cached profile HTML embeds the favicon <link>, so a change must purge it.
  if (faviconUrl !== current.faviconUrl) await invalidateAllProfiles(c.env.KV);

  return c.redirect('/admin?saved=settings');
});

adminRoutes.post('/admin/reserved/add', async (c) => {
  const body = await c.req.parseBody();
  const name = normalizeReserved(str(body.name));
  if (name) await addReservedUsername(c.env.DB, name);
  return c.redirect('/admin?saved=reserved');
});

adminRoutes.post('/admin/reserved/remove', async (c) => {
  const body = await c.req.parseBody();
  const name = str(body.name).trim().toLowerCase();
  if (name) await removeReservedUsername(c.env.DB, name);
  return c.redirect('/admin?saved=reserved');
});

/* ---------------------------- tag categories --------------------------- */

const MAX_TAG_CATEGORY_NAME = 40;

adminRoutes.post('/admin/tags/add', async (c) => {
  const body = await c.req.parseBody();
  const name = text(body.name, MAX_TAG_CATEGORY_NAME);
  if (!name) return c.redirect('/admin?err=tag_name');
  if (await findTagCategoryByName(c.env.DB, name)) {
    return c.redirect('/admin?err=tag_duplicate');
  }

  const color = text(body.color, 20);
  await createTagCategory(c.env.DB, name, isTagColor(color) ? color : 'sky');
  await invalidateAllProfiles(c.env.KV);
  return c.redirect('/admin?saved=tags');
});

adminRoutes.post('/admin/tags/update', async (c) => {
  const body = await c.req.parseBody();
  const id = str(body.id);
  const existing = id ? await getTagCategory(c.env.DB, id) : null;
  if (!existing) return c.notFound();

  const name = text(body.name, MAX_TAG_CATEGORY_NAME);
  if (!name) return c.redirect('/admin?err=tag_name');
  const clash = await findTagCategoryByName(c.env.DB, name);
  if (clash && clash.id !== id) return c.redirect('/admin?err=tag_duplicate');

  const color = text(body.color, 20);
  await updateTagCategory(c.env.DB, id, name, isTagColor(color) ? color : existing.color);
  await invalidateAllProfiles(c.env.KV);
  return c.redirect('/admin?saved=tags');
});

adminRoutes.post('/admin/tags/remove', async (c) => {
  const body = await c.req.parseBody();
  const id = str(body.id);
  const existing = id ? await getTagCategory(c.env.DB, id) : null;
  if (existing) {
    await deleteTagCategory(c.env.DB, id);
    await invalidateAllProfiles(c.env.KV);
  }
  return c.redirect('/admin?saved=tags');
});

// Flip a user's DB admin flag. Env admins are always admin (see `lib/admin`),
// so the view hides this control for them; self-changes are blocked to prevent
// accidentally locking yourself out.
adminRoutes.post('/admin/users/:id/admin', async (c) => {
  const current = c.get('user')!;
  const id = c.req.param('id');
  if (id === current.id) return c.redirect('/admin?err=self');

  const target = await getUserById(c.env.DB, id);
  if (!target) return c.notFound();

  await setUserAdmin(c.env.DB, id, target.is_admin !== 1);
  return c.redirect('/admin?saved=user');
});

adminRoutes.post('/admin/users/:id/delete', async (c) => {
  const current = c.get('user')!;
  const id = c.req.param('id');
  if (id === current.id) return c.redirect('/admin?err=self');

  const deleted = await deleteUser(c.env.DB, id);
  if (deleted) await invalidateProfiles(c.env.KV, [deleted.username]);
  return c.redirect('/admin?saved=deleted');
});
