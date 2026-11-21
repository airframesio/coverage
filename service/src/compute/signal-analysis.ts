import type { CellAggregation } from '../types/coverage.js';
import { sourceFamily, type SourceFamily } from './source-family.js';
import { cellPrimarySource } from '../aggregation/sliding-window.js';

/** Signal level calibration ranges by source family */
const SIGNAL_CALIBRATION: Record<SourceFamily, { min: number; max: number }> = {
  acars:   { min: -50, max: 0 },
  vdl:     { min: -50, max: 0 },
  hfdl:    { min: -30, max: 0 },
  satcom:  { min: -30, max: 0 },
  ais:     { min: -50, max: 0 },
  unknown: { min: -50, max: 0 },
};

/** Max plausible distance between receiver and target by source family (km) */
export const MAX_RANGE_KM: Record<SourceFamily, number> = {
  acars:   600,
  vdl:     400,
  hfdl:    4000,
  satcom:  50000,   // relayed by satellite - effectively unlimited
  ais:     300,     // VHF line of sight plus ducting; good coastal antennas were seen at 140-240 km
  unknown: 1000,
};

/** Max plausible range for a source type, in any of its spellings */
export function maxRangeKm(sourceType: string): number {
  return MAX_RANGE_KM[sourceFamily(sourceType)];
}

/** Normalize signal level to 0-1 based on source type */
export function normalizeSignalLevel(level: number, sourceType: string): number {
  const cal = SIGNAL_CALIBRATION[sourceFamily(sourceType)];
  const clamped = Math.max(cal.min, Math.min(cal.max, level));
  return (clamped - cal.min) / (cal.max - cal.min);
}

/** Distance confidence factor */
function distanceConfidence(distanceKm: number, sourceType: string): number {
  const maxRange = maxRangeKm(sourceType);
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

  // Calibrate against the first source recorded for the cell
  const primarySource = cellPrimarySource(cell);

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
