import type { CellAggregation, WindowConfig } from '../types/coverage.js';
import type { TransportType } from '../types/events.js';

const TRANSPORT_BITS: Record<TransportType, number> = {
  aircraft: 1,
  marine: 2,
  sonde: 4,
  space: 8,
};
const TRANSPORT_NAMES = Object.keys(TRANSPORT_BITS) as TransportType[];

/** Source type names seen so far. A name's position is its bit in a cell's mask. */
const sourceNames: string[] = [];
const sourceBits = new Map<string, number>();
const MAX_SOURCE_BITS = 31;
const OTHER_SOURCE = 'other';

function sourceBit(sourceType: string): number {
  let bit = sourceBits.get(sourceType);
  if (bit === undefined) {
    // Bitwise operators work on 32 bits. Past 30 distinct names, share the last bit.
    const index = sourceNames.length < MAX_SOURCE_BITS - 1 ? sourceNames.length : MAX_SOURCE_BITS - 1;
    if (index === sourceNames.length) sourceNames.push(index === MAX_SOURCE_BITS - 1 ? OTHER_SOURCE : sourceType);
    bit = 1 << index;
    sourceBits.set(sourceType, bit);
  }
  return bit;
}

/** Create a fresh empty cell aggregation */
export function createEmptyCell(): CellAggregation {
  return {
    messageCount: 0,
    totalLevel: 0,
    errorMessages: 0,
    totalDistance: 0,
    maxDistance: 0,
    sources: 0,
    primarySource: 0,
    stationIds: 0,
    transportTypes: 0,
  };
}

/** Source type names recorded in a cell, the first one recorded first */
export function cellSources(cell: CellAggregation): string[] {
  const names: string[] = [];
  const primary = cell.primarySource - 1;
  if (primary >= 0 && primary < sourceNames.length) names.push(sourceNames[primary]);
  for (let i = 0; i < sourceNames.length; i++) {
    if (i !== primary && cell.sources & (1 << i)) names.push(sourceNames[i]);
  }
  return names;
}

/** The source first recorded for a cell, or '' for an empty cell */
export function cellPrimarySource(cell: CellAggregation): string {
  return sourceNames[cell.primarySource - 1] ?? '';
}

export function addCellSource(cell: CellAggregation, sourceType: string): void {
  const bit = sourceBit(sourceType);
  cell.sources |= bit;
  if (cell.primarySource === 0) cell.primarySource = 32 - Math.clz32(bit);
}

/** Station ids recorded in a cell */
export function cellStationIds(cell: CellAggregation): number[] {
  if (typeof cell.stationIds === 'number') return cell.stationIds === 0 ? [] : [cell.stationIds];
  return Array.from(cell.stationIds);
}

export function addCellStation(cell: CellAggregation, stationId: number): void {
  const current = cell.stationIds;
  if (typeof current === 'number') {
    if (current === 0) cell.stationIds = stationId;
    else if (current !== stationId) cell.stationIds = new Set([current, stationId]);
  } else {
    current.add(stationId);
  }
}

/** Transport types recorded in a cell */
export function cellTransportTypes(cell: CellAggregation): TransportType[] {
  return TRANSPORT_NAMES.filter(name => cell.transportTypes & TRANSPORT_BITS[name]);
}

export function cellHasTransport(cell: CellAggregation, transportType: TransportType): boolean {
  return (cell.transportTypes & TRANSPORT_BITS[transportType]) !== 0;
}

export function addCellTransport(cell: CellAggregation, transportType: TransportType): void {
  cell.transportTypes |= TRANSPORT_BITS[transportType] ?? 0;
}

/** Merge a data point into a cell aggregation */
export function mergeIntoCell(
  cell: CellAggregation,
  distance: number,
  signalLevel: number | null,
  errorCount: number | null,
  sourceType: string,
  stationId: number,
  transportType: TransportType,
): void {
  cell.messageCount++;
  cell.totalDistance += distance;
  if (distance > cell.maxDistance) cell.maxDistance = distance;

  if (signalLevel !== null) cell.totalLevel += signalLevel;
  if (errorCount !== null && errorCount > 0) cell.errorMessages++;

  addCellSource(cell, sourceType);
  addCellStation(cell, stationId);
  addCellTransport(cell, transportType);
}

/** A single time slice within a sliding window */
type Slice = Map<string, CellAggregation>; // h3Index -> aggregation

/**
 * Sliding window backed by a circular buffer of slices.
 * Each slice represents a fixed time interval. When the current slice expires,
 * the buffer pointer advances, effectively dropping the oldest data.
 */
export class SlidingWindow {
  readonly config: WindowConfig;
  private slices: Slice[];
  private currentIndex: number;
  private timer: ReturnType<typeof setInterval>;

  constructor(config: WindowConfig) {
    this.config = config;
    this.slices = [];
    for (let i = 0; i < config.slices; i++) {
      this.slices.push(new Map());
    }
    this.currentIndex = 0;

    // Rotate to next slice on interval
    this.timer = setInterval(() => this.rotate(), config.sliceMs);
  }

  /** Get the current active slice to write into */
  get current(): Slice {
    return this.slices[this.currentIndex];
  }

  /** Advance to the next slice, clearing it (drops oldest data) */
  private rotate(): void {
    this.currentIndex = (this.currentIndex + 1) % this.config.slices;
    this.slices[this.currentIndex].clear();
  }

  /**
   * Get aggregated view across all slices, or only the newest `newestSlices`.
   * This merges the slices into a single map.
   */
  getAggregated(newestSlices?: number): Map<string, CellAggregation> {
    const result = new Map<string, CellAggregation>();
    const total = this.config.slices;
    const count = Math.min(newestSlices ?? total, total);

    for (let n = 0; n < count; n++) {
      const slice = this.slices[(this.currentIndex - n + total) % total];
      for (const [h3, cell] of slice) {
        if (cell.messageCount === 0) continue;

        const existing = result.get(h3);
        if (!existing) {
          // Clone the cell
          result.set(h3, {
            ...cell,
            stationIds: typeof cell.stationIds === 'number' ? cell.stationIds : new Set(cell.stationIds),
          });
        } else {
          // Merge into existing
          existing.messageCount += cell.messageCount;
          existing.totalLevel += cell.totalLevel;
          existing.errorMessages += cell.errorMessages;
          existing.totalDistance += cell.totalDistance;
          existing.maxDistance = Math.max(existing.maxDistance, cell.maxDistance);
          existing.sources |= cell.sources;
          // Slices are read newest first, so an older slice holds the earlier source
          if (cell.primarySource !== 0) existing.primarySource = cell.primarySource;
          existing.transportTypes |= cell.transportTypes;
          if (typeof cell.stationIds === 'number') {
            if (cell.stationIds !== 0) addCellStation(existing, cell.stationIds);
          } else {
            for (const sid of cell.stationIds) addCellStation(existing, sid);
          }
        }
      }
    }

    return result;
  }

  /** Total message count across all slices */
  totalMessages(): number {
    let total = 0;
    for (const slice of this.slices) {
      for (const cell of slice.values()) {
        total += cell.messageCount;
      }
    }
    return total;
  }

  /** Cell records held across all slices (a cell active in several slices counts each time) */
  storedCells(): number {
    let total = 0;
    for (const slice of this.slices) total += slice.size;
    return total;
  }

  /** Number of unique cells with data */
  activeCells(newestSlices?: number): number {
    const seen = new Set<string>();
    const total = this.config.slices;
    const count = Math.min(newestSlices ?? total, total);
    for (let n = 0; n < count; n++) {
      const slice = this.slices[(this.currentIndex - n + total) % total];
      for (const h3 of slice.keys()) {
        seen.add(h3);
      }
    }
    return seen.size;
  }

  destroy(): void {
    clearInterval(this.timer);
  }
}
