/** Transport-agnostic position event normalized from any NATS subject */
export interface CoverageEvent {
  // Who received it (station/receiver)
  stationId: number;
  stationUuid: string;

  // Target position (aircraft/vessel/etc), null if unknown
  targetLat: number | null;
  targetLon: number | null;
  targetAlt: number | null;

  // Reception metadata
  transportType: TransportType;
  sourceType: string;
  source: string;
  frequency: number | null;
  signalLevel: number | null;
  errorCount: number | null;
  timestamp: Date;

  // Whether we have a target position (for directional coverage)
  hasTargetPosition: boolean;

  // Station coordinates from NATS payload (NOT trusted in production,
  // but used for dev auto-registration when main API is unavailable)
  _natsStationLat?: number;
  _natsStationLon?: number;
}

export type TransportType = 'aircraft' | 'marine' | 'sonde' | 'space';

/** Station metadata synced from the main API */
export interface StationMeta {
  id: number;
  uuid: string;
  ident: string;
  /** Effective location: the registered one, or where the station is heard (see locationSource) */
  latitude: number;
  longitude: number;
  /** Location as the main API reports it */
  registeredLatitude?: number;
  registeredLongitude?: number;
  /** True when the owner entered the location; false when it is only a GeoIP guess */
  ownerLocated?: boolean;
  /** 'heard' when latitude/longitude were placed at the centre of what the station hears */
  locationSource?: 'registered' | 'heard';
  sourceType: string;
  status: string;
  flagged: boolean;
  blocked: boolean;
  trustScore: number;
  lastSyncedAt: Date;
}

/** Raw NATS payload shape for aircraft message events */
export interface AircraftMessagePayload {
  source?: {
    name?: string;
    application?: string;
    transmissionType?: string;
  };
  station?: {
    id?: number | string;
    uuid?: string;
    ident?: string;
    latitude?: number;
    longitude?: number;
    fuzzed_latitude?: number;
    fuzzed_longitude?: number;
    ip_address?: string;
    source_type?: string;
  };
  message?: {
    id?: number | string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    level?: number;
    error?: number;
    frequency?: number;
    timestamp?: string;
    created_at?: string;
    source?: string;
    source_type?: string;
  };
  airframe?: {
    id?: number | string;
    tail?: string;
  };
  flight?: {
    id?: number | string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    track?: number;
  };
  messageReport?: {
    id?: number | string;
  };
}
