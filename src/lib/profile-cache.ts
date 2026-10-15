/**
 * KV cache for rendered public profile HTML. Keys are **locale-scoped**
 * (`profile:html:<locale>:<username>`) because output depends on the active
 * language, so invalidation must clear one entry per locale. Each profile has
 * up to three cached pages — the profile itself plus its followers/following
 * list pages (`:followers` / `:following` suffixes) — and all variants of a
 * handle are purged together.
 */
import { LOCALES, type Locale } from '../i18n';

const TTL_SECONDS = 300;

/** Cacheable variants of a profile's HTML: the page itself plus its two follow list pages. */
export const PROFILE_VARIANTS = ['', ':followers', ':following'] as const;
export type ProfileVariant = (typeof PROFILE_VARIANTS)[number];

/**
 * Cacheable HTML must not embed the per-request CSP nonce: a cached copy would
 * be served under a *different* request's nonce and every inline script on it
 * would be blocked. Cache the page with this placeholder instead and swap in
 * the live nonce when serving (`withNonce`). It is intentionally not a valid
 * nonce so a leaked placeholder can never be a working one.
 */
export const NONCE_PLACEHOLDER = 'CSP_NONCE_PLACEHOLDER';

/** Replace the cached nonce placeholder with the current request's nonce. */
export function withNonce(html: string, nonce: string): string {
  return nonce ? html.split(NONCE_PLACEHOLDER).join(nonce) : html;
}

function keyFor(locale: Locale, username: string, variant: ProfileVariant = ''): string {
  return `profile:html:${locale}:${username.toLowerCase()}${variant}`;
}

export function getCachedProfile(
  kv: KVNamespace,
  locale: Locale,
  username: string,
  variant: ProfileVariant = '',
): Promise<string | null> {
  return kv.get(keyFor(locale, username, variant));
}

export async function setCachedProfile(
  kv: KVNamespace,
  locale: Locale,
  username: string,
  html: string,
  variant: ProfileVariant = '',
): Promise<void> {
  await kv.put(keyFor(locale, username, variant), html, { expirationTtl: TTL_SECONDS });
}

export async function invalidateProfiles(
  kv: KVNamespace,
  usernames: (string | null | undefined)[],
): Promise<void> {
  const names = usernames.filter((name): name is string => Boolean(name));
  await Promise.all(
    names.flatMap((name) =>
      LOCALES.flatMap((locale) => PROFILE_VARIANTS.map((variant) => kv.delete(keyFor(locale, name, variant)))),
    ),
  );
}

/**
 * Delete every cached profile page. Used when a change (e.g. renaming or
 * deleting a tag category) affects the rendered HTML of an unknown number of
 * profiles. Best-effort: the 300s TTL is the safety net.
 */
export async function invalidateAllProfiles(kv: KVNamespace): Promise<void> {
  try {
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix: 'profile:html:', cursor });
      await Promise.all(page.keys.map((key) => kv.delete(key.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch {
    /* ignore; stale entries expire on their own */
  }
}
