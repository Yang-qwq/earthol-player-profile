/**
 * Gravatar avatar URLs. Gravatar keys avatars by the MD5 of the lowercased,
 * trimmed email address (`md5Hex` uses the Workers-only MD5 digest).
 */
import { md5Hex } from './crypto';

/** Upstream host; override with the `GRAVATAR_MIRROR` env var (e.g. a CDN). */
const DEFAULT_MIRROR = 'https://www.gravatar.com/avatar';

/**
 * Returns a Gravatar URL for `email`, or an empty string when there is none.
 * `mirror` replaces the base URL (hash appended), so self-hosted mirrors and
 * alternate paths (`https://cravatar.cn/avatar`) work.
 */
export async function gravatarAvatarUrl(
  email: string | null,
  mirror?: string,
  size = 200,
): Promise<string> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return '';
  const base = (mirror?.trim() || DEFAULT_MIRROR).replace(/\/+$/, '');
  const hash = await md5Hex(normalized);
  return `${base}/${hash}?s=${size}&d=identicon`;
}
