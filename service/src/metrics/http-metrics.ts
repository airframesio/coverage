import type { MiddlewareHandler } from 'hono';
import { Counter, Histogram, type Registry } from 'prom-client';

/** Fixed route names, so the label set stays small whatever clients ask for */
export function routeName(path: string): string {
  if (path === '/api/v1/coverage/h3') return 'coverage_h3';
  if (path === '/api/v1/coverage/polygons') return 'coverage_polygons';
  if (path.startsWith('/api/v1/coverage/stations/')) return 'coverage_station';
  if (path === '/api/v1/stations' || path === '/api/v1/stations/') return 'stations';
  if (path === '/api/v1/stats') return 'stats';
  if (path === '/api/v1/health') return 'health';
  if (path === '/api/v1/activity') return 'activity';
  if (path === '/metrics') return 'metrics';
  return 'other';
}

/**
 * Count requests and their handling time by route and cache outcome. The
 * service answers on the same thread that takes in events, so this is what
 * shows which clients keep it busy.
 */
export function requestMetrics(registry: Registry): MiddlewareHandler {
  const requests = new Counter({
    name: 'coverage_http_requests_total',
    help: 'HTTP requests answered, by route, status class and cache outcome',
    labelNames: ['route', 'status', 'cache'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'coverage_http_request_duration_seconds',
    help: 'Time spent answering HTTP requests, by route and cache outcome',
    labelNames: ['route', 'cache'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return async (c, next) => {
    const start = performance.now();
    await next();
    const route = routeName(new URL(c.req.url).pathname);
    const cache = c.res.headers.get('X-Cache') === 'hit' ? 'hit' : 'miss';
    requests.inc({ route, status: `${Math.floor(c.res.status / 100)}xx`, cache });
    duration.observe({ route, cache }, (performance.now() - start) / 1000);
  };
}
