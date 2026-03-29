import type { CellAggregation } from '../types/coverage.js';

/** Source-specific signal level calibration ranges */
const SIGNAL_CALIBRATION: Record<string, { min: number; max: number }> = {
  acarsdec:        { min: -50, max: 0 },
  vdlm2dec:        { min: -50, max: 0 },
  dumpvdl2:        { min: -50, max: 0 },
  dumphfdl:        { min: -30, max: 0 },
  jaero:           { min: -20, max: 0 },
  iridium_toolkit: { min: -30, max: 0 },
  satdump:         { min: -20, max: 0 },
  aiscatcher:      { min: -50, max: 0 },
};

/** Max plausible reception range by source type (km) */
export const MAX_RANGE_KM: Record<string, number> = {
  acarsdec:        600,
  vdlm2dec:        400,
  dumpvdl2:        400,
  dumphfdl:        4000,
  jaero:           50000,   // satellite - effectively unlimited
  iridium_toolkit: 50000,
  satdump:         50000,
  aiscatcher:      70,
};

/** Default max range for unknown sources */
export const DEFAULT_MAX_RANGE_KM = 1000;

/** Normalize signal level to 0-1 based on source type */
export function normalizeSignalLevel(level: number, sourceType: string): number {
  const cal = SIGNAL_CALIBRATION[sourceType] ?? { min: -50, max: 0 };
  const clamped = Math.max(cal.min, Math.min(cal.max, level));
  return (clamped - cal.min) / (cal.max - cal.min);
}

/** Distance confidence factor */
function distanceConfidence(distanceKm: number, sourceType: string): number {
  const maxRange = MAX_RANGE_KM[sourceType] ?? DEFAULT_MAX_RANGE_KM;
  // Successful reception at greater distance is positive evidence
  // but very close to max range should be discounted slightly
  const ratio = distanceKm / maxRange;
  if (ratio < 0.3) return 1.0;
  if (ratio < 0.6) return 0.9;
  if (ratio < 0.8) return 0.7;
  if (ratio < 1.0) return 0.5;
  return 0.2; // beyond max range - probably atmospheric anomaly
}

/** Compute coverage confidence score for a cell aggregation (0.0 - 1.0) */
export function computeConfidence(cell: CellAggregation): number {
  if (cell.messageCount === 0) return 0;

  // Pick the most common source for calibration
  let primarySource = '';
  let maxSourceCount = 0;
  for (const [src, count] of cell.sources.entries()) {
    if (typeof count === 'number' && count > maxSourceCount) {
      primarySource = src;
      maxSourceCount = count;
    }
  }
  // sources is a Set, so just use the first one
  if (!primarySource && cell.sources.size > 0) {
    primarySource = cell.sources.values().next().value!;
  }

  // 1. Signal strength factor (35%)
  let signalFactor = 0.5; // default if no signal data
  if (cell.totalLevel !== 0 && cell.messageCount > 0) {
    const avgLevel = cell.totalLevel / cell.messageCount;
    signalFactor = normalizeSignalLevel(avgLevel, primarySource);
  }

  // 2. Error rate factor (25%)
  const errorRate = cell.errorMessages / cell.messageCount;
  const errorFactor = 1.0 - Math.min(errorRate, 1.0);

  // 3. Sample size factor (25%) - logarithmic diminishing returns
  const sampleFactor = Math.min(1.0, Math.log2(cell.messageCount + 1) / 10);

  // 4. Distance factor (15%)
  let distFactor = 0.5;
  if (cell.maxDistance > 0) {
    const avgDist = cell.totalDistance / cell.messageCount;
    distFactor = distanceConfidence(avgDist, primarySource);
  }

  return Math.round(
    (0.35 * signalFactor +
     0.25 * errorFactor +
     0.25 * sampleFactor +
     0.15 * distFactor) * 100
  ) / 100;
}
