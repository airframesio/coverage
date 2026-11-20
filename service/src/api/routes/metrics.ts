import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Registry } from 'prom-client';

/**
 * GET /metrics, Prometheus text format. This port is public, so the route is
 * gated behind MONITORING_TOKEN exactly like the api-server's metrics guard:
 * the token comes in `X-Monitoring-Token` or `Authorization: Bearer <token>`,
 * is compared in constant time, and the route fails closed (401) when
 * MONITORING_TOKEN is not configured.
 */
export function metricsRoutes(registry: Registry): Hono {
  const routes = new Hono();

  routes.get('/metrics', async (c) => {
    const expected = process.env.MONITORING_TOKEN;
    if (!expected) {
      return c.json({ statusCode: 401, message: 'metrics endpoint not configured' }, 401);
    }

    const auth = c.req.header('authorization') ?? '';
    const provided = c.req.header('x-monitoring-token')
      ?? (auth.startsWith('Bearer ') ? auth.slice(7) : '');

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ statusCode: 401, message: 'Unauthorized' }, 401);
    }

    return c.body(await registry.metrics(), 200, {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store',
    });
  });

  return routes;
}
