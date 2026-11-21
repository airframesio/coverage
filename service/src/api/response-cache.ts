import type { MiddlewareHandler } from 'hono';

interface CachedResponse {
  body: string;
  contentType: string;
  expiresAt: number;
}

const MAX_ENTRIES = 500;

/**
 * Keep each successful GET answer for a few seconds and hand the same bytes to
 * every caller who asks the same question in that time.
 *
 * The answers are computed from the in-memory windows on the one thread that
 * also takes in events, and each costs real CPU (merging a window's slices,
 * building the station list). Every open map asks for them again every ten
 * seconds, so without this the cost grows with the number of open maps until
 * the process cannot answer anything, health check included.
 */
export function responseCache(ttlMs: number, now: () => number = Date.now): MiddlewareHandler {
  const cache = new Map<string, CachedResponse>();

  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const url = new URL(c.req.url);
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
    const key = `${url.pathname}?${new URLSearchParams(params)}`;

    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      return c.body(hit.body, 200, { 'Content-Type': hit.contentType, 'X-Cache': 'hit' });
    }

    await next();

    if (c.res.status !== 200) return;
    const body = await c.res.clone().text();
    if (cache.size >= MAX_ENTRIES) {
      const time = now();
      for (const [k, v] of cache) if (v.expiresAt <= time) cache.delete(k);
      if (cache.size >= MAX_ENTRIES) cache.clear();
    }
    cache.set(key, {
      body,
      contentType: c.res.headers.get('Content-Type') ?? 'application/json',
      expiresAt: now() + ttlMs,
    });
  };
}
