/**
 * KV cache for rendered public profile HTML. Keys are **locale-scoped**
 * (`profile:html:<locale>:<username>`) because output now depends on the
 * active language, so invalidation must clear one entry per locale.
 */
import { LOCALES, type Locale } from '../i18n';

const TTL_SECONDS = 300;

function keyFor(locale: Locale, username: string): string {
  return `profile:html:${locale}:${username.toLowerCase()}`;
}

export function getCachedProfile(
  kv: KVNamespace,
  locale: Locale,
  username: string,
): Promise<string | null> {
  return kv.get(keyFor(locale, username));
}

export async function setCachedProfile(
  kv: KVNamespace,
  locale: Locale,
  username: string,
  html: string,
): Promise<void> {
  await kv.put(keyFor(locale, username), html, { expirationTtl: TTL_SECONDS });
}

export async function invalidateProfiles(
  kv: KVNamespace,
  usernames: (string | null | undefined)[],
): Promise<void> {
  const names = usernames.filter((name): name is string => Boolean(name));
  await Promise.all(names.flatMap((name) => LOCALES.map((locale) => kv.delete(keyFor(locale, name)))));
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
