import { Hono } from 'hono';
import type { AppContext } from '../server.js';

export const stationRoutes = new Hono<AppContext>();

/** GET /api/v1/stations — All stations with coverage summaries */
stationRoutes.get('/', (c) => {
  const store = c.get('store');
  const windowName = c.req.query('window') ?? '1h';
  const activeOnly = c.req.query('active') !== 'false';

  const allCoverage = store.getAllStationCoverage(windowName);
  const stations = [];

  for (const cov of allCoverage) {
    if (activeOnly && cov.totalMessages === 0) continue;

    const meta = store.stationMap.get(cov.stationId);
    if (!meta) continue;

    stations.push({
      id: cov.stationId,
      uuid: meta.uuid,
      ident: meta.ident,
      latitude: meta.latitude,
      longitude: meta.longitude,
      sourceType: meta.sourceType,
      messageCount: cov.totalMessages,
      messagesWithPosition: cov.messagesWithPosition,
      maxDistance: Math.round(cov.maxDistance * 10) / 10,
      avgLevel: cov.avgLevel !== 0 ? Math.round(cov.avgLevel * 10) / 10 : null,
      errorRate: Math.round(cov.errorRate * 1000) / 1000,
      confidence: cov.confidence,
      lastSeen: new Date(cov.lastUpdated).toISOString(),
    });
  }

  // Sort by message count descending
  stations.sort((a, b) => b.messageCount - a.messageCount);

  return c.json({
    window: windowName,
    count: stations.length,
    stations,
  });
});
