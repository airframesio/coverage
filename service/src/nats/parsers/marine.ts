import type {
  MarineVoyagePositionPayload,
  MarineAisMessagePayload,
  CoverageEvent,
} from '../../types/events.js';

/**
 * Parse a marine voyage position NATS event.
 * Voyage positions are the richest marine data — lat, lon, SOG, COG, heading.
 */
export function parseVoyagePosition(data: MarineVoyagePositionPayload): CoverageEvent | null {
  const station = data.station;
  const pos = data.voyagePosition;

  if (!station?.id || !station?.uuid) return null;

  let targetLat: number | null = null;
  let targetLon: number | null = null;

  if (pos?.latitude != null && pos?.longitude != null) {
    targetLat = pos.latitude;
    targetLon = pos.longitude;
  } else if (data.voyage?.last_latitude != null && data.voyage?.last_longitude != null) {
    targetLat = data.voyage.last_latitude;
    targetLon = data.voyage.last_longitude;
  }

  const hasTarget = targetLat !== null && targetLon !== null;

  return {
    stationId: station.id,
    stationUuid: station.uuid,
    targetLat,
    targetLon,
    targetAlt: null,
    transportType: 'marine',
    sourceType: station.source_type ?? data.source?.name ?? 'aiscatcher',
    source: data.source?.name ?? 'aiscatcher',
    frequency: null, // AIS is always on 161.975 / 162.025 MHz
    signalLevel: null,
    errorCount: null,
    timestamp: new Date(),
    hasTargetPosition: hasTarget,
    _natsStationLat: station.latitude,
    _natsStationLon: station.longitude,
  };
}

/**
 * Parse a marine voyage create/update event.
 */
export function parseVoyage(data: MarineVoyagePositionPayload): CoverageEvent | null {
  const station = data.station;
  const voyage = data.voyage;

  if (!station?.id || !station?.uuid) return null;

  const targetLat = voyage?.last_latitude ?? null;
  const targetLon = voyage?.last_longitude ?? null;
  const hasTarget = targetLat !== null && targetLon !== null;

  return {
    stationId: station.id,
    stationUuid: station.uuid,
    targetLat,
    targetLon,
    targetAlt: null,
    transportType: 'marine',
    sourceType: station.source_type ?? 'aiscatcher',
    source: data.source?.name ?? 'aiscatcher',
    frequency: null,
    signalLevel: null,
    errorCount: null,
    timestamp: new Date(),
    hasTargetPosition: hasTarget,
    _natsStationLat: station.latitude,
    _natsStationLon: station.longitude,
  };
}

/**
 * Parse a marine AIS message event (may not have vessel position,
 * but proves station is receiving AIS).
 */
export function parseAisMessage(data: MarineAisMessagePayload): CoverageEvent | null {
  const station = data.station;

  if (!station?.id || !station?.uuid) return null;

  return {
    stationId: station.id,
    stationUuid: station.uuid,
    targetLat: null,
    targetLon: null,
    targetAlt: null,
    transportType: 'marine',
    sourceType: station.source_type ?? 'aiscatcher',
    source: data.source?.name ?? 'aiscatcher',
    frequency: null,
    signalLevel: null,
    errorCount: null,
    timestamp: new Date(),
    hasTargetPosition: false,
    _natsStationLat: station.latitude,
    _natsStationLon: station.longitude,
  };
}
