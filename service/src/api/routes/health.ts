import { Hono } from 'hono';
import type { AppContext } from '../server.js';

export const healthRoutes = new Hono<AppContext>();

/** GET /api/v1/health — Service health check */
healthRoutes.get('/health', (c) => {
  const store = c.get('store');
  const nats = c.get('nats');
  const stats = store.getStats();

  return c.json({
    status: 'ok',
    nats: nats.isConnected() ? 'connected' : 'disconnected',
    uptime: Math.floor(process.uptime()),
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    natsMetrics: {
      received: nats.messagesReceived,
      parsed: nats.messagesParsed,
      parseErrors: nats.parseErrors,
    },
    coverage: {
      eventsProcessed: stats.eventsProcessed,
      eventsRejected: stats.eventsRejected,
      eventsWithPosition: stats.eventsWithPosition,
      eventsWithoutPosition: stats.eventsWithoutPosition,
      stationsTracked: stats.stationsTracked,
      activeCells: stats.activeCells,
    },
  });
});

/** GET /api/v1/stats — Live stats for the frontend StatsBar */
healthRoutes.get('/stats', (c) => {
  const store = c.get('store');
  const nats = c.get('nats');
  const stats = store.getStats();

  // Approximate messages per second (rough estimate from total / uptime)
  const uptime = process.uptime();
  const mps = uptime > 0 ? Math.round(stats.eventsProcessed / uptime * 10) / 10 : 0;

  return c.json({
    messagesPerSecond: mps,
    activeStations: stats.stationsTracked,
    totalCells: stats.activeCells,
    natsConnected: nats.isConnected(),
  });
});
