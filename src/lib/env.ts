/**
 * Environment-variable fallbacks. `wrangler.jsonc` intentionally declares no
 * `vars` so that Dashboard-managed variables (kept across deploys via
 * `keep_vars: true`) are the source of truth in production; these defaults keep
 * local development and un-configured deployments working.
 */
import type { Env } from '../types';

export const DEFAULT_APP_NAME = 'EarthOL Player Profile';
export const DEFAULT_APP_URL = 'http://localhost:8787';

/** Site display name, used when the admin `siteName` setting is empty. */
export function appName(env: Env): string {
  return env.APP_NAME?.trim() || DEFAULT_APP_NAME;
}

/** Absolute site origin for magic links, canonical URLs, OG tags and sitemap. */
export function appUrl(env: Env): string {
  return (env.APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
}
