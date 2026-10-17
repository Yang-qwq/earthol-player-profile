/**
 * Admin panel: every sub-module lives on its own page under `/admin` (see
 * `src/lib/admin-nav.ts` for the registry that drives the sidebar's second
 * level menu). Each route below is gated by `requireAdmin`; each form posts a
 * `_csrf` field handled by the global CSRF middleware, then redirects back to
 * its own section carrying a `?saved=`/`?err=` code that `flash()` turns into
 * a localized banner.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { TranslateFn, MessageKey } from '../i18n';
import { ADMIN_SECTION_PATH, type AdminSection } from '../lib/admin-nav';
import { AdminView } from '../views/admin';
import { requireAdmin } from '../middleware/auth';
import { navUser } from '../lib/view';
import { envAdminEmails } from '../lib/admin';import { LANDING_COPY_KEYS, MAX_LANDING_COPY, MAX_LANDING_URL, saveSettings } from '../lib/settings';
import {
  addReservedUsername,
  countActiveBans,
  countReports,
  countUnreadReceipts,
  createTagCategory,
  deleteUser,
  deleteTagCategory,
  findTagCategoryByName,
  getBan,
  getReportById,
  getStats,
  getTagCategory,
  getUserById,
  createReportReceipt,
  listBans,
  listModerationActions,
  listReports,
  listReservedUsernames,
  listTagCategories,
  logModerationAction,
  removeReservedUsername,
  resolveOpenReportsForTarget,
  revokeBan,
  searchUsers,
  setReportStatus,
  setUserAdmin,
  updateTagCategory,
  upsertBan,
} from '../db/queries';
import { invalidateAllProfiles, invalidateProfiles } from '../lib/profile-cache';
import { deleteStoredImage } from '../lib/storage';
import { revokeUserSessions } from '../lib/session';
import {
  MAX_BAN_NOTE,
  MAX_MODERATION_NOTE,
  MAX_RECEIPT_BODY,
  banExpiry,
  isBanDuration,
  isReportReason,
  isReportStatus,
} from '../lib/moderation';
import type { ReportStatus } from '../db/types';
import { isTagColor } from '../lib/tags';
import { isTheme, isVisibility } from '../lib/themes';
import { isSafeFaviconUrl, isSafeLandingUrl, isSafeUrl, text } from '../lib/validate';
import {
  envLocks,
  resolveGithub,
  resolveGravatarMirror,
  resolveMailer,
} from '../lib/config';
import { resolveOpenAI } from '../lib/openai';
import { appUrl } from '../lib/env';

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', requireAdmin);

const SAVED_MESSAGES: Record<string, MessageKey> = {
  settings: 'admin.saved.settings',
  reserved: 'admin.saved.reserved',
  code: 'admin.saved.code',
  landing: 'admin.saved.landing',
  tags: 'admin.saved.tags',
  user: 'admin.saved.user',
  deleted: 'admin.saved.deleted',
  config: 'admin.saved.config',
  ai: 'admin.saved.ai',
  moderation: 'admin.saved.moderation',
  receipt: 'admin.saved.receipt',
  banned: 'admin.saved.banned',
  unbanned: 'admin.saved.unbanned',
};

const ERROR_MESSAGES: Record<string, MessageKey> = {
  self: 'admin.err.self',
  tag_name: 'admin.err.tagName',
  tag_duplicate: 'admin.err.tagDuplicate',
  ban_self: 'admin.moderation.err.banSelf',
  ban_admin: 'admin.moderation.err.banAdmin',
  ban_reason: 'admin.moderation.err.reason',
  ban_duration: 'admin.moderation.err.duration',
  target: 'admin.moderation.err.target',
  report: 'admin.moderation.err.report',
  no_ban: 'admin.moderation.err.noBan',
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

/**
 * Renders one admin sub-page. Only the data the section displays is loaded;
 * everything else falls back to empty defaults so the view props stay fixed.
 */
async function renderAdmin(c: Context<AppContext>, section: AdminSection) {
  const t = c.get('t');
  const user = c.get('user')!;
  const query = (c.req.query('q') ?? '').trim();

  // Report queue filter: a missing/unknown value defaults to the open queue.
  const statusParam = c.req.query('status');
  const reportStatus: ReportStatus | 'all' =
    statusParam === 'all' || isReportStatus(statusParam) ? statusParam : 'open';
  const banTargetId = section === 'moderation' ? (c.req.query('ban') ?? '') : '';
  const banTargetUser = banTargetId ? await getUserById(c.env.DB, banTargetId) : null;

  const [stats, reserved, tagCategories, users, reportCounts, activeBans, reports, bans, actions, banTargetBan, receiptUnread] =
    await Promise.all([
      section === 'overview' ? getStats(c.env.DB) : Promise.resolve(null),
      section === 'reserved' ? listReservedUsernames(c.env.DB) : Promise.resolve(null),
      section === 'tags' ? listTagCategories(c.env.DB) : Promise.resolve(null),
      section === 'users' ? searchUsers(c.env.DB, query, 50, 0) : Promise.resolve(null),
      section === 'moderation' ? countReports(c.env.DB) : Promise.resolve(null),
      section === 'moderation' ? countActiveBans(c.env.DB) : Promise.resolve(0),
      section === 'moderation' ? listReports(c.env.DB, reportStatus, 100, 0) : Promise.resolve([]),
      section === 'moderation' ? listBans(c.env.DB, 100) : Promise.resolve([]),
      section === 'moderation' ? listModerationActions(c.env.DB, 50) : Promise.resolve([]),
      banTargetUser ? getBan(c.env.DB, banTargetUser.id) : Promise.resolve(null),
      countUnreadReceipts(c.env.DB, user.id),
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
    openaiApiKeySet: Boolean(resolveOpenAI(c.env, settings)),
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiModel: settings.openaiModel,
    openaiPromptChat: settings.openaiPromptChat,
  };

  return c.html(
    <AdminView
      appName={c.get('appName')}
      csrfToken={c.get('csrfToken')}
      t={t}
      locale={c.get('locale')}
      section={section}
      pathname={ADMIN_SECTION_PATH[section]}
      currentUser={navUser(user)}
      selfId={user.id}
      envAdminEmails={envAdminEmails(c.env)}
      settings={settings}
      integrations={integrations}
      envLocks={envLocks(c.env)}
      githubCallbackUrl={`${appUrl(c.env)}/auth/github/callback`}
      stats={stats ?? { users: 0, handles: 0, fields: 0, admins: 0 }}
      reserved={reserved ?? []}
      tagCategories={tagCategories ?? []}
      users={users ?? []}
      reports={reports ?? []}
      bans={bans ?? []}
      moderationStats={{
        open: reportCounts?.open ?? 0,
        resolved: reportCounts?.resolved ?? 0,
        dismissed: reportCounts?.dismissed ?? 0,
        activeBans,
      }}
      actionLog={actions ?? []}
      reportStatus={reportStatus}
      banTarget={banTargetUser ? { user: banTargetUser, ban: banTargetBan } : null}
      receiptUnread={receiptUnread}
      query={query}
      message={message}
      error={error}
      nonce={c.get('secureHeadersNonce')}
    />,
  );
}

// One page per sub-module — these are the sidebar's second-level entries.
adminRoutes.get('/admin', (c) => renderAdmin(c, 'overview'));
adminRoutes.get('/admin/settings', (c) => renderAdmin(c, 'settings'));
adminRoutes.get('/admin/integrations', (c) => renderAdmin(c, 'integrations'));
adminRoutes.get('/admin/ai', (c) => renderAdmin(c, 'ai'));
adminRoutes.get('/admin/custom-code', (c) => renderAdmin(c, 'code'));
adminRoutes.get('/admin/landing', (c) => renderAdmin(c, 'landing'));
adminRoutes.get('/admin/reserved', (c) => renderAdmin(c, 'reserved'));
adminRoutes.get('/admin/tags', (c) => renderAdmin(c, 'tags'));
adminRoutes.get('/admin/users', (c) => renderAdmin(c, 'users'));
adminRoutes.get('/admin/moderation', (c) => renderAdmin(c, 'moderation'));

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
    totpLoginEnabled: is(body.totp_login_enabled),
    defaultTheme: isTheme(theme) ? theme : current.defaultTheme,
    defaultVisibility: isVisibility(visibility) ? visibility : current.defaultVisibility,
    // This form has no code or integration fields; keep the existing values.
    landingCopy: current.landingCopy,
    landingCtaPrimaryUrl: current.landingCtaPrimaryUrl,
    landingCtaSecondaryUrl: current.landingCtaSecondaryUrl,
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
    // AI Configuration
    openaiApiKey: current.openaiApiKey,
    openaiBaseUrl: current.openaiBaseUrl,
    openaiModel: current.openaiModel,
    openaiPromptChat: current.openaiPromptChat,
  });

  // Cached profile HTML embeds the favicon <link> and the nav logo, so a
  // change to either must purge it.
  if (faviconUrl !== current.faviconUrl || logoUrl !== current.logoUrl) {
    await invalidateAllProfiles(c.env.KV);
  }

  return c.redirect('/admin/settings?saved=settings');
});

const MAX_SECRET = 300;

/**
 * The integration page's cards each save on their own (`/admin/config/github`,
 * `/admin/config/email`, `/admin/config/gravatar`; AI lives on `/admin/ai`).
 * Every field backed by an environment variable is **locked**: the submitted
 * value is ignored (the env var always wins), matching the disabled controls
 * in the view. Secret fields are never echoed back, so a blank value keeps the
 * stored one. All handlers spread `{ ...current }`, so partial saves never
 * drop unrelated settings.
 */
adminRoutes.post('/admin/config/github', async (c) => {
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

  await saveSettings(c.env, next);
  return c.redirect('/admin/integrations?saved=config');
});

adminRoutes.post('/admin/config/email', async (c) => {
  const current = c.get('settings');
  const locks = envLocks(c.env);
  const body = await c.req.parseBody();
  const next = { ...current };

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

  await saveSettings(c.env, next);
  return c.redirect('/admin/integrations?saved=config');
});

adminRoutes.post('/admin/config/gravatar', async (c) => {
  const current = c.get('settings');
  const locks = envLocks(c.env);
  const body = await c.req.parseBody();
  const next = { ...current };

  if (!locks.gravatarMirror) {
    const mirror = text(body.gravatar_mirror, 500);
    // A non-empty but unsafe URL keeps the current value.
    next.gravatarMirror = mirror && !isSafeUrl(mirror) ? current.gravatarMirror : mirror;
  }

  await saveSettings(c.env, next);
  return c.redirect('/admin/integrations?saved=config');
});

/** Saves the AI assistant configuration (its own page; the prompt has no
 * backing env var, so it is always editable). */
adminRoutes.post('/admin/ai', async (c) => {
  const current = c.get('settings');
  const locks = envLocks(c.env);
  const body = await c.req.parseBody();
  const next = { ...current };

  if (!locks.openaiApiKey) {
    const key = str(body.openai_api_key).trim();
    if (key) next.openaiApiKey = key.slice(0, MAX_SECRET);
  }
  if (!locks.openaiBaseUrl) {
    next.openaiBaseUrl = text(body.openai_base_url, 500);
  }
  if (!locks.openaiModel) {
    next.openaiModel = text(body.openai_model, 50);
  }
  next.openaiPromptChat = text(body.openai_prompt_chat, 1000);

  await saveSettings(c.env, next);
  return c.redirect('/admin/ai?saved=ai');
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

  return c.redirect('/admin/custom-code?saved=code');
});

// Landing page copy + CTA link overrides. Each copy field maps to a `home.*`
// i18n message; a blank value falls back to the built-in text for the viewer's
// locale. A blank CTA link restores the built-in button behavior; a non-empty
// but unsafe one keeps the current link (same rule as the favicon). The home
// page is never KV-cached, so no profile-cache purge is needed on save.
adminRoutes.post('/admin/landing', async (c) => {
  const current = c.get('settings');
  const body = await c.req.parseBody();
  const landingCopy = { ...current.landingCopy };
  for (const key of LANDING_COPY_KEYS) {
    landingCopy[key] = text(body[key], MAX_LANDING_COPY);
  }

  const resolveUrl = (raw: unknown, fallback: string): string => {
    const value = text(raw, MAX_LANDING_URL);
    if (!value) return '';
    return isSafeLandingUrl(value) ? value : fallback;
  };
  const landingCtaPrimaryUrl = resolveUrl(body.ctaClaimUrl, current.landingCtaPrimaryUrl);
  const landingCtaSecondaryUrl = resolveUrl(body.ctaHowUrl, current.landingCtaSecondaryUrl);

  await saveSettings(c.env, {
    ...current,
    landingCopy,
    landingCtaPrimaryUrl,
    landingCtaSecondaryUrl,
  });
  return c.redirect('/admin/landing?saved=landing');
});

adminRoutes.post('/admin/reserved/add', async (c) => {
  const body = await c.req.parseBody();
  const name = normalizeReserved(str(body.name));
  if (name) await addReservedUsername(c.env.DB, name);
  return c.redirect('/admin/reserved?saved=reserved');
});

adminRoutes.post('/admin/reserved/remove', async (c) => {
  const body = await c.req.parseBody();
  const name = str(body.name).trim().toLowerCase();
  if (name) await removeReservedUsername(c.env.DB, name);
  return c.redirect('/admin/reserved?saved=reserved');
});

/* ---------------------------- tag categories --------------------------- */

const MAX_TAG_CATEGORY_NAME = 40;

adminRoutes.post('/admin/tags/add', async (c) => {
  const body = await c.req.parseBody();
  const name = text(body.name, MAX_TAG_CATEGORY_NAME);
  if (!name) return c.redirect('/admin/tags?err=tag_name');
  if (await findTagCategoryByName(c.env.DB, name)) {
    return c.redirect('/admin/tags?err=tag_duplicate');
  }

  const color = text(body.color, 20);
  await createTagCategory(c.env.DB, name, isTagColor(color) ? color : 'sky');
  await invalidateAllProfiles(c.env.KV);
  return c.redirect('/admin/tags?saved=tags');
});

adminRoutes.post('/admin/tags/update', async (c) => {
  const body = await c.req.parseBody();
  const id = str(body.id);
  const existing = id ? await getTagCategory(c.env.DB, id) : null;
  if (!existing) return c.notFound();

  const name = text(body.name, MAX_TAG_CATEGORY_NAME);
  if (!name) return c.redirect('/admin/tags?err=tag_name');
  const clash = await findTagCategoryByName(c.env.DB, name);
  if (clash && clash.id !== id) return c.redirect('/admin/tags?err=tag_duplicate');

  const color = text(body.color, 20);
  await updateTagCategory(c.env.DB, id, name, isTagColor(color) ? color : existing.color);
  await invalidateAllProfiles(c.env.KV);
  return c.redirect('/admin/tags?saved=tags');
});

adminRoutes.post('/admin/tags/remove', async (c) => {
  const body = await c.req.parseBody();
  const id = str(body.id);
  const existing = id ? await getTagCategory(c.env.DB, id) : null;
  if (existing) {
    await deleteTagCategory(c.env.DB, id);
    await invalidateAllProfiles(c.env.KV);
  }
  return c.redirect('/admin/tags?saved=tags');
});

// Flip a user's DB admin flag. Env admins are always admin (see `lib/admin`),
// so the view hides this control for them; self-changes are blocked to prevent
// accidentally locking yourself out.
adminRoutes.post('/admin/users/:id/admin', async (c) => {
  const current = c.get('user')!;
  const id = c.req.param('id');
  if (id === current.id) return c.redirect('/admin/users?err=self');

  const target = await getUserById(c.env.DB, id);
  if (!target) return c.notFound();

  await setUserAdmin(c.env.DB, id, target.is_admin !== 1);
  return c.redirect('/admin/users?saved=user');
});

// AI Configuration endpoint. Returns an HTML fragment (htmx swaps it into
// `#ai-test-result`). The key is not validated against the provider: any
// non-empty key counts as configured.
adminRoutes.post('/admin/ai/test', async (c) => {
  const t = c.get('t');
  const configured = Boolean(resolveOpenAI(c.env, c.get('settings')));

  const variant = configured ? 'success' : 'error';
  const message = configured ? t('admin.ai.testSuccess') : t('admin.ai.notConfigured');
  return c.html(
    `<div id="ai-test-result" class="text-xs ${
      variant === 'success' ? 'text-success' : 'text-danger'
    }">${message}</div>`,
  );
});

adminRoutes.post('/admin/users/:id/delete', async (c) => {
  const current = c.get('user')!;
  const id = c.req.param('id');
  if (id === current.id) return c.redirect('/admin/users?err=self');

  const deleted = await deleteUser(c.env.DB, id);
  if (deleted) {
    // Best-effort removal of the user's uploaded avatar, if any. Scoped to
    // the deleted user's id so a tampered row can only ever clean its own key.
    await deleteStoredImage(c.env, deleted.avatar_url, id);
    await invalidateProfiles(c.env.KV, [deleted.username]);
  }
  return c.redirect('/admin/users?saved=deleted');
});

/* ---------------------------- moderation ---------------------------- */

/** Reason/duration enums, admin targets, and self-bans are rejected, never
    coerced: silently picking a default duration could turn a 1-day timeout
    into a permanent ban. */
adminRoutes.post('/admin/moderation/ban', async (c) => {
  const current = c.get('user')!;
  const body = await c.req.parseBody();
  const userId = str(body.user_id);
  const target = userId ? await getUserById(c.env.DB, userId) : null;
  if (!target) return c.redirect('/admin/moderation?err=target');
  if (target.id === current.id) return c.redirect('/admin/moderation?err=ban_self');

  // Admins (DB flag or env bootstrap list) cannot be banned, so a compromised
  // admin session cannot lock the operator out of the console.
  const envAdmins = envAdminEmails(c.env).map((email) => email.toLowerCase());
  if (target.is_admin === 1 || (target.email && envAdmins.includes(target.email.toLowerCase()))) {
    return c.redirect('/admin/moderation?err=ban_admin');
  }

  if (!isReportReason(body.reason)) {
    return c.redirect('/admin/moderation?err=ban_reason');
  }
  if (!isBanDuration(body.duration)) {
    return c.redirect('/admin/moderation?err=ban_duration');
  }

  const note = text(body.note, MAX_BAN_NOTE) || null;
  const expiresAt = banExpiry(body.duration);
  const reportId = str(body.report_id) || null;

  await upsertBan(c.env.DB, {
    userId: target.id,
    reason: body.reason,
    note,
    createdBy: current.id,
    expiresAt,
  });
  // The ban settles the queue: every open report against this account is
  // resolved with the same note, rather than leaving duplicates behind.
  await resolveOpenReportsForTarget(c.env.DB, target.id, current.id, note);
  await logModerationAction(c.env.DB, {
    actorId: current.id,
    action: 'ban',
    targetUserId: target.id,
    reportId,
    note: note ?? body.reason,
  });
  // Kills current sessions (best effort) and every cached page that embeds the
  // account (its own profile, follower lists, tag suggestions).
  await revokeUserSessions(c.env.KV, target.id);
  await invalidateAllProfiles(c.env.KV);

  return c.redirect('/admin/moderation?saved=banned');
});

adminRoutes.post('/admin/moderation/unban', async (c) => {
  const current = c.get('user')!;
  const body = await c.req.parseBody();
  const userId = str(body.user_id);
  const target = userId ? await getUserById(c.env.DB, userId) : null;
  if (!target) return c.redirect('/admin/moderation?err=target');

  const ban = await getBan(c.env.DB, target.id);
  if (!ban || ban.revoked_at !== null) {
    return c.redirect('/admin/moderation?err=no_ban');
  }

  await revokeBan(c.env.DB, target.id, current.id);
  await logModerationAction(c.env.DB, {
    actorId: current.id,
    action: 'unban',
    targetUserId: target.id,
    note: text(body.note, MAX_BAN_NOTE) || null,
  });
  await invalidateAllProfiles(c.env.KV);
  return c.redirect('/admin/moderation?saved=unbanned');
});

adminRoutes.post('/admin/moderation/reports/:id/status', async (c) => {
  const current = c.get('user')!;
  const id = c.req.param('id');
  const report = id ? await getReportById(c.env.DB, id) : null;
  if (!report) return c.redirect('/admin/moderation?err=report');

  const body = await c.req.parseBody();
  const status = body.status;
  if (!isReportStatus(status)) return c.redirect('/admin/moderation?err=report');

  const note = text(body.note, MAX_MODERATION_NOTE) || null;
  const receipt = text(body.receipt, MAX_RECEIPT_BODY) || null;
  await setReportStatus(c.env.DB, report.id, status, note, current.id);
  if (receipt) {
    await createReportReceipt(c.env.DB, {
      reportId: report.id,
      adminId: current.id,
      body: receipt,
    });
    await logModerationAction(c.env.DB, {
      actorId: current.id,
      action: 'receipt',
      targetUserId: report.target_user_id,
      reportId: report.id,
      note: receipt,
    });
  }
  if (report.status !== status) {
    await logModerationAction(c.env.DB, {
      actorId: current.id,
      action: `report_${status}`,
      targetUserId: report.target_user_id,
      reportId: report.id,
      note,
    });
  }

  const filter = str(body.filter);
  const nextFilter = filter === 'all' || isReportStatus(filter) ? filter : 'open';
  const saved = receipt ? 'receipt' : 'moderation';
  return c.redirect(`/admin/moderation?saved=${saved}&status=${nextFilter}`);
});
