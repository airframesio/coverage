import { destinationPoint } from './distance.js';
import type { GeoJSONFeature, StationCoverage } from '../types/coverage.js';

/**
 * Build a GeoJSON polygon from bearing sector data.
 *
 * The polygon represents the actual observed coverage area:
 * - Sectors with data extend to the observed reception distance
 * - Gaps between nearby data sectors are linearly interpolated
 * - Directions far from any data sector collapse to a small radius
 * - No artificial lobe/teardrop shapes — the shape follows the data
 */
export function buildCoveragePolygon(
  stationLat: number,
  stationLon: number,
  coverage: StationCoverage,
): GeoJSONFeature | null {
  if (coverage.messagesWithPosition === 0) return null;
  if (coverage.maxDistance <= 0) return null;

  // Collect sectors with actual data
  const hasData = new Uint8Array(36);
  const rawDist = new Float64Array(36);
  let dataCount = 0;

  for (let i = 0; i < 36; i++) {
    if (coverage.bearingSectors[i] > 0) {
      hasData[i] = 1;
      rawDist[i] = coverage.bearingSectors[i];
      dataCount++;
    }
  }

  if (dataCount === 0) return null;

  // Tiny base radius so the polygon closes through the station area
  const baseRadius = Math.max(1, coverage.maxDistance * 0.03);

  // Fill in the distances for all 36 sectors
  const distances = new Float64Array(36);

  if (dataCount === 1) {
    // Single sector: create a narrow cone ±20° around that sector
    const idx = Array.from(hasData).indexOf(1);
    const dist = rawDist[idx];
    for (let i = 0; i < 36; i++) {
      const gap = circularDistance(i, idx, 36);
      if (gap === 0) {
        distances[i] = dist;
      } else if (gap <= 2) {
        // ±20°: taper linearly
        distances[i] = baseRadius + (dist - baseRadius) * (1 - gap / 3);
      } else {
        distances[i] = baseRadius;
      }
    }
  } else {
    // Multiple sectors: interpolate between adjacent data sectors,
    // collapse to base radius for large gaps (>60°)
    for (let i = 0; i < 36; i++) {
      if (hasData[i]) {
        distances[i] = rawDist[i];
        continue;
      }

      // Find nearest data sectors in each direction
      const { prevIdx, prevGap, nextIdx, nextGap } = findNeighbors(i, hasData);
      const totalGap = prevGap + nextGap;

      if (totalGap <= 6) {
        // Gap ≤ 60°: linearly interpolate between neighbors
        const t = prevGap / totalGap;
        distances[i] = rawDist[prevIdx] * (1 - t) + rawDist[nextIdx] * t;
      } else {
        // Large gap: fade to base radius
        // Use the closer neighbor and taper from it
        const nearestGap = Math.min(prevGap, nextGap);
        const nearestDist = prevGap <= nextGap ? rawDist[prevIdx] : rawDist[nextIdx];

        if (nearestGap <= 2) {
          // Within 20° of a data sector: taper
          const t = nearestGap / 3;
          distances[i] = baseRadius + (nearestDist - baseRadius) * (1 - t);
        } else {
          distances[i] = baseRadius;
        }
      }
    }
  }

  // Single light smoothing pass to avoid sharp jaggedness
  const smoothed = new Float64Array(36);
  for (let i = 0; i < 36; i++) {
    const prev = distances[(i - 1 + 36) % 36];
    const curr = distances[i];
    const next = distances[(i + 1) % 36];
    smoothed[i] = curr * 0.7 + prev * 0.15 + next * 0.15;
  }

  // Generate polygon vertices
  const coordinates: number[][] = [];
  for (let i = 0; i < 36; i++) {
    const brng = i * 10 + 5;
    const [lat, lon] = destinationPoint(stationLat, stationLon, smoothed[i], brng);
    coordinates.push([lon, lat]);
  }
  coordinates.push(coordinates[0]);

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coordinates] },
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

/** Find the nearest data sectors in each direction around the circle */
function findNeighbors(
  idx: number,
  hasData: Uint8Array,
): { prevIdx: number; prevGap: number; nextIdx: number; nextGap: number } {
  let prevIdx = idx;
  let prevGap = 0;
  for (let g = 1; g <= 36; g++) {
    const check = (idx - g + 36) % 36;
    if (hasData[check]) { prevIdx = check; prevGap = g; break; }
    if (g === 36) { prevIdx = idx; prevGap = 36; }
  }

  let nextIdx = idx;
  let nextGap = 0;
  for (let g = 1; g <= 36; g++) {
    const check = (idx + g) % 36;
    if (hasData[check]) { nextIdx = check; nextGap = g; break; }
    if (g === 36) { nextIdx = idx; nextGap = 36; }
  }

  return { prevIdx, prevGap, nextIdx, nextGap };
}
