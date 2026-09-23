/** Input normalization and validation shared by routes and views. */
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(normalizeUsername(value));
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolves a `next` redirect target against `base` and returns a same-origin
 * relative path, or `undefined` when the input is missing or points elsewhere.
 * Re-emitting only path/search/hash defeats protocol-relative (`//host`),
 * backslash (`/\host`, which browsers normalize to `//host`), and absolute
 * (`https://host`) redirect tricks.
 */
export function safeRedirectPath(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  let target: URL;
  let origin: URL;
  try {
    target = new URL(value, base);
    origin = new URL(base);
  } catch {
    return undefined;
  }
  if (target.origin !== origin.origin) return undefined;
  if (!target.pathname.startsWith('/')) return undefined;
  return `${target.pathname}${target.search}${target.hash}`;
}

/** Favicon hrefs may be absolute http(s) URLs or same-origin root-relative paths. */
export function isSafeFaviconUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return isSafeUrl(trimmed);
}

export function text(value: unknown, maxLength: number): string {
  const str = typeof value === 'string' ? value.trim() : '';
  return str.slice(0, maxLength);
}

/**
 * Prepares admin-authored CSS/JS for a raw inline `<style>`/`<script>` block
 * rendered via `dangerouslySetInnerHTML`. HTML-escaping the whole content
 * would corrupt it, because raw-text elements do not decode entities (a CSS
 * `>` child combinator would break). The only real hazard is an embedded
 * closing tag, so just that is neutralized: `</style` / `</script` become
 * `<\/style` / `<\/script`. The backslash is value-preserving in JS strings
 * and regexes, in CSS strings/urls, and as a CSS identifier escape.
 */
export function rawInlineBlock(content: string, tag: 'style' | 'script'): string {
  const re = new RegExp('</' + tag, 'gi');
  return content.replace(re, '<\\/' + tag);
}
