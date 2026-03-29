import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION_CONFIGS } from '../types/coverage.js';

/** Compute H3 cell indices at all configured resolutions for a given point */
export function indexPoint(lat: number, lon: number): Map<number, string> {
  const cells = new Map<number, string>();
  for (const { resolution } of H3_RESOLUTION_CONFIGS) {
    cells.set(resolution, latLngToCell(lat, lon, resolution));
  }
  return cells;
}

/** Compute H3 cell index at a specific resolution */
export function indexPointAtResolution(lat: number, lon: number, resolution: number): string {
  return latLngToCell(lat, lon, resolution);
}

/** Check if a given H3 resolution should be maintained for a given window index */
export function shouldMaintainResolution(resolution: number, windowIndex: number): boolean {
  const config = H3_RESOLUTION_CONFIGS.find(c => c.resolution === resolution);
  if (!config) return false;
  return windowIndex <= config.maxWindowIndex;
}
