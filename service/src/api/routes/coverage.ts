import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { buildCoveragePolygon } from '../../compute/polygon-builder.js';
import { WINDOW_CONFIGS, finestResolutionFor } from '../../types/coverage.js';
import type { TransportType } from '../../types/events.js';
import { parseModes, sourceFamily } from '../../compute/source-family.js';

export const coverageRoutes = new Hono<AppContext>();

/**
 * GET /api/v1/coverage/h3 — H3 hex grid coverage data.
 * `modes=acars,vdl` keeps cells heard on those radio families (see parseModes).
 */
coverageRoutes.get('/h3', (c) => {
  const store = c.get('store');

  const windowName = c.req.query('window') ?? '1h';
  const requestedResolution = parseInt(c.req.query('resolution') ?? '4', 10);
  const transportRaw = c.req.query('transport') ?? 'all';
  const minConfidence = c.req.query('minConfidence') ? parseFloat(c.req.query('minConfidence')!) : undefined;
  const modes = parseModes(c.req.query('modes'));

  // Validate window name
  if (!WINDOW_CONFIGS.find(w => w.name === windowName)) {
    return c.json({ error: `Invalid window: ${windowName}` }, 400);
  }

  // Validate resolution
  if (!(requestedResolution >= 2 && requestedResolution <= 7)) {
    return c.json({ error: `Invalid resolution: ${requestedResolution}. Must be 2-7.` }, 400);
  }

  // Long windows keep only coarse grids; answer with the finest one available.
  const windowIndex = WINDOW_CONFIGS.findIndex(w => w.name === windowName);
  const resolution = finestResolutionFor(requestedResolution, windowIndex);

  const validTransports = ['aircraft', 'marine', 'sonde', 'space'];
  const transportType = validTransports.includes(transportRaw) ? transportRaw as TransportType : undefined;
  const cells = store.getH3Data(resolution, windowName, { transportType, minConfidence, modes });

  return c.json({
    window: windowName,
    resolution,
    requestedResolution,
    generatedAt: new Date().toISOString(),
    cellCount: cells.length,
    // Measured on a fixed grid, so it is the same at every resolution
    coverageAreaKm2: store.getCoverageAreaKm2(windowName, transportType, modes),
    cells,
  });
});

const MARINE_SOURCE_TYPES = new Set(['aiscatcher', 'ais']);

/**
 * GET /api/v1/coverage/polygons — Every station's coverage polygon in one
 * answer, for the map's polygon view (it used to make one request per station
 * every 10 s). Built in one pass over the window, like the station list.
 */
coverageRoutes.get('/polygons', (c) => {
  const store = c.get('store');
  const windowName = c.req.query('window') ?? '1h';
  const transportRaw = c.req.query('transport');
  const validTransports = ['aircraft', 'marine', 'sonde', 'space'];
  const transportFilter = transportRaw && validTransports.includes(transportRaw)
    ? transportRaw as TransportType
    : undefined;
  const modes = parseModes(c.req.query('modes'));

  if (!WINDOW_CONFIGS.find(w => w.name === windowName)) {
    return c.json({ error: `Invalid window: ${windowName}` }, 400);
  }

  const counts = store.getStationMessageCounts(windowName);
  const polygons = [];
  for (const coverage of store.getAllStationCoverage(windowName, transportFilter)) {
    const station = store.stationMap.get(coverage.stationId);
    if (!station) continue;
    if (station.latitude === 0 && station.longitude === 0) continue;
    if (transportFilter === 'aircraft' && MARINE_SOURCE_TYPES.has(station.sourceType)) continue;
    if (transportFilter === 'marine' && !MARINE_SOURCE_TYPES.has(station.sourceType)) continue;
    if (modes && !modes.has(sourceFamily(station.sourceType))) continue;
    const messageCount = counts.get(coverage.stationId)?.messageCount ?? 0;
    if (messageCount === 0) continue;

    const polygon = buildCoveragePolygon(station.latitude, station.longitude, coverage);
    if (!polygon) continue;
    polygons.push({
      stationId: coverage.stationId,
      ident: station.ident,
      sourceType: station.sourceType,
      messageCount,
      messagesWithPosition: coverage.messagesWithPosition,
      confidence: coverage.confidence,
      coordinates: polygon.geometry.coordinates,
    });
  }
  polygons.sort((a, b) => b.messagesWithPosition - a.messagesWithPosition);

  return c.json({ window: windowName, count: polygons.length, polygons });
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

  // Window-scoped message count for this station only
  const windowData = store.getStationMessageCount(stationId, windowName);

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
    locationSource: station.locationSource ?? 'registered',
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
