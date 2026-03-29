import { config } from '../config.js';
import type { StationMeta, CoverageEvent } from '../types/events.js';

export interface TrustResult {
  trusted: boolean;
  reason?: string;
  /** Station coordinates from our synced metadata (authoritative) */
  stationLat: number;
  stationLon: number;
}

/**
 * Validate a coverage event against our synced station metadata.
 * We NEVER trust coordinates from the NATS payload — only from our synced data.
 *
 * Exception: in dev mode with DEV_AUTO_TRUST_STATIONS=true, unknown stations
 * are auto-registered using coordinates from the NATS payload.
 * This is ONLY for local development when the main API is unavailable.
 */
export function checkStationTrust(
  event: CoverageEvent,
  stationMap: Map<number, StationMeta>,
): TrustResult {
  const station = stationMap.get(event.stationId);

  if (!station) {
    return { trusted: false, reason: 'unknown station', stationLat: 0, stationLon: 0 };
  }

  if (station.blocked) {
    return { trusted: false, reason: 'station blocked', stationLat: station.latitude, stationLon: station.longitude };
  }

  if (station.flagged) {
    return { trusted: false, reason: 'station flagged', stationLat: station.latitude, stationLon: station.longitude };
  }

  if (station.status === 'inactive' || station.status === 'secret') {
    return { trusted: false, reason: `station status: ${station.status}`, stationLat: station.latitude, stationLon: station.longitude };
  }

  if (station.trustScore < 0.1) {
    return { trusted: false, reason: `low trust score: ${station.trustScore}`, stationLat: station.latitude, stationLon: station.longitude };
  }

  if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) {
    return { trusted: false, reason: 'station has no valid coordinates', stationLat: 0, stationLon: 0 };
  }

  return {
    trusted: true,
    stationLat: station.latitude,
    stationLon: station.longitude,
  };
}
