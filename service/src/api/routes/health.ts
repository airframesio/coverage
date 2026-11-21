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
    marine: {
      paired: nats.marine.paired,
      fromLastPosition: nats.marine.fromLastPosition,
      withoutPosition: nats.marine.withoutPosition,
      unknownStation: nats.marineUnknownStation,
      pending: nats.marine.pendingSize,
      trackedVoyages: nats.marine.trackedVoyages,
    },
    coverage: {
      eventsProcessed: stats.eventsProcessed,
      processedBySource: stats.processedBySource,
      eventsRejected: stats.eventsRejected,
      eventsWithPosition: stats.eventsWithPosition,
      eventsWithoutPosition: stats.eventsWithoutPosition,
      rejections: stats.rejections,
      positionsDiscarded: stats.positionsDiscarded,
      outOfRange: stats.outOfRange,
      outOfRangeDistanceKm: store.getOutOfRangeDistances(),
      outOfRangeStations: store.getOutOfRangeStations(),
      stationsPlacedByHeard: store.getStationsPlacedByHeard(),
      stationsTracked: stats.stationsTracked,
      activeCells: stats.activeCells,
      cellsInMemory: store.getCellsInMemory(),
    },
  });
});

/** GET /api/v1/stats — Live stats for the frontend StatsBar */
healthRoutes.get('/stats', (c) => {
  const store = c.get('store');
  const nats = c.get('nats');
  const stats = store.getStats();

  const mps = store.getEventsPerSecond();

  // Same figure the H3 endpoint reports for the 1h window
  const coverageAreaKm2 = store.getCoverageAreaKm2('1h');

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
