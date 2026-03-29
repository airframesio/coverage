import { Hono } from 'hono';
import type { AppContext } from '../server.js';

export const stationRoutes = new Hono<AppContext>();

/** GET /api/v1/stations — All stations with window-scoped coverage summaries */
stationRoutes.get('/', (c) => {
  const store = c.get('store');
  const windowName = c.req.query('window') ?? '1h';
  const activeOnly = c.req.query('active') !== 'false';

  // Get window-scoped message counts from H3 sliding windows (properly expires old data)
  const windowCounts = store.getStationMessageCounts(windowName);

  // Get full coverage data (for bearing sectors, signal levels, etc.)
  const allCoverage = store.getAllStationCoverage(windowName);
  const coverageByStation = new Map(allCoverage.map((cov) => [cov.stationId, cov]));

  const stations = [];

  for (const [stationId, counts] of windowCounts) {
    if (activeOnly && counts.messageCount === 0) continue;

    const meta = store.stationMap.get(stationId);
    if (!meta) continue;

    const cov = coverageByStation.get(stationId);

    stations.push({
      id: stationId,
      uuid: meta.uuid,
      ident: meta.ident,
      latitude: meta.latitude,
      longitude: meta.longitude,
      sourceType: meta.sourceType,
      messageCount: counts.messageCount,
      messagesWithPosition: cov?.messagesWithPosition ?? 0,
      maxDistance: Math.round(counts.maxDistance * 10) / 10,
      avgLevel: cov && cov.avgLevel !== 0 ? Math.round(cov.avgLevel * 10) / 10 : null,
      errorRate: Math.round((cov?.errorRate ?? 0) * 1000) / 1000,
      confidence: cov?.confidence ?? 0,
      lastSeen: cov ? new Date(cov.lastUpdated).toISOString() : new Date().toISOString(),
    });
  }

  stations.sort((a, b) => b.messageCount - a.messageCount);

  return c.json({
    window: windowName,
    count: stations.length,
    stations,
  });
});
