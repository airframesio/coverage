import { destinationPoint } from './distance.js';
import type { GeoJSONFeature, StationCoverage } from '../types/coverage.js';

/**
 * Build a GeoJSON polygon from bearing sector data.
 * If enough sectors have data, builds a directional shape.
 * If only 1-2 sectors, builds an ellipse stretched toward those sectors.
 */
export function buildCoveragePolygon(
  stationLat: number,
  stationLon: number,
  coverage: StationCoverage,
): GeoJSONFeature | null {
  if (coverage.messagesWithPosition === 0) return null;

  const maxDist = coverage.maxDistance;
  if (maxDist <= 0) return null;

  // Count sectors with data
  const nonZeroSectors: Array<{ index: number; distance: number }> = [];
  for (let i = 0; i < 36; i++) {
    if (coverage.bearingSectors[i] > 0) {
      nonZeroSectors.push({ index: i, distance: coverage.bearingSectors[i] });
    }
  }

  let coordinates: number[][];

  if (nonZeroSectors.length >= 3) {
    // Enough data for a directional polygon
    const rawDistances: number[] = [];
    for (let i = 0; i < 36; i++) {
      rawDistances.push(coverage.bearingSectors[i] > 0 ? coverage.bearingSectors[i] : 0);
    }
    const interpolated = interpolateGaps(rawDistances);
    coordinates = [];
    for (let i = 0; i < 36; i++) {
      const brng = i * 10 + 5;
      const dist = interpolated[i];
      if (dist > 0) {
        const [lat, lon] = destinationPoint(stationLat, stationLon, dist, brng);
        coordinates.push([lon, lat]);
      }
    }
  } else {
    // Few sectors: build an ellipse stretched toward the known sectors
    // Use maxDist as the radius toward known sectors, and a fraction for other directions
    const minRadius = maxDist * 0.3; // minimum radius in unknown directions
    coordinates = [];
    for (let i = 0; i < 36; i++) {
      const brng = i * 10 + 5;
      let dist = minRadius;

      // Check if this sector (or a nearby sector) has data
      for (const s of nonZeroSectors) {
        const sectorAngle = s.index * 10 + 5;
        const diff = Math.abs(brng - sectorAngle);
        const angularDist = Math.min(diff, 360 - diff);
        // Smoothly blend toward known sector distances
        if (angularDist < 90) {
          const blend = 1 - angularDist / 90;
          dist = Math.max(dist, minRadius + (s.distance - minRadius) * blend);
        }
      }

      const [lat, lon] = destinationPoint(stationLat, stationLon, dist, brng);
      coordinates.push([lon, lat]);
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

  let firstNonZero = -1;
  for (let i = 0; i < n; i++) {
    if (result[i] > 0) { firstNonZero = i; break; }
  }
  if (firstNonZero === -1) return result;

  let prevIdx = firstNonZero;
  let i = (firstNonZero + 1) % n;
  while (i !== firstNonZero) {
    if (result[i] > 0) {
      const gapStart = prevIdx;
      const gapEnd = i;
      const gapLen = (gapEnd - gapStart + n) % n;
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
