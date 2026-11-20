import { maxRangeKm } from '../compute/signal-analysis.js';
import { sourceFamily, type SourceFamily } from '../compute/source-family.js';

/** Valid frequency bands by source family (MHz) */
const FREQUENCY_BANDS: Partial<Record<SourceFamily, Array<{ min: number; max: number }>>> = {
  acars: [{ min: 118, max: 137 }],
  vdl: [{ min: 130, max: 140 }],
  hfdl: [{ min: 2, max: 24 }],
  satcom: [{ min: 1525, max: 1559 }, { min: 1616, max: 1626.5 }, { min: 3400, max: 4200 }],
  ais: [{ min: 156, max: 163 }],
};

/** Signal level plausibility ranges by source family */
const SIGNAL_RANGES: Partial<Record<SourceFamily, { min: number; max: number }>> = {
  acars:  { min: -60, max: 10 },
  vdl:    { min: -60, max: 10 },
  hfdl:   { min: -40, max: 10 },
  satcom: { min: -40, max: 10 },
  ais:    { min: -60, max: 10 },
};

export type SignalRejection = 'signal_level' | 'error_count';

export interface SignalValidationResult {
  valid: boolean;
  /** Set when valid is false */
  reason?: SignalRejection;
  warnings: string[];
}

/**
 * Validate signal characteristics for a given source type.
 * Range plausibility is separate: see isPlausibleRange.
 */
export function validateSignal(
  sourceType: string,
  frequency: number | null,
  signalLevel: number | null,
  errorCount: number | null,
): SignalValidationResult {
  const warnings: string[] = [];
  const family = sourceFamily(sourceType);

  // Frequency validation
  if (frequency !== null && frequency > 0) {
    const bands = FREQUENCY_BANDS[family];
    if (bands) {
      const inBand = bands.some(b => frequency >= b.min && frequency <= b.max);
      if (!inBand) {
        warnings.push(`frequency ${frequency} MHz outside expected bands for ${sourceType}`);
      }
    }
  }

  // Signal level validation
  if (signalLevel !== null) {
    const range = SIGNAL_RANGES[family];
    if (range) {
      if (signalLevel < range.min || signalLevel > range.max) {
        warnings.push(`signal level ${signalLevel} outside expected range for ${sourceType}`);
      }
    }
    // Impossible positive signal (>10 dBm is unrealistic for passive receivers)
    if (signalLevel > 10) {
      return { valid: false, reason: 'signal_level', warnings: [`impossible signal level: ${signalLevel}`] };
    }
  }

  // Error count validation
  if (errorCount !== null && errorCount > 100) {
    return { valid: false, reason: 'error_count', warnings: [`extreme error count: ${errorCount}`] };
  }

  return { valid: true, warnings };
}

/**
 * Whether a target at this distance could have been heard on this kind of link.
 * Allows 20% over the nominal maximum for unusual propagation.
 */
export function isPlausibleRange(sourceType: string, distanceKm: number): boolean {
  return distanceKm <= maxRangeKm(sourceType) * 1.2;
}
