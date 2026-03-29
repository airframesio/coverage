import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { buildCoveragePolygon } from '../../compute/polygon-builder.js';
import { WINDOW_CONFIGS } from '../../types/coverage.js';
import type { TransportType } from '../../types/events.js';

export const coverageRoutes = new Hono<AppContext>();

/** GET /api/v1/coverage/h3 — H3 hex grid coverage data */
coverageRoutes.get('/h3', (c) => {
  const store = c.get('store');

  const windowName = c.req.query('window') ?? '1h';
  const resolution = parseInt(c.req.query('resolution') ?? '4', 10);
  const transportRaw = c.req.query('transport') ?? 'all';
  const minConfidence = c.req.query('minConfidence') ? parseFloat(c.req.query('minConfidence')!) : undefined;

  // Validate window name
  if (!WINDOW_CONFIGS.find(w => w.name === windowName)) {
    return c.json({ error: `Invalid window: ${windowName}` }, 400);
  }

  // Validate resolution
  if (resolution < 2 || resolution > 7) {
    return c.json({ error: `Invalid resolution: ${resolution}. Must be 2-7.` }, 400);
  }

  const validTransports = ['aircraft', 'marine', 'sonde', 'space'];
  const cells = store.getH3Data(resolution, windowName, {
    transportType: validTransports.includes(transportRaw) ? transportRaw as TransportType : undefined,
    minConfidence,
  });

  return c.json({
    window: windowName,
    resolution,
    generatedAt: new Date().toISOString(),
    cellCount: cells.length,
    cells,
  });
});

/** GET /api/v1/coverage/stations/:id — Single station directional coverage */
coverageRoutes.get('/stations/:id', (c) => {
  const store = c.get('store');
  const stationId = parseInt(c.req.param('id'), 10);
  const windowName = c.req.query('window') ?? '1h';
  const transportRaw = c.req.query('transport');
  const validTransports = ['aircraft', 'marine', 'sonde', 'space'];
  const transportFilter = transportRaw && validTransports.includes(transportRaw)
    ? transportRaw as TransportType
    : undefined;

  if (!Number.isInteger(stationId) || stationId < 1) {
    return c.json({ error: 'Invalid station ID' }, 400);
  }

  const station = store.stationMap.get(stationId);
  if (!station) {
    return c.json({ error: 'Station not found' }, 404);
  }

  // Window-scoped message counts from H3 sliding windows
  const windowCounts = store.getStationMessageCounts(windowName);
  const windowData = windowCounts.get(stationId);

  if (!windowData || windowData.messageCount === 0) {
    return c.json({ error: 'No coverage data for this station in this window' }, 404);
  }

  // Bearing sector data filtered by transport type
  const coverage = store.getStationCoverage(stationId, windowName, transportFilter);

  const polygon = coverage
    ? buildCoveragePolygon(station.latitude, station.longitude, coverage)
    : null;

  const bearingSectors = [];
  for (let i = 0; i < 36; i++) {
    bearingSectors.push({
      bearing: i * 10,
      distance: coverage ? Math.round(coverage.bearingSectors[i] * 10) / 10 : 0,
      msgCount: coverage ? coverage.sectorMessageCounts[i] : 0,
      avgLevel: coverage && coverage.sectorAvgLevels[i] !== 0
        ? Math.round(coverage.sectorAvgLevels[i] * 10) / 10
        : null,
    });
  }

  return c.json({
    stationId,
    ident: station.ident,
    position: { lat: station.latitude, lon: station.longitude },
    sourceType: station.sourceType,
    window: windowName,
    messageCount: windowData.messageCount,
    messagesWithPosition: coverage?.messagesWithPosition ?? 0,
    avgLevel: coverage && coverage.avgLevel !== 0 ? Math.round(coverage.avgLevel * 10) / 10 : null,
    errorRate: coverage ? Math.round(coverage.errorRate * 1000) / 1000 : 0,
    maxDistance: Math.round(windowData.maxDistance * 10) / 10,
    confidence: coverage?.confidence ?? 0,
    bearingSectors,
    polygon,
  });
});
