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

  // Estimate coverage area from H3 res-3 cells (each ~12,400 km²)
  const res3Cells = stats.activeCells[3] ?? 0;
  const coverageAreaKm2 = Math.round(res3Cells * 12400);

  return c.json({
    messagesPerSecond: mps,
    activeStations: stats.stationsTracked,
    totalCells: stats.activeCells,
    coverageAreaKm2,
    natsConnected: nats.isConnected(),
  });
});

/** GET /api/v1/activity — Recent message activity for the live ticker */
healthRoutes.get('/activity', (c) => {
  const store = c.get('store');
  const nats = c.get('nats');

  // Get the 1m window H3 data at res 5 for recent activity
  const cells = store.getH3Data(5, '1m');

  // Aggregate by source type
  const bySource: Record<string, { messages: number; stations: number }> = {};
  for (const cell of cells) {
    for (const src of cell.sources) {
      if (!bySource[src]) bySource[src] = { messages: 0, stations: 0 };
      bySource[src].messages += cell.msgCount;
    }
    // Count unique stations per source from cell data
  }

  // Get station counts per source type from the 1m window
  const stationCounts = store.getStationMessageCounts('1m');
  const stationsBySource: Record<string, number> = {};
  for (const [stationId] of stationCounts) {
    const meta = store.stationMap.get(stationId);
    if (meta) {
      const src = meta.sourceType;
      stationsBySource[src] = (stationsBySource[src] ?? 0) + 1;
    }
  }

  return c.json({
    window: '1m',
    sources: Object.entries(bySource).map(([source, data]) => ({
      source,
      messages: data.messages,
      stations: stationsBySource[source] ?? 0,
    })).sort((a, b) => b.messages - a.messages),
    totalMessages: cells.reduce((sum, c2) => sum + c2.msgCount, 0),
    totalCells: cells.length,
  });
});
