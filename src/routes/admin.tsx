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
import { isSafeFaviconUrl, isSafeUrl, text } from '../lib/validate';
import {
  envLocks,
  resolveGithub,
  resolveGravatarMirror,
  resolveMailer,
} from '../lib/config';
import { appUrl } from '../lib/env';

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', requireAdmin);

const SAVED_MESSAGES: Record<string, MessageKey> = {
  settings: 'admin.saved.settings',
  reserved: 'admin.saved.reserved',
  code: 'admin.saved.code',
  tags: 'admin.saved.tags',
  user: 'admin.saved.user',
  deleted: 'admin.saved.deleted',
  config: 'admin.saved.config',
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

  const settings = c.get('settings');
  const github = resolveGithub(c.env, settings);
  const mailer = resolveMailer(c.env, settings);
  const integrations = {
    githubClientId: github.clientId,
    githubClientSecretSet: Boolean(github.clientSecret),
    mailerDriver: mailer.driver,
    smtpHost: mailer.host,
    smtpPort: mailer.port,
    smtpSecure: mailer.secure,
    smtpUser: mailer.user,
    smtpPasswordSet: Boolean(mailer.password),
    smtpFrom: mailer.from,
    gravatarMirror: resolveGravatarMirror(c.env, settings),
  };

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
      settings={settings}
      integrations={integrations}
      envLocks={envLocks(c.env)}
      githubCallbackUrl={`${appUrl(c.env)}/auth/github/callback`}
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
  const locks = envLocks(c.env);
  const body = await c.req.parseBody();

  const theme = text(body.default_theme, 30);
  const visibility = text(body.default_visibility, 30);
  // Blank clears the favicon; a non-empty but unsafe value keeps the current one.
  const faviconRaw = text(body.favicon_url, 500);
  const faviconUrl =
    faviconRaw && !isSafeFaviconUrl(faviconRaw) ? current.faviconUrl : faviconRaw;
  // Same rule for the nav logo: blank hides the logo.
  const logoRaw = text(body.logo_url, 500);
  const logoUrl = logoRaw && !isSafeFaviconUrl(logoRaw) ? current.logoUrl : logoRaw;

  await saveSettings(c.env, {
    // Locked by APP_NAME: keep the stored value (the env var is used at runtime).
    siteName: locks.siteName ? current.siteName : text(body.site_name, 60),
    faviconUrl,
    logoUrl,
    signupsEnabled: is(body.signups_enabled),
    maintenanceMode: is(body.maintenance_mode),
    githubLoginEnabled: is(body.github_login_enabled),
    magicLinkEnabled: is(body.magic_link_enabled),
    defaultTheme: isTheme(theme) ? theme : current.defaultTheme,
    defaultVisibility: isVisibility(visibility) ? visibility : current.defaultVisibility,
    // This form has no code or integration fields; keep the existing values.
    customCss: current.customCss,
    customJs: current.customJs,
    customFooter: current.customFooter,
    githubClientId: current.githubClientId,
    githubClientSecret: current.githubClientSecret,
    mailerDriver: current.mailerDriver,
    smtpHost: current.smtpHost,
    smtpPort: current.smtpPort,
    smtpSecure: current.smtpSecure,
    smtpUser: current.smtpUser,
    smtpPassword: current.smtpPassword,
    smtpFrom: current.smtpFrom,
    gravatarMirror: current.gravatarMirror,
  });

  // Cached profile HTML embeds the favicon <link> and the nav logo, so a
  // change to either must purge it.
  if (faviconUrl !== current.faviconUrl || logoUrl !== current.logoUrl) {
    await invalidateAllProfiles(c.env.KV);
  }

  return c.redirect('/admin?saved=settings');
});

const MAX_SECRET = 300;

/**
 * Saves the GitHub / email / Gravatar integration config. Each field backed by
 * an environment variable is **locked**: the submitted value is ignored (the
 * env var always wins), matching the disabled controls in the view. Secret
 * fields are never echoed back, so a blank value keeps the stored one.
 */
adminRoutes.post('/admin/config', async (c) => {
  const current = c.get('settings');
  const locks = envLocks(c.env);
  const body = await c.req.parseBody();
  const next = { ...current };

  if (!locks.githubClientId) {
    next.githubClientId = text(body.github_client_id, 200);
  }
  if (!locks.githubClientSecret) {
    const secret = str(body.github_client_secret);
    if (secret) next.githubClientSecret = secret.slice(0, MAX_SECRET);
  }

  if (!locks.mailerDriver) {
    next.mailerDriver = text(body.mailer_driver, 20) === 'smtp' ? 'smtp' : '';
  }
  if (!locks.smtpHost) {
    next.smtpHost = text(body.smtp_host, 200);
  }
  if (!locks.smtpPort) {
    next.smtpPort = text(body.smtp_port, 10).replace(/[^0-9]/g, '').slice(0, 5);
  }
  if (!locks.smtpSecure) {
    const secure = text(body.smtp_secure, 20);
    next.smtpSecure = secure === 'tls' || secure === 'starttls' || secure === 'none' ? secure : '';
  }
  if (!locks.smtpUser) {
    next.smtpUser = text(body.smtp_user, 200);
  }
  if (!locks.smtpPassword) {
    const password = str(body.smtp_password);
    if (password) next.smtpPassword = password.slice(0, MAX_SECRET);
  }
  if (!locks.smtpFrom) {
    next.smtpFrom = text(body.smtp_from, 200);
  }

  if (!locks.gravatarMirror) {
    const mirror = text(body.gravatar_mirror, 500);
    // A non-empty but unsafe URL keeps the current value.
    next.gravatarMirror = mirror && !isSafeUrl(mirror) ? current.gravatarMirror : mirror;
  }

  await saveSettings(c.env, next);
  return c.redirect('/admin?saved=config');
});

const MAX_CUSTOM_CODE = 32768;

// Saves admin-authored site-wide CSS/JS/footer. Kept out of /admin/settings
// because that form saves the whole settings object and would clobber these
// fields. Cached profile HTML embeds the rendered blocks, so any change purges
// the profile cache.
adminRoutes.post('/admin/custom-code', async (c) => {
  const current = c.get('settings');
  const body = await c.req.parseBody();

  const customCss = str(body.custom_css).slice(0, MAX_CUSTOM_CODE);
  const customJs = str(body.custom_js).slice(0, MAX_CUSTOM_CODE);
  const customFooter = str(body.custom_footer).slice(0, MAX_CUSTOM_CODE);

  await saveSettings(c.env, { ...current, customCss, customJs, customFooter });

  if (
    customCss !== current.customCss ||
    customJs !== current.customJs ||
    customFooter !== current.customFooter
  ) {
    await invalidateAllProfiles(c.env.KV);
  }

  return c.redirect('/admin?saved=code');
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
