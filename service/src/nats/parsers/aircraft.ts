import type { AircraftMessagePayload, CoverageEvent } from '../../types/events.js';
import { toStationId } from './station-id.js';

interface Position {
  lat: number;
  lon: number;
  alt: number | null;
}

/**
 * A usable position from a payload entity, or null.
 * The aggregation server stores "no position" as latitude 0 / longitude 0
 * rather than null, so 0/0 means absent, as do non-numbers and out-of-range values.
 */
export function readPosition(
  entity: { latitude?: unknown; longitude?: unknown; altitude?: unknown } | null | undefined,
): Position | null {
  if (!entity) return null;
  const lat = toNumber(entity.latitude);
  const lon = toNumber(entity.longitude);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon, alt: toNumber(entity.altitude) };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse an aircraft message NATS event into a CoverageEvent.
 * Handles both message.created and report.created subjects.
 * Aircraft position comes from the message, or else from its flight.
 */
export function parseAircraftMessage(data: AircraftMessagePayload): CoverageEvent | null {
  const station = data.station;
  const message = data.message;

  const stationId = toStationId(station?.id);
  if (stationId === null || !station?.uuid) return null;

  const position = readPosition(message) ?? readPosition(data.flight);

  return {
    stationId,
    stationUuid: station.uuid,
    targetLat: position?.lat ?? null,
    targetLon: position?.lon ?? null,
    targetAlt: position?.alt ?? null,
    transportType: 'aircraft',
    sourceType: message?.source_type ?? station.source_type ?? data.source?.name ?? 'unknown',
    source: data.source?.name ?? 'unknown',
    frequency: toNumber(message?.frequency),
    signalLevel: toNumber(message?.level),
    errorCount: toNumber(message?.error),
    timestamp: message?.timestamp ? new Date(message.timestamp) : new Date(),
    hasTargetPosition: position !== null,
    _natsStationLat: station.latitude ?? station.fuzzed_latitude,
    _natsStationLon: station.longitude ?? station.fuzzed_longitude,
  };
}

/**
 * Parse a message.created event.
 *
 * The aggregation server publishes every received message twice with the same
 * payload: once as message.created and, when it has a station report, again as
 * report.created. The report event is the one to count, so a message.created
 * that carries a report is skipped here.
 */
export function parseAircraftMessageCreated(data: AircraftMessagePayload): CoverageEvent | null {
  if (data.station && data.messageReport?.id != null) return null;
  return parseAircraftMessage(data);
}

/**
 * Parse an aircraft flight update NATS event.
 * Flight updates often have richer position data than messages.
 */
export function parseAircraftFlight(data: AircraftMessagePayload): CoverageEvent | null {
  const station = data.station;

  const stationId = toStationId(station?.id);
  if (stationId === null || !station?.uuid) return null;

  const position = readPosition(data.flight);
  if (!position) return null;

  return {
    stationId,
    stationUuid: station.uuid,
    targetLat: position.lat,
    targetLon: position.lon,
    targetAlt: position.alt,
    transportType: 'aircraft',
    sourceType: station.source_type ?? data.source?.name ?? 'unknown',
    source: data.source?.name ?? 'unknown',
    frequency: null,
    signalLevel: null,
    errorCount: null,
    timestamp: new Date(),
    hasTargetPosition: true,
    _natsStationLat: station.latitude ?? station.fuzzed_latitude,
    _natsStationLon: station.longitude ?? station.fuzzed_longitude,
  };
}
