/**
 * Server-side WebP transcoding for gallery uploads, built on the optional
 * Cloudflare Images binding (`env.IMAGES`).
 *
 * The Workers runtime has no canvas/`createImageBitmap` APIs (workerd does
 * not ship a DOM canvas — see cloudflare/workerd#54), so the Images binding
 * is the runtime-supported way to decode, resize and re-encode images. The
 * binding is therefore a second *optional* dependency, exactly like R2:
 * deployments without it (or with R2 but no Images) still get working
 * uploads — the original bytes are stored unchanged instead.
 *
 * The contract stays deliberately conservative: the function returns a WebP
 * `Uint8Array` only when the Images binding could decode AND re-encode the
 * input, and `null` otherwise (no binding, undecodable bytes, runtime
 * error, empty output, or output that is not actually a WebP). Callers
 * (src/lib/storage.ts) treat `null` as "store the original bytes", so
 * transcoding is an optimisation that must never turn a valid upload into a
 * failed one.
 */
import type { Env } from '../types';

/** Longest edge after transcoding; larger images are scaled down to this. */
const MAX_TRANSCODE_EDGE = 1600;

/** WebP quality, 1..100 (Cloudflare Images quality scale). */
const WEBP_QUALITY = 82;

/**
 * Decodes `input` and re-encodes it as WebP, scaled down so the longest edge
 * is at most `MAX_TRANSCODE_EDGE` (smaller images keep their size). Returns
 * the transcoded bytes, or `null` when the binding is absent or the
 * transcode failed for any reason — the caller then stores the original
 * bytes. EXIF orientation is applied by the Images runtime by default.
 */
export async function transcodeImageToWebp(
  env: Env,
  input: Uint8Array,
): Promise<Uint8Array | null> {
  const images = env.IMAGES;
  if (typeof images === 'undefined') return null;
  try {
    const body = new Response(input).body;
    if (!body) return null;

    const result = await images
      .input(body)
      .transform({ width: MAX_TRANSCODE_EDGE, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: WEBP_QUALITY });

    const bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
    // Defence in depth: verify we really produced a WebP (RIFF....WEBP)
    // before handing the bytes back for storage under a `.webp` key.
    const isWebp =
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    return isWebp ? bytes : null;
  } catch {
    return null;
  }
}
