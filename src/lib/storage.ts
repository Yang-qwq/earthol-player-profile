/**
 * Optional R2 object storage. When an `R2` bucket binding is present the
 * dashboard gains avatar and gallery-image uploads, served back through
 * `GET /files/*` (src/routes/files.ts); when the binding is absent every
 * helper degrades gracefully and the upload UI simply does not render.
 * Objects are only ever served through this Worker — never via public
 * bucket URLs.
 */
import type { Env } from '../types';
import { randomToken } from './crypto';
import { transcodeImageToWebp } from './image';

/** Public URL prefix for stored objects. */
export const STORAGE_PATH_PREFIX = '/files/';

/**
 * The key namespaces written and served today. `avatars/` holds profile
 * avatars; `gallery/` holds uploaded gallery-block images. A new namespace
 * must be added here AND to `STORAGE_KEY_RE` together — the regex is the
 * serving route's only reachability gate.
 */
export const STORAGE_PREFIXES = {
  avatars: 'avatars/',
  gallery: 'gallery/',
} as const;
export type StoragePrefix = (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

/**
 * Keys we ever write or serve: `<avatars|gallery>/<userId>/<random
 * token>.<ext>`. The serving route rejects anything else, so stray bucket
 * objects and traversal tricks (`..`, encoded slashes) can never be read
 * back.
 */
export const STORAGE_KEY_RE =
  /^(?:avatars|gallery)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|jpg|gif|webp)$/;

/** 2 MiB — plenty for an avatar, small enough to buffer inside a Worker. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * 8 MiB — roomy for gallery photos while staying bufferable in a Worker.
 * Most uploads are re-encoded to WebP below this, so the stored object is
 * usually far smaller than the request.
 */
export const MAX_GALLERY_BYTES = 8 * 1024 * 1024;

/**
 * Content-type sniffing by magic bytes. The client-declared MIME type is
 * ignored entirely: what gets stored (and later served) is derived from the
 * actual bytes, so a mislabeled HTML/SVG/JS upload can never be served.
 */
function sniffImage(bytes: Uint8Array): { type: string; ext: string } | null {
  const ascii = (start: number, text: string): boolean => {
    for (let i = 0; i < text.length; i += 1) {
      if (bytes[start + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 'PNG')) {
    return { type: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 6 && ascii(0, 'GIF8')) {
    return { type: 'image/gif', ext: 'gif' };
  }
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Runtime gate for the optional binding; narrows `env.R2` to a real bucket. */
export function storageEnabled(env: Env): env is Env & { R2: R2Bucket } {
  return typeof env.R2 !== 'undefined';
}

/** True for the same-origin `/files/...` paths this module hands out. */
export function isStoredPath(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(STORAGE_PATH_PREFIX) &&
    STORAGE_KEY_RE.test(value.slice(STORAGE_PATH_PREFIX.length))
  );
}

export type StoreImageError =
  | 'unavailable'
  | 'invalid_file'
  | 'file_too_large'
  | 'gallery_file_too_large'
  | 'invalid_file_type';

export interface StoredImage {
  key: string;
  /** Same-origin public path, ready to store in `users.avatar_url`. */
  path: string;
  contentType: string;
}

/**
 * Validates and stores an uploaded image under
 * `<prefix><ownerId>/<random>.<ext>` and returns its public path, or an
 * error code for the route to translate. Only sniffed image types are
 * accepted. `prefix` is the key namespace (`avatars/` or `gallery/`).
 */
export async function storeImage(
  env: Env,
  options: { ownerId: string; file: unknown; maxBytes: number; prefix: StoragePrefix },
): Promise<StoredImage | { error: StoreImageError }> {
  if (!storageEnabled(env)) return { error: 'unavailable' };

  const file = options.file;
  if (!(file instanceof File) || file.size === 0) return { error: 'invalid_file' };
  if (file.size > options.maxBytes) return { error: 'file_too_large' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: 'invalid_file_type' };

  const key = `${options.prefix}${options.ownerId}/${randomToken(12)}.${sniffed.ext}`;
  await env.R2.put(key, bytes, { httpMetadata: { contentType: sniffed.type } });
  return { key, path: `${STORAGE_PATH_PREFIX}${key}`, contentType: sniffed.type };
}

/**
 * Stores a gallery-block image under `gallery/<ownerId>/…`, transcoding to
 * WebP first. The transcode is strictly best-effort (src/lib/image.ts): when
 * the input cannot be decoded — or the runtime has no canvas — the ORIGINAL
 * bytes are stored with their sniffed type instead, so an exotic-but-valid
 * image never fails an upload because the transcode declined.
 */
export async function storeGalleryImage(
  env: Env,
  options: { ownerId: string; file: unknown },
): Promise<StoredImage | { error: StoreImageError }> {
  if (!storageEnabled(env)) return { error: 'unavailable' };

  const file = options.file;
  if (!(file instanceof File) || file.size === 0) return { error: 'invalid_file' };
  if (file.size > MAX_GALLERY_BYTES) return { error: 'gallery_file_too_large' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: 'invalid_file_type' };

  const webp = await transcodeImageToWebp(env, bytes);
  const stored = webp ?? bytes;
  const storedType = webp ? 'image/webp' : sniffed.type;
  const ext = webp ? 'webp' : sniffed.ext;

  const key = `${STORAGE_PREFIXES.gallery}${options.ownerId}/${randomToken(12)}.${ext}`;
  await env.R2.put(key, stored, { httpMetadata: { contentType: storedType } });
  return { key, path: `${STORAGE_PATH_PREFIX}${key}`, contentType: storedType };
}

/** The owner id embedded in a stored path (`avatars/<userId>/…`), or null. */
export function storedPathOwner(path: string | null | undefined): string | null {
  if (!isStoredPath(path)) return null;
  return path.slice(STORAGE_PATH_PREFIX.length).split('/')[0] ?? null;
}

/**
 * Best-effort delete of a previously stored object; never throws. When
 * `ownerId` is provided the path's embedded owner segment must match it —
 * a caller may only ever delete its own objects (an admin/deletion path that
 * acts on another user's row passes that user's id explicitly).
 */
export async function deleteStoredImage(
  env: Env,
  path: string | null | undefined,
  ownerId?: string,
): Promise<void> {
  if (!isStoredPath(path) || !storageEnabled(env)) return;
  if (ownerId !== undefined && storedPathOwner(path) !== ownerId) {
    console.error('Refused cross-owner stored-image delete', { path, ownerId });
    return;
  }
  try {
    await env.R2.delete(path.slice(STORAGE_PATH_PREFIX.length));
  } catch (error) {
    console.error('Stored image delete failed', error);
  }
}
