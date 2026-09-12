/**
 * Fixed-window rate limiting on KV. The window index is derived from the clock
 * and each bucket expires after two windows, so counters self-clean.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucketKey = `rl:${key}:${bucket}`;

  const current = Number.parseInt((await kv.get(bucketKey)) ?? '0', 10) || 0;
  if (current >= limit) return { allowed: false, remaining: 0 };

  await kv.put(bucketKey, String(current + 1), { expirationTtl: windowSeconds * 2 });
  return { allowed: true, remaining: limit - current - 1 };
}

export function clientIp(headers: Headers): string {
  return headers.get('CF-Connecting-IP') ?? headers.get('X-Forwarded-For') ?? 'unknown';
}
