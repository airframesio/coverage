import { destinationPoint } from './distance.js';
import type { GeoJSONFeature, StationCoverage } from '../types/coverage.js';

/**
 * Build a GeoJSON polygon from bearing sector data.
 * The polygon tightly follows actual reception data — unknown directions
 * fall off quickly toward the station rather than assuming wide coverage.
 */
export function buildCoveragePolygon(
  stationLat: number,
  stationLon: number,
  coverage: StationCoverage,
): GeoJSONFeature | null {
  if (coverage.messagesWithPosition === 0) return null;

  const maxDist = coverage.maxDistance;
  if (maxDist <= 0) return null;

  // Collect sectors with actual data
  const nonZeroSectors: Array<{ index: number; distance: number }> = [];
  for (let i = 0; i < 36; i++) {
    if (coverage.bearingSectors[i] > 0) {
      nonZeroSectors.push({ index: i, distance: coverage.bearingSectors[i] });
    }
  }

  if (nonZeroSectors.length === 0) return null;

  // Build distance for each 10-degree sector
  const distances = new Float64Array(36);

  // Minimum radius: just enough to be visible (5% of max distance, min 2km)
  const minRadius = Math.max(2, maxDist * 0.05);

  for (let i = 0; i < 36; i++) {
    if (coverage.bearingSectors[i] > 0) {
      // Sector has actual data — use it directly
      distances[i] = coverage.bearingSectors[i];
    } else {
      // No data in this sector — use nearest neighbor with sharp falloff
      let bestDist = minRadius;
      for (const s of nonZeroSectors) {
        const angularDist = circularDistance(i, s.index, 36);
        // Gaussian-like falloff: sharp drop within ~30 degrees, near-zero beyond ~50
        // This keeps the polygon tight to actual data
        const sigma = 3; // ~30 degrees (3 sectors)
        const weight = Math.exp(-(angularDist * angularDist) / (2 * sigma * sigma));
        const interpolated = minRadius + (s.distance - minRadius) * weight;
        bestDist = Math.max(bestDist, interpolated);
      }
      distances[i] = bestDist;
    }
  }

  // Light smoothing pass: average each sector with its immediate neighbors
  // This prevents jagged edges while keeping the overall shape tight
  const smoothed = new Float64Array(36);
  for (let i = 0; i < 36; i++) {
    const prev = distances[(i - 1 + 36) % 36];
    const curr = distances[i];
    const next = distances[(i + 1) % 36];
    smoothed[i] = curr * 0.6 + prev * 0.2 + next * 0.2;
  }

  // Generate polygon vertices
  const coordinates: number[][] = [];
  for (let i = 0; i < 36; i++) {
    const brng = i * 10 + 5;
    const [lat, lon] = destinationPoint(stationLat, stationLon, smoothed[i], brng);
    coordinates.push([lon, lat]);
  }

  // Close the polygon
  coordinates.push(coordinates[0]);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
    properties: {
      stationId: coverage.stationId,
      messageCount: coverage.totalMessages,
      maxDistance: coverage.maxDistance,
      confidence: coverage.confidence,
    },
  };
}

/** Shortest distance between two indices on a circular array */
function circularDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, size - d);
}
