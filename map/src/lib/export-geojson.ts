import { cellToBoundary } from 'h3-js';
import type { CoverageHex, CoveragePolygon, Station } from './types/coverage';

interface ExportInput {
  mode: 'hexgrid' | 'polygon' | 'density';
  timeWindow: string;
  transportFilter: string;
  hexData: CoverageHex[];
  polygonData: CoveragePolygon[];
  stations: Station[];
}

/**
 * Build a GeoJSON FeatureCollection of what the map is currently showing:
 * the coverage layer for the active mode (H3 cells, or per-station polygons
 * in the Polygons and Density views)
 * plus every station with a known position.
 */
export function buildCoverageGeoJSON({
  mode, timeWindow, transportFilter, hexData, polygonData, stations,
}: ExportInput) {
  const coverage = mode === 'hexgrid'
    ? hexData.map((hex) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          // formatAsGeoJson: [lng, lat] order with a closed ring
          coordinates: [cellToBoundary(hex.h3, true)],
        },
        properties: {
          type: 'hex',
          h3: hex.h3,
          messageCount: hex.msgCount,
          confidence: hex.confidence,
          maxDistance: hex.maxDistance,
          avgLevel: hex.avgLevel,
          errorRate: hex.errorRate,
          stationCount: hex.stationCount,
          sources: hex.sources,
          transportTypes: hex.transportTypes,
        },
      }))
    : polygonData.map((polygon) => ({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: polygon.coordinates },
        properties: {
          type: 'station-coverage',
          stationId: polygon.stationId,
          ident: polygon.ident,
          sourceType: polygon.sourceType,
          messageCount: polygon.messageCount,
          confidence: polygon.confidence,
        },
      }));

  const stationFeatures = stations
    .filter((s) => s.latitude !== 0 || s.longitude !== 0)
    .map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] },
      properties: {
        type: 'station',
        stationId: s.id,
        ident: s.ident,
        sourceType: s.sourceType,
        messageCount: s.messageCount,
        maxDistance: s.maxDistance,
        confidence: s.confidence,
        lastSeen: s.lastSeen,
      },
    }));

  return {
    type: 'FeatureCollection' as const,
    metadata: {
      generator: 'Airframes Coverage Map',
      generatedAt: new Date().toISOString(),
      mode,
      window: timeWindow,
      transport: transportFilter,
    },
    features: [...coverage, ...stationFeatures],
  };
}
