import { destinationPoint } from './distance.js';
import type { GeoJSONFeature, StationCoverage } from '../types/coverage.js';

/**
 * Build a smoothed GeoJSON polygon from bearing sector data.
 * Each sector's max distance defines a vertex; sectors with no data
 * interpolate from neighbors. The result is a polygon surrounding the station.
 */
export function buildCoveragePolygon(
  stationLat: number,
  stationLon: number,
  coverage: StationCoverage,
): GeoJSONFeature | null {
  const sectors = coverage.bearingSectors;
  if (coverage.messagesWithPosition === 0) return null;

  // Find the max distance across all sectors for fallback
  const maxDist = coverage.maxDistance;
  if (maxDist <= 0) return null;

  // Build raw vertices: one per 10-degree sector
  const rawDistances: number[] = [];
  for (let i = 0; i < 36; i++) {
    rawDistances.push(sectors[i] > 0 ? sectors[i] : 0);
  }

  // Interpolate gaps: sectors with 0 distance get linearly interpolated
  // from nearest non-zero neighbors
  const interpolated = interpolateGaps(rawDistances);

  // If still all zeros, no polygon
  if (interpolated.every(d => d === 0)) return null;

  // Generate polygon vertices
  const coordinates: number[][] = [];
  for (let i = 0; i < 36; i++) {
    const brng = i * 10 + 5; // center of sector
    const dist = interpolated[i];
    if (dist > 0) {
      const [lat, lon] = destinationPoint(stationLat, stationLon, dist, brng);
      coordinates.push([lon, lat]); // GeoJSON is [lon, lat]
    }
  }

  if (coordinates.length < 3) return null;

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

/** Linearly interpolate zero-valued sectors from nearest non-zero neighbors */
function interpolateGaps(distances: number[]): number[] {
  const result = [...distances];
  const n = result.length;

  // Find first non-zero
  let firstNonZero = -1;
  for (let i = 0; i < n; i++) {
    if (result[i] > 0) { firstNonZero = i; break; }
  }
  if (firstNonZero === -1) return result;

  // Walk around the circle, interpolating gaps
  let prevIdx = firstNonZero;
  let i = (firstNonZero + 1) % n;
  while (i !== firstNonZero) {
    if (result[i] > 0) {
      // Fill gap between prevIdx and i
      const gapStart = prevIdx;
      const gapEnd = i;
      let gapLen = (gapEnd - gapStart + n) % n;
      if (gapLen > 1) {
        const startVal = result[gapStart];
        const endVal = result[gapEnd];
        for (let j = 1; j < gapLen; j++) {
          const idx = (gapStart + j) % n;
          const t = j / gapLen;
          result[idx] = startVal + (endVal - startVal) * t;
        }
      }
      prevIdx = i;
    }
    i = (i + 1) % n;
  }

  // Fill final gap (from last non-zero back to first non-zero)
  if (prevIdx !== firstNonZero) {
    const gapLen = (firstNonZero - prevIdx + n) % n;
    if (gapLen > 1) {
      const startVal = result[prevIdx];
      const endVal = result[firstNonZero];
      for (let j = 1; j < gapLen; j++) {
        const idx = (prevIdx + j) % n;
        const t = j / gapLen;
        result[idx] = startVal + (endVal - startVal) * t;
      }
    }
  }

  return result;
}
