import { MAX_RANGE_KM, DEFAULT_MAX_RANGE_KM } from '../compute/signal-analysis.js';

/** Valid frequency bands by source type (MHz) */
const FREQUENCY_BANDS: Record<string, Array<{ min: number; max: number }>> = {
  acarsdec: [{ min: 118, max: 137 }],
  vdlm2dec: [{ min: 130, max: 140 }],
  dumpvdl2: [{ min: 130, max: 140 }],
  dumphfdl: [
    { min: 2, max: 4 },
    { min: 4, max: 8 },
    { min: 8, max: 13 },
    { min: 13, max: 18 },
    { min: 17, max: 24 },
  ],
  jaero:           [{ min: 1525, max: 1559 }],
  iridium_toolkit: [{ min: 1616, max: 1626.5 }],
  aiscatcher:      [{ min: 156, max: 163 }],
};

/** Signal level plausibility ranges by source type */
const SIGNAL_RANGES: Record<string, { min: number; max: number }> = {
  acarsdec:        { min: -60, max: 10 },
  vdlm2dec:        { min: -60, max: 10 },
  dumpvdl2:        { min: -60, max: 10 },
  dumphfdl:        { min: -40, max: 10 },
  jaero:           { min: -30, max: 10 },
  iridium_toolkit: { min: -40, max: 10 },
  satdump:         { min: -30, max: 10 },
  aiscatcher:      { min: -60, max: 10 },
};

export interface SignalValidationResult {
  valid: boolean;
  warnings: string[];
}

/** Validate signal characteristics for a given source type */
export function validateSignal(
  sourceType: string,
  frequency: number | null,
  signalLevel: number | null,
  errorCount: number | null,
  distanceKm: number | null,
): SignalValidationResult {
  const warnings: string[] = [];

  // Frequency validation
  if (frequency !== null && frequency > 0) {
    const bands = FREQUENCY_BANDS[sourceType];
    if (bands) {
      const inBand = bands.some(b => frequency >= b.min && frequency <= b.max);
      if (!inBand) {
        warnings.push(`frequency ${frequency} MHz outside expected bands for ${sourceType}`);
      }
    }
  }

  // Signal level validation
  if (signalLevel !== null) {
    const range = SIGNAL_RANGES[sourceType];
    if (range) {
      if (signalLevel < range.min || signalLevel > range.max) {
        warnings.push(`signal level ${signalLevel} outside expected range for ${sourceType}`);
      }
    }
    // Impossible positive signal (>10 dBm is unrealistic for passive receivers)
    if (signalLevel > 10) {
      return { valid: false, warnings: [`impossible signal level: ${signalLevel}`] };
    }
  }

  // Error count validation
  if (errorCount !== null && errorCount > 100) {
    return { valid: false, warnings: [`extreme error count: ${errorCount}`] };
  }

  // Range plausibility
  if (distanceKm !== null && distanceKm > 0) {
    const maxRange = MAX_RANGE_KM[sourceType] ?? DEFAULT_MAX_RANGE_KM;
    // Allow 20% over max range for atmospheric conditions
    if (distanceKm > maxRange * 1.2) {
      return {
        valid: false,
        warnings: [`distance ${distanceKm.toFixed(0)} km exceeds max ${maxRange} km for ${sourceType}`],
      };
    }
  }

  return { valid: true, warnings };
}
