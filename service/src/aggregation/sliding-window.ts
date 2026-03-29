import type { CellAggregation, WindowConfig } from '../types/coverage.js';
import type { TransportType } from '../types/events.js';

/** Create a fresh empty cell aggregation */
export function createEmptyCell(): CellAggregation {
  return {
    messageCount: 0,
    totalLevel: 0,
    minLevel: Infinity,
    maxLevel: -Infinity,
    totalError: 0,
    errorMessages: 0,
    totalDistance: 0,
    maxDistance: 0,
    frequencies: new Map(),
    sources: new Set(),
    stationIds: new Set(),
    transportTypes: new Set(),
  };
}

/** Merge a data point into a cell aggregation */
export function mergeIntoCell(
  cell: CellAggregation,
  distance: number,
  signalLevel: number | null,
  errorCount: number | null,
  frequency: number | null,
  sourceType: string,
  stationId: number,
  transportType: TransportType,
): void {
  cell.messageCount++;
  cell.totalDistance += distance;
  if (distance > cell.maxDistance) cell.maxDistance = distance;

  if (signalLevel !== null) {
    cell.totalLevel += signalLevel;
    if (signalLevel < cell.minLevel) cell.minLevel = signalLevel;
    if (signalLevel > cell.maxLevel) cell.maxLevel = signalLevel;
  }

  if (errorCount !== null && errorCount > 0) {
    cell.totalError += errorCount;
    cell.errorMessages++;
  }

  if (frequency !== null && frequency > 0) {
    const freqKey = Math.round(frequency * 10) / 10; // round to 0.1 MHz
    cell.frequencies.set(freqKey, (cell.frequencies.get(freqKey) ?? 0) + 1);
  }

  cell.sources.add(sourceType);
  cell.stationIds.add(stationId);
  cell.transportTypes.add(transportType);
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
   * Get aggregated view across all slices.
   * This merges all active slices into a single map.
   */
  getAggregated(): Map<string, CellAggregation> {
    const result = new Map<string, CellAggregation>();

    for (const slice of this.slices) {
      for (const [h3, cell] of slice) {
        if (cell.messageCount === 0) continue;

        const existing = result.get(h3);
        if (!existing) {
          // Clone the cell
          result.set(h3, {
            messageCount: cell.messageCount,
            totalLevel: cell.totalLevel,
            minLevel: cell.minLevel,
            maxLevel: cell.maxLevel,
            totalError: cell.totalError,
            errorMessages: cell.errorMessages,
            totalDistance: cell.totalDistance,
            maxDistance: cell.maxDistance,
            frequencies: new Map(cell.frequencies),
            sources: new Set(cell.sources),
            stationIds: new Set(cell.stationIds),
            transportTypes: new Set(cell.transportTypes),
          });
        } else {
          // Merge into existing
          existing.messageCount += cell.messageCount;
          existing.totalLevel += cell.totalLevel;
          existing.minLevel = Math.min(existing.minLevel, cell.minLevel);
          existing.maxLevel = Math.max(existing.maxLevel, cell.maxLevel);
          existing.totalError += cell.totalError;
          existing.errorMessages += cell.errorMessages;
          existing.totalDistance += cell.totalDistance;
          existing.maxDistance = Math.max(existing.maxDistance, cell.maxDistance);
          for (const [freq, count] of cell.frequencies) {
            existing.frequencies.set(freq, (existing.frequencies.get(freq) ?? 0) + count);
          }
          for (const src of cell.sources) existing.sources.add(src);
          for (const sid of cell.stationIds) existing.stationIds.add(sid);
          for (const tt of cell.transportTypes) existing.transportTypes.add(tt);
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

  /** Number of unique cells with data */
  activeCells(): number {
    const seen = new Set<string>();
    for (const slice of this.slices) {
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
