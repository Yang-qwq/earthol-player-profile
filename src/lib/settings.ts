/**
 * Runtime site configuration, stored as key/value rows in the D1 `settings`
 * table and cached in KV (`settings:all`, 60s) so the per-request middleware
 * stays cheap. Keys that were never saved fall back to `DEFAULTS`.
 */
import type { Env } from '../types';
import { readSettings, writeSettings } from '../db/queries';
import { appName } from './env';

export interface SiteSettings {
  siteName: string;
  faviconUrl: string;
  logoUrl: string;
  signupsEnabled: boolean;
  maintenanceMode: boolean;
  githubLoginEnabled: boolean;
  magicLinkEnabled: boolean;
  defaultTheme: string;
  defaultVisibility: string;
  customCss: string;
  customJs: string;
  customFooter: string;
  githubClientId: string;
  githubClientSecret: string;
  mailerDriver: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  gravatarMirror: string;
}

const CACHE_KEY = 'settings:all';
const CACHE_TTL = 60;

const KEY = {
  siteName: 'site_name',
  faviconUrl: 'favicon_url',
  logoUrl: 'logo_url',
  signups: 'signups_enabled',
  maintenance: 'maintenance_mode',
  github: 'github_login_enabled',
  magic: 'magic_link_enabled',
  defaultTheme: 'default_theme',
  defaultVisibility: 'default_visibility',
  customCss: 'custom_css',
  customJs: 'custom_js',
  customFooter: 'custom_footer',
  githubClientId: 'github_client_id',
  githubClientSecret: 'github_client_secret',
  mailerDriver: 'mailer_driver',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUser: 'smtp_user',
  smtpPassword: 'smtp_password',
  smtpFrom: 'smtp_from',
  gravatarMirror: 'gravatar_mirror',
};

const DEFAULTS: SiteSettings = {
  siteName: '',
  faviconUrl: '',
  logoUrl: '',
  signupsEnabled: true,
  maintenanceMode: false,
  githubLoginEnabled: true,
  magicLinkEnabled: true,
  defaultTheme: 'default',
  defaultVisibility: 'public',
  customCss: '',
  customJs: '',
  customFooter: '',
  githubClientId: '',
  githubClientSecret: '',
  mailerDriver: '',
  smtpHost: '',
  smtpPort: '',
  smtpSecure: '',
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  gravatarMirror: '',
};

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value === 'true';
}

/**
 * Read settings: KV cache first, then D1. A transient D1 failure degrades to
 * defaults instead of failing the request.
 */
export async function getSettings(env: Env): Promise<SiteSettings> {
  try {
    const cached = (await env.KV.get(CACHE_KEY, 'json')) as SiteSettings | null;
    if (cached) return { ...DEFAULTS, ...cached };
  } catch {
    /* fall through to DB */
  }

  let map: Record<string, string> = {};
  try {
    map = await readSettings(env.DB);
  } catch {
    map = {};
  }

  const settings: SiteSettings = {
    siteName: map[KEY.siteName] ?? '',
    faviconUrl: map[KEY.faviconUrl] ?? DEFAULTS.faviconUrl,
    logoUrl: map[KEY.logoUrl] ?? DEFAULTS.logoUrl,
    signupsEnabled: toBool(map[KEY.signups], DEFAULTS.signupsEnabled),
    maintenanceMode: toBool(map[KEY.maintenance], DEFAULTS.maintenanceMode),
    githubLoginEnabled: toBool(map[KEY.github], DEFAULTS.githubLoginEnabled),
    magicLinkEnabled: toBool(map[KEY.magic], DEFAULTS.magicLinkEnabled),
    defaultTheme: map[KEY.defaultTheme] ?? DEFAULTS.defaultTheme,
    defaultVisibility: map[KEY.defaultVisibility] ?? DEFAULTS.defaultVisibility,
    customCss: map[KEY.customCss] ?? DEFAULTS.customCss,
    customJs: map[KEY.customJs] ?? DEFAULTS.customJs,
    customFooter: map[KEY.customFooter] ?? DEFAULTS.customFooter,
    githubClientId: map[KEY.githubClientId] ?? DEFAULTS.githubClientId,
    githubClientSecret: map[KEY.githubClientSecret] ?? DEFAULTS.githubClientSecret,
    mailerDriver: map[KEY.mailerDriver] ?? DEFAULTS.mailerDriver,
    smtpHost: map[KEY.smtpHost] ?? DEFAULTS.smtpHost,
    smtpPort: map[KEY.smtpPort] ?? DEFAULTS.smtpPort,
    smtpSecure: map[KEY.smtpSecure] ?? DEFAULTS.smtpSecure,
    smtpUser: map[KEY.smtpUser] ?? DEFAULTS.smtpUser,
    smtpPassword: map[KEY.smtpPassword] ?? DEFAULTS.smtpPassword,
    smtpFrom: map[KEY.smtpFrom] ?? DEFAULTS.smtpFrom,
    gravatarMirror: map[KEY.gravatarMirror] ?? DEFAULTS.gravatarMirror,
  };

  try {
    await env.KV.put(CACHE_KEY, JSON.stringify(settings), { expirationTtl: CACHE_TTL });
  } catch {
    /* cache is best-effort */
  }

  return settings;
}

/** Persist all settings (batched upsert) then invalidate the KV cache. */
export async function saveSettings(env: Env, settings: SiteSettings): Promise<void> {
  await writeSettings(env.DB, {
    [KEY.siteName]: settings.siteName,
    [KEY.faviconUrl]: settings.faviconUrl,
    [KEY.logoUrl]: settings.logoUrl,
    [KEY.signups]: settings.signupsEnabled ? '1' : '0',
    [KEY.maintenance]: settings.maintenanceMode ? '1' : '0',
    [KEY.github]: settings.githubLoginEnabled ? '1' : '0',
    [KEY.magic]: settings.magicLinkEnabled ? '1' : '0',
    [KEY.defaultTheme]: settings.defaultTheme,
    [KEY.defaultVisibility]: settings.defaultVisibility,
    [KEY.customCss]: settings.customCss,
    [KEY.customJs]: settings.customJs,
    [KEY.customFooter]: settings.customFooter,
    [KEY.githubClientId]: settings.githubClientId,
    [KEY.githubClientSecret]: settings.githubClientSecret,
    [KEY.mailerDriver]: settings.mailerDriver,
    [KEY.smtpHost]: settings.smtpHost,
    [KEY.smtpPort]: settings.smtpPort,
    [KEY.smtpSecure]: settings.smtpSecure,
    [KEY.smtpUser]: settings.smtpUser,
    [KEY.smtpPassword]: settings.smtpPassword,
    [KEY.smtpFrom]: settings.smtpFrom,
    [KEY.gravatarMirror]: settings.gravatarMirror,
  });
  try {
    await env.KV.delete(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * App display name. The `APP_NAME` env var wins over the admin `siteName`
 * setting (which itself wins over the built-in default), matching the env-lock
 * rule: when `APP_NAME` is set, the console cannot change the name.
 */
export function resolveAppName(env: Env, settings: SiteSettings): string {
  return env.APP_NAME?.trim() || settings.siteName.trim() || appName(env);
}
