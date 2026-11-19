import type { TransportType } from './events.js';

/**
 * Aggregated data for a single H3 cell within one time-window slice.
 *
 * There can be millions of these in memory at once (one per cell, per slice,
 * per window), so the shape is flat numbers only. Sources and transport types
 * are bitmasks and the station list stays a plain number until a second
 * station reports the cell. Read them through the helpers in
 * aggregation/sliding-window.ts.
 */
export interface CellAggregation {
  messageCount: number;
  totalLevel: number;
  errorMessages: number;
  totalDistance: number;
  maxDistance: number;
  /** Bitmask of interned source type names */
  sources: number;
  /** One station id, or a set once several stations have reported the cell */
  stationIds: number | Set<number>;
  /** Bitmask of transport types */
  transportTypes: number;
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
  stationIds: number[];
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
  /**
   * For H3 cells only: this window keeps no cells of its own and is read from
   * the newest `viewSlices` slices of the named window. Sharing slices this way
   * stores each cell once for a group of windows instead of once per window.
   */
  viewOf?: string;
  viewSlices?: number;
}

/** Window configurations - oldest (1m) to newest (1mo) */
export const WINDOW_CONFIGS: WindowConfig[] = [
  { name: '1m',  windowMs: 60_000,           sliceMs: 5_000,        slices: 12 },
  { name: '5m',  windowMs: 5 * 60_000,       sliceMs: 15_000,       slices: 20 },
  { name: '30m', windowMs: 30 * 60_000,      sliceMs: 60_000,       slices: 30, viewOf: '1h',  viewSlices: 15 },
  { name: '1h',  windowMs: 60 * 60_000,      sliceMs: 120_000,      slices: 30 },
  { name: '6h',  windowMs: 6 * 3_600_000,    sliceMs: 720_000,      slices: 30, viewOf: '24h', viewSlices: 6 },
  { name: '12h', windowMs: 12 * 3_600_000,   sliceMs: 1_440_000,    slices: 30, viewOf: '24h', viewSlices: 12 },
  { name: '24h', windowMs: 24 * 3_600_000,   sliceMs: 3_600_000,    slices: 24 },
  { name: '1w',  windowMs: 7 * 86_400_000,   sliceMs: 14_400_000,   slices: 42, viewOf: '1mo', viewSlices: 7 },
  { name: '1mo', windowMs: 30 * 86_400_000,  sliceMs: 86_400_000,   slices: 30 },
];

/**
 * Which H3 resolutions are kept for which windows (index into WINDOW_CONFIGS).
 *
 * Every aircraft position lands in its own cell at fine resolutions, and a cell
 * is stored once per slice per window, so fine grids over long windows cost
 * memory fast: resolution 7 over an hour is hundreds of thousands of cells at
 * production volume. Fine resolutions are therefore kept only for short
 * windows, and windows of similar length share one set of slices (see
 * WindowConfig.viewOf). A request for a finer grid than a window keeps is answered with the
 * finest one it has (see finestResolutionFor).
 */
export const H3_RESOLUTION_CONFIGS = [
  { resolution: 2, maxWindowIndex: 8 },  // All windows
  { resolution: 3, maxWindowIndex: 8 },  // All windows
  { resolution: 4, maxWindowIndex: 6 },  // Up to 24h
  { resolution: 5, maxWindowIndex: 3 },  // Up to 1h
  { resolution: 6, maxWindowIndex: 1 },  // Up to 5m
  { resolution: 7, maxWindowIndex: 1 },  // Up to 5m
] as const;

/** The finest kept resolution for a window that is no finer than the one asked for */
export function finestResolutionFor(resolution: number, windowIndex: number): number {
  let best: number = H3_RESOLUTION_CONFIGS[0].resolution;
  for (const c of H3_RESOLUTION_CONFIGS) {
    if (c.resolution <= resolution && windowIndex <= c.maxWindowIndex && c.resolution > best) {
      best = c.resolution;
    }
  }
  return best;
}
