export type TransportType = 'aircraft' | 'marine' | 'sonde' | 'space' | 'all';

export interface CoverageHex {
  h3: string;
  msgCount: number;
  avgLevel: number | null;
  maxDistance: number;
  errorRate: number;
  confidence: number;
  sources: string[];
  stationCount: number;
  transportTypes: string[];
}

export interface CoveragePolygon {
  stationId: number;
  ident: string;
  coordinates: number[][][];
  confidence: number;
  messageCount: number;
  sourceType: string;
}

export interface Station {
  id: number;
  uuid: string;
  ident: string;
  latitude: number;
  longitude: number;
  sourceType: string;
  messageCount: number;
  messagesWithPosition: number;
  maxDistance: number;
  avgLevel: number | null;
  confidence: number;
  lastSeen: string;
}

export interface FlashPoint {
  longitude: number;
  latitude: number;
  timestamp: number;
  stationId: number;
}

export interface CoverageStats {
  messagesPerSecond: number;
  activeStations: number;
  totalCells: Record<string, number>;
  coverageAreaKm2: number;
  natsConnected: boolean;
}

export interface BearingSector {
  bearing: number;
  distance: number;
  msgCount: number;
  avgLevel: number | null;
}

export interface StationCoverageDetail {
  stationId: number;
  ident: string;
  position: { lat: number; lon: number };
  sourceType: string;
  window: string;
  messageCount: number;
  messagesWithPosition: number;
  avgLevel: number | null;
  errorRate: number;
  maxDistance: number;
  confidence: number;
  bearingSectors: BearingSector[];
  polygon: GeoJSONFeature | null;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: Record<string, unknown>;
}
