import type { CellAggregation, WindowConfig } from '../types/coverage.js';
import type { TransportType } from '../types/events.js';
import { sourceFamily, type SourceFamily } from '../compute/source-family.js';

const TRANSPORT_BITS: Record<TransportType, number> = {
  aircraft: 1,
  marine: 2,
  sonde: 4,
  space: 8,
};
const TRANSPORT_NAMES = Object.keys(TRANSPORT_BITS) as TransportType[];

/** Source type names seen so far. A name's position is its bit in a cell's mask. */
const sourceNames: string[] = [];
/** Radio family of each source bit, by bit position */
const sourceFamilies: SourceFamily[] = [];
const sourceBits = new Map<string, number>();
const MAX_SOURCE_BITS = 31;
const OTHER_SOURCE = 'other';

function sourceBit(sourceType: string): number {
  let bit = sourceBits.get(sourceType);
  if (bit === undefined) {
    // Bitwise operators work on 32 bits. Past 30 distinct names, share the last bit.
    const index = sourceNames.length < MAX_SOURCE_BITS - 1 ? sourceNames.length : MAX_SOURCE_BITS - 1;
    if (index === sourceNames.length) {
      sourceNames.push(index === MAX_SOURCE_BITS - 1 ? OTHER_SOURCE : sourceType);
      sourceFamilies.push(index === MAX_SOURCE_BITS - 1 ? 'unknown' : sourceFamily(sourceType));
    }
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

/**
 * Whether any source recorded in a cell belongs to one of `families`.
 * A cell keeps one set of totals for all its sources, so a filtered cell is
 * shown with the totals of every source that heard it.
 */
export function cellHasFamily(cell: CellAggregation, families: ReadonlySet<SourceFamily>): boolean {
  const mask = cell.sources;
  for (let i = 0; i < sourceFamilies.length; i++) {
    if (mask & (1 << i) && families.has(sourceFamilies[i])) return true;
  }
  return false;
}

/** Station ids recorded in a cell */
export function cellStationIds(cell: CellAggregation): number[] {
  if (typeof cell.stationIds === 'number') return cell.stationIds === 0 ? [] : [cell.stationIds];
  return Array.from(cell.stationIds.keys());
}

/** Messages one station contributed to a cell */
export function cellStationCount(cell: CellAggregation, stationId: number): number {
  const ids = cell.stationIds;
  if (typeof ids === 'number') return ids === stationId ? cell.messageCount : 0;
  return ids.get(stationId) ?? 0;
}

/**
 * Credit `count` of a cell's messages to a station. Call it after the cell's
 * messageCount already includes them: while only one station has reported the
 * cell, its count is the cell's own, and when a second one arrives everything
 * before belongs to the first.
 */
export function addCellStation(cell: CellAggregation, stationId: number, count = 1): void {
  const current = cell.stationIds;
  if (typeof current === 'number') {
    if (current === 0) cell.stationIds = stationId;
    else if (current !== stationId) {
      cell.stationIds = new Map([[current, Math.max(0, cell.messageCount - count)], [stationId, count]]);
    }
  } else {
    current.set(stationId, (current.get(stationId) ?? 0) + count);
  }
}

/** [station id, messages] for every station that reported a cell */
function stationEntries(cell: CellAggregation): [number, number][] {
  const ids = cell.stationIds;
  if (typeof ids === 'number') return ids === 0 ? [] : [[ids, cell.messageCount]];
  return Array.from(ids);
}

/**
 * Add the stations of `source` to `target`, whose messageCount already
 * includes the source's messages. `targetBefore` is target's count before.
 */
export function mergeCellStations(target: CellAggregation, targetBefore: number, source: CellAggregation): void {
  const entries = stationEntries(source);
  if (entries.length === 0) return;
  let ids = target.stationIds;
  if (typeof ids === 'number') {
    if (ids === 0 && entries.length === 1) {
      target.stationIds = entries[0][0];
      return;
    }
    if (entries.length === 1 && entries[0][0] === ids) return;
    const map = new Map<number, number>();
    if (ids !== 0) map.set(ids, targetBefore);
    target.stationIds = ids = map;
  }
  for (const [sid, n] of entries) ids.set(sid, (ids.get(sid) ?? 0) + n);
}

/**
 * Set a restored cell's stations. `counts` are each station's messages (from
 * snapshots that saved them); without them the cell's messages are shared
 * out evenly.
 */
export function setCellStations(cell: CellAggregation, stationIds: number[], counts?: number[]): void {
  const ids = stationIds.filter(id => Number.isInteger(id) && id !== 0);
  if (ids.length === 0) return;
  if (ids.length === 1) {
    cell.stationIds = ids[0];
    return;
  }
  const map = new Map<number, number>();
  const even = Math.floor(cell.messageCount / ids.length);
  const useCounts = counts && counts.length === stationIds.length;
  stationIds.forEach((id, i) => {
    if (!Number.isInteger(id) || id === 0) return;
    const n = useCounts ? Math.max(0, Math.floor(counts![i]) || 0) : even;
    map.set(id, (map.get(id) ?? 0) + n);
  });
  cell.stationIds = map;
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
  hasPosition = true,
): void {
  cell.messageCount++;
  cell.totalDistance += distance;
  if (distance > cell.maxDistance) cell.maxDistance = distance;

  if (signalLevel !== null) cell.totalLevel += signalLevel;
  if (errorCount !== null && errorCount > 0) cell.errorMessages++;

  addCellSource(cell, sourceType);
  addCellStation(cell, stationId);
  if (!hasPosition) addCellPositionless(cell, stationId);
  addCellTransport(cell, transportType);
}

/** Count one of a station's messages without a position in a cell */
export function addCellPositionless(cell: CellAggregation, stationId: number, count = 1): void {
  if (!cell.positionless) cell.positionless = new Map();
  cell.positionless.set(stationId, (cell.positionless.get(stationId) ?? 0) + count);
}

/** A station's messages in a cell that came with a position */
export function cellStationPositioned(cell: CellAggregation, stationId: number): number {
  const n = cellStationCount(cell, stationId);
  if (n === 0 || !cell.positionless) return n;
  return Math.max(0, n - (cell.positionless.get(stationId) ?? 0));
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
  /** When each slice started taking data */
  private sliceStarts: number[];
  /**
   * Slices restored from snapshots saved before positionless messages were
   * counted per cell: their own-station cells mix both kinds
   */
  private positionlessUnknown = new WeakSet<Slice>();
  private timer: ReturnType<typeof setInterval>;

  constructor(config: WindowConfig) {
    this.config = config;
    this.slices = [];
    for (let i = 0; i < config.slices; i++) {
      this.slices.push(new Map());
    }
    this.currentIndex = 0;
    this.sliceStarts = new Array<number>(config.slices).fill(0);
    this.sliceStarts[0] = Date.now();

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
    this.positionlessUnknown.delete(this.slices[this.currentIndex]);
    this.sliceStarts[this.currentIndex] = Date.now();
  }

  /**
   * Slices that hold data, newest first, with the time each one started.
   * Snapshots are saved per slice so a restart puts each slice back at its age.
   */
  slicesByAge(): { startedAt: number; current: boolean; slice: Slice }[] {
    const out: { startedAt: number; current: boolean; slice: Slice }[] = [];
    const total = this.config.slices;
    for (let n = 0; n < total; n++) {
      const index = (this.currentIndex - n + total) % total;
      if (this.slices[index].size === 0) continue;
      out.push({ startedAt: this.sliceStarts[index], current: n === 0, slice: this.slices[index] });
    }
    return out;
  }

  /**
   * The slice a saved slice that started at `startedAt` belongs in, by age, or
   * null when it has left the window. The slice takes over the saved start
   * time, so the next save of it replaces the same snapshot row.
   */
  sliceFor(startedAt: number, now = Date.now()): { slice: Slice; current: boolean } | null {
    const age = Math.max(0, Math.floor((now - startedAt) / this.config.sliceMs));
    if (age >= this.config.slices) return null;
    const index = (this.currentIndex - age + this.config.slices) % this.config.slices;
    this.sliceStarts[index] = startedAt;
    return { slice: this.slices[index], current: age === 0 };
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
            stationIds: typeof cell.stationIds === 'number' ? cell.stationIds : new Map(cell.stationIds),
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
          mergeCellStations(existing, existing.messageCount - cell.messageCount, cell);
        }
      }
    }

    return result;
  }

  /**
   * Visit every cell of every slice, or of only the newest `newestSlices`,
   * without merging them. Cheaper than getAggregated when only a few cells
   * matter (one station's density).
   */
  forEachCell(
    fn: (h3: string, cell: CellAggregation, positionlessUnknown: boolean) => void, newestSlices?: number,
  ): void {
    const total = this.config.slices;
    const count = Math.min(newestSlices ?? total, total);
    for (let n = 0; n < count; n++) {
      const slice = this.slices[(this.currentIndex - n + total) % total];
      const unknown = this.positionlessUnknown.has(slice);
      for (const [h3, cell] of slice) fn(h3, cell, unknown);
    }
  }

  /** Mark a slice as restored without positionless counts (see positionlessUnknown) */
  markPositionlessUnknown(slice: Slice): void {
    this.positionlessUnknown.add(slice);
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
