import type { TransportType } from './events.js';

/** Aggregated data for a single H3 cell within one time-window slice */
export interface CellAggregation {
  messageCount: number;
  totalLevel: number;
  minLevel: number;
  maxLevel: number;
  totalError: number;
  errorMessages: number;
  totalDistance: number;
  maxDistance: number;
  frequencies: Map<number, number>;
  sources: Set<string>;
  stationIds: Set<number>;
  transportTypes: Set<TransportType>;
}

/** Serialized cell data for API responses */
export interface CellResponse {
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

/** Per-station directional coverage for one time window */
export interface StationCoverage {
  stationId: number;
  bearingSectors: Float64Array;       // 36 elements: max distance (km) per 10-degree sector
  sectorMessageCounts: Uint32Array;   // 36 elements: message count per sector
  sectorAvgLevels: Float64Array;      // 36 elements: average signal level per sector
  totalMessages: number;
  messagesWithPosition: number;
  maxDistance: number;
  avgLevel: number;
  errorRate: number;
  confidence: number;
  lastUpdated: number;
}

/** Station coverage API response */
export interface StationCoverageResponse {
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
  bearingSectors: Array<{
    bearing: number;
    distance: number;
    msgCount: number;
    avgLevel: number | null;
  }>;
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

/** Time window configuration */
export interface WindowConfig {
  name: string;
  windowMs: number;
  sliceMs: number;
  slices: number;
}

/** Window configurations - oldest (1m) to newest (1mo) */
export const WINDOW_CONFIGS: WindowConfig[] = [
  { name: '1m',  windowMs: 60_000,           sliceMs: 5_000,        slices: 12 },
  { name: '5m',  windowMs: 5 * 60_000,       sliceMs: 15_000,       slices: 20 },
  { name: '30m', windowMs: 30 * 60_000,      sliceMs: 60_000,       slices: 30 },
  { name: '1h',  windowMs: 60 * 60_000,      sliceMs: 120_000,      slices: 30 },
  { name: '6h',  windowMs: 6 * 3_600_000,    sliceMs: 720_000,      slices: 30 },
  { name: '12h', windowMs: 12 * 3_600_000,   sliceMs: 1_440_000,    slices: 30 },
  { name: '24h', windowMs: 24 * 3_600_000,   sliceMs: 2_880_000,    slices: 30 },
  { name: '1w',  windowMs: 7 * 86_400_000,   sliceMs: 14_400_000,   slices: 42 },
  { name: '1mo', windowMs: 30 * 86_400_000,  sliceMs: 86_400_000,   slices: 30 },
];

/** H3 resolution config: which resolutions are maintained for which windows */
export const H3_RESOLUTION_CONFIGS = [
  { resolution: 2, maxWindowIndex: 8 },  // All windows
  { resolution: 3, maxWindowIndex: 8 },  // All windows
  { resolution: 4, maxWindowIndex: 8 },  // All windows
  { resolution: 5, maxWindowIndex: 6 },  // Up to 24h
  { resolution: 6, maxWindowIndex: 4 },  // Up to 6h
  { resolution: 7, maxWindowIndex: 3 },  // Up to 1h
] as const;
