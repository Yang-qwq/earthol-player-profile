/**
 * Serves objects from the optional R2 binding at `GET/HEAD /files/*`. This
 * router owns a top-level prefix, so it is mounted before `publicRoutes` (see
 * `src/app.tsx`). Only keys matching `STORAGE_KEY_RE` are reachable; the
 * content type comes from the object metadata (magic-byte-sniffed at upload
 * time), and responses are immutable-cacheable because keys are unique random
 * tokens whose objects are deleted when replaced.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { STORAGE_KEY_RE, STORAGE_PATH_PREFIX, storageEnabled } from '../lib/storage';
import { getActiveBan } from '../db/queries';

export const fileRoutes = new Hono<AppContext>();

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

fileRoutes.on(['GET', 'HEAD'], '/files/*', async (c) => {
  const isHead = c.req.method === 'HEAD';
  const notFound = () =>
    isHead ? new Response(null, { status: 404 }) : c.text('Not found', 404);

  if (!storageEnabled(c.env)) return notFound();

  let key: string;
  try {
    key = decodeURIComponent(c.req.path.slice(STORAGE_PATH_PREFIX.length));
  } catch {
    return notFound();
  }
  if (!STORAGE_KEY_RE.test(key)) return notFound();

  // A suspended account's uploaded media is not served either. The key shape
  // is `<avatars|gallery>/<userId>/<token>.<ext>`, so the owner is the second
  // segment (the regex above guarantees it exists).
  const ownerId = key.split('/')[1];
  if (await getActiveBan(c.env.DB, ownerId)) return notFound();

  if (isHead) {
    const head = await c.env.R2.head(key);
    if (!head) return notFound();
    const headers = new Headers();
    head.writeHttpMetadata(headers);
    headers.set('ETag', head.httpEtag);
    headers.set('Cache-Control', CACHE_CONTROL);
    return new Response(null, { status: 200, headers });
  }

  // Passing the request headers as `onlyIf` lets R2 evaluate the conditional
  // headers (If-None-Match); a returned object without a body means "not
  // modified", answered with 304 + the same validators.
  const object = await c.env.R2.get(key, { onlyIf: c.req.raw.headers });
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', CACHE_CONTROL);

  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
});
