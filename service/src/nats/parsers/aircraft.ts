import type { AircraftMessagePayload, CoverageEvent } from '../../types/events.js';

/**
 * Parse an aircraft message NATS event into a CoverageEvent.
 * Handles both message.created and report.created subjects.
 * Aircraft position comes from: message lat/lon, or flight lat/lon.
 */
export function parseAircraftMessage(data: AircraftMessagePayload): CoverageEvent | null {
  const station = data.station;
  const message = data.message;

  if (!station?.id || !station?.uuid) return null;

  // Try to get target position from message first, then flight
  let targetLat: number | null = null;
  let targetLon: number | null = null;
  let targetAlt: number | null = null;

  if (message?.latitude != null && message?.longitude != null) {
    targetLat = message.latitude;
    targetLon = message.longitude;
    targetAlt = message.altitude ?? null;
  } else if (data.flight?.latitude != null && data.flight?.longitude != null) {
    targetLat = data.flight.latitude;
    targetLon = data.flight.longitude;
    targetAlt = data.flight.altitude ?? null;
  }

  const hasTarget = targetLat !== null && targetLon !== null;

  return {
    stationId: station.id,
    stationUuid: station.uuid,
    targetLat,
    targetLon,
    targetAlt,
    transportType: 'aircraft',
    sourceType: message?.source_type ?? station.source_type ?? data.source?.name ?? 'unknown',
    source: data.source?.name ?? 'unknown',
    frequency: message?.frequency ?? null,
    signalLevel: message?.level ?? null,
    errorCount: message?.error ?? null,
    timestamp: message?.timestamp ? new Date(message.timestamp) : new Date(),
    hasTargetPosition: hasTarget,
    _natsStationLat: station.latitude ?? station.fuzzed_latitude,
    _natsStationLon: station.longitude ?? station.fuzzed_longitude,
  };
}

/**
 * Parse an aircraft flight update NATS event.
 * Flight updates often have richer position data than messages.
 */
export function parseAircraftFlight(data: AircraftMessagePayload): CoverageEvent | null {
  const station = data.station;
  const flight = data.flight;

  if (!station?.id || !station?.uuid) return null;
  if (!flight?.latitude || !flight?.longitude) return null;

  return {
    stationId: station.id,
    stationUuid: station.uuid,
    targetLat: flight.latitude,
    targetLon: flight.longitude,
    targetAlt: flight.altitude ?? null,
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
