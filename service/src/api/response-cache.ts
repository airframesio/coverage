import type { MiddlewareHandler } from 'hono';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlib } from 'node:zlib';

type Encoding = 'br' | 'gzip';

interface CachedResponse {
  body: string;
  contentType: string;
  expiresAt: number;
  /** Compressed copies, made once per answer on first request for each encoding */
  encoded: Partial<Record<Encoding, Promise<Buffer>>>;
}

const MAX_ENTRIES = 500;

/** Answers smaller than this are sent as they are: compressing them saves nothing */
export const MIN_COMPRESS_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Compress on the libuv thread pool, not the thread that takes in events.
 * Brotli quality 5 is several times faster than the default 11 and still
 * shrinks the coverage JSON about as well as gzip -9.
 */
function compress(body: string, encoding: Encoding): Promise<Buffer> {
  const input = Buffer.from(body);
  if (encoding === 'br') {
    return brotli(input, {
      params: {
        [zlib.BROTLI_PARAM_QUALITY]: 5,
        [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT,
        [zlib.BROTLI_PARAM_SIZE_HINT]: input.length,
      },
    });
  }
  return gzipAsync(input, { level: 6 });
}

/** Best encoding the caller accepts: br, then gzip, else none */
export function pickEncoding(acceptEncoding: string | undefined): Encoding | null {
  if (!acceptEncoding) return null;
  const accepted = new Set<string>();
  for (const part of acceptEncoding.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    if (q && parseFloat(q.slice(2)) === 0) continue;
    accepted.add(name.trim());
  }
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip') || accepted.has('*')) return 'gzip';
  return null;
}

/**
 * Keep each successful GET answer for a few seconds and hand the same bytes to
 * every caller who asks the same question in that time.
 *
 * The answers are computed from the in-memory windows on the one thread that
 * also takes in events, and each costs real CPU (merging a window's slices,
 * building the station list). Every open map asks for them again every ten
 * seconds, so without this the cost grows with the number of open maps until
 * the process cannot answer anything, health check included.
 *
 * Answers are also sent compressed (br or gzip, as the caller accepts). The
 * h3 grid and polygon answers are megabytes of JSON; each cached answer is
 * compressed at most once per encoding, off the main thread.
 */
export function responseCache(ttlMs: number, now: () => number = Date.now): MiddlewareHandler {
  const cache = new Map<string, CachedResponse>();

  async function send(entry: CachedResponse, acceptEncoding: string | undefined, cacheState: 'hit' | 'miss'): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': entry.contentType,
      'X-Cache': cacheState,
      Vary: 'Accept-Encoding',
    };
    const encoding = entry.body.length >= MIN_COMPRESS_BYTES ? pickEncoding(acceptEncoding) : null;
    if (!encoding) return new Response(entry.body, { status: 200, headers });
    const pending = (entry.encoded[encoding] ??= compress(entry.body, encoding));
    try {
      const bytes = await pending;
      return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'Content-Encoding': encoding } });
    } catch {
      delete entry.encoded[encoding];
      return new Response(entry.body, { status: 200, headers });
    }
  }

  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const url = new URL(c.req.url);
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
    const key = `${url.pathname}?${new URLSearchParams(params)}`;
    const acceptEncoding = c.req.header('Accept-Encoding');

    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      c.res = await send(hit, acceptEncoding, 'hit');
      return;
    }

    await next();

    if (c.res.status !== 200) return;
    const body = await c.res.clone().text();
    if (cache.size >= MAX_ENTRIES) {
      const time = now();
      for (const [k, v] of cache) if (v.expiresAt <= time) cache.delete(k);
      if (cache.size >= MAX_ENTRIES) cache.clear();
    }
    const entry: CachedResponse = {
      body,
      contentType: c.res.headers.get('Content-Type') ?? 'application/json',
      expiresAt: now() + ttlMs,
      encoded: {},
    };
    cache.set(key, entry);
    c.res = await send(entry, acceptEncoding, 'miss');
  };
}
