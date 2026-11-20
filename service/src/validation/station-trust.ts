import { config } from '../config.js';
import type { StationMeta, CoverageEvent } from '../types/events.js';

export type TrustRejection =
  | 'unknown_station'
  | 'station_blocked'
  | 'station_status'
  | 'low_trust';

export interface TrustResult {
  trusted: boolean;
  reason?: TrustRejection;
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
    return { trusted: false, reason: 'unknown_station', stationLat: 0, stationLon: 0 };
  }

  if (station.blocked) {
    return { trusted: false, reason: 'station_blocked', stationLat: station.latitude, stationLon: station.longitude };
  }

  // `flagged` is deliberately not a reason to distrust a station. The main API
  // sets it for "Rate anomaly detected", which in practice marks the busiest
  // healthy receivers: in November 2026 that was 322 stations carrying close to
  // 80% of all aircraft events, including most Inmarsat stations. `blocked` is
  // the switch for keeping a station out of coverage.

  if (station.status === 'inactive' || station.status === 'secret') {
    return { trusted: false, reason: 'station_status', stationLat: station.latitude, stationLon: station.longitude };
  }

  if (station.trustScore < 0.1) {
    return { trusted: false, reason: 'low_trust', stationLat: station.latitude, stationLon: station.longitude };
  }

  // Station coordinates may be 0/null if GeoIP hasn't run — that's OK,
  // the ingest layer will fall back to NATS payload coords if available.
  return {
    trusted: true,
    stationLat: station.latitude ?? 0,
    stationLon: station.longitude ?? 0,
  };
}
