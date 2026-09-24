/**
 * Runtime integration config with environment-variable precedence.
 *
 * GitHub OAuth, outgoing email (SMTP) and the Gravatar mirror can be configured
 * either in the admin panel (D1 `settings`) or through Worker env vars/secrets.
 * An env var always wins; when one is present the matching admin field is
 * **locked** (`envLocks`), so the console cannot override it. The resolvers
 * below are what the OAuth/mailer/gravatar code paths consume.
 */
import type { Env } from '../types';
import type { SiteSettings } from './settings';

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
}

export interface MailerConfig {
  driver: string;
  host: string;
  port: string;
  secure: string;
  user: string;
  password: string;
  from: string;
}

/** Settings whose admin field is backed by an environment variable. */
export type EnvKey =
  | 'siteName'
  | 'githubClientId'
  | 'githubClientSecret'
  | 'mailerDriver'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecure'
  | 'smtpUser'
  | 'smtpPassword'
  | 'smtpFrom'
  | 'gravatarMirror';

/** Per-field lock: the env var name that wins, or `null` when editable. */
export type EnvLocks = Record<EnvKey, string | null>;

function nameOrNull(value: string | undefined): string | null {
  return value && value.trim() ? value : null;
}

function locked(value: string | undefined, name: string): string | null {
  return nameOrNull(value) ? name : null;
}

export function envLocks(env: Env): EnvLocks {
  return {
    siteName: locked(env.APP_NAME, 'APP_NAME'),
    githubClientId: locked(env.GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID'),
    githubClientSecret: locked(env.GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET'),
    mailerDriver: locked(env.MAILER_DRIVER, 'MAILER_DRIVER'),
    smtpHost: locked(env.SMTP_HOST, 'SMTP_HOST'),
    smtpPort: locked(env.SMTP_PORT, 'SMTP_PORT'),
    smtpSecure: locked(env.SMTP_SECURE, 'SMTP_SECURE'),
    smtpUser: locked(env.SMTP_USER, 'SMTP_USER'),
    smtpPassword: locked(env.SMTP_PASSWORD, 'SMTP_PASSWORD'),
    smtpFrom: locked(env.SMTP_FROM, 'SMTP_FROM'),
    gravatarMirror: locked(env.GRAVATAR_MIRROR, 'GRAVATAR_MIRROR'),
  };
}

export function resolveGithub(env: Env, settings: SiteSettings): GithubConfig {
  return {
    clientId: env.GITHUB_CLIENT_ID?.trim() || settings.githubClientId,
    clientSecret: env.GITHUB_CLIENT_SECRET?.trim() || settings.githubClientSecret,
  };
}

export function resolveMailer(env: Env, settings: SiteSettings): MailerConfig {
  return {
    driver: env.MAILER_DRIVER?.trim() || settings.mailerDriver,
    host: env.SMTP_HOST?.trim() || settings.smtpHost,
    port: env.SMTP_PORT?.trim() || settings.smtpPort,
    secure: env.SMTP_SECURE?.trim() || settings.smtpSecure,
    user: env.SMTP_USER?.trim() || settings.smtpUser,
    // Passwords may legitimately start/end with spaces, so never trim them.
    password: env.SMTP_PASSWORD ?? settings.smtpPassword,
    from: env.SMTP_FROM?.trim() || settings.smtpFrom,
  };
}

/** Resolved Gravatar base URL; empty lets `lib/gravatar` use its default. */
export function resolveGravatarMirror(env: Env, settings: SiteSettings): string {
  return env.GRAVATAR_MIRROR?.trim() || settings.gravatarMirror;
}
