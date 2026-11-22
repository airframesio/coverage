import type { WindowConfig, StationCoverage } from '../types/coverage.js';
import type { TransportType } from '../types/events.js';

/** Per-station+transport sector data stored in one time slice */
interface StationSliceData {
  sectorMaxDist: Float64Array;
  sectorMsgCount: Uint32Array;
  sectorLevelSum: Float64Array;
  totalMessages: number;
  messagesWithPosition: number;
  totalLevelSum: number;
  levelCount: number;
  errorCount: number;
  transportType: TransportType;
}

function createEmptySliceData(transportType: TransportType): StationSliceData {
  return {
    sectorMaxDist: new Float64Array(36),
    sectorMsgCount: new Uint32Array(36),
    sectorLevelSum: new Float64Array(36),
    totalMessages: 0,
    messagesWithPosition: 0,
    totalLevelSum: 0,
    levelCount: 0,
    errorCount: 0,
    transportType,
  };
}

/** Composite key: stationId + transportType */
function sliceKey(stationId: number, transportType: TransportType): string {
  return `${stationId}:${transportType}`;
}

type Slice = Map<string, StationSliceData>;

/** One station's totals in one saved slice, as stored in a snapshot */
export interface SavedStationSliceEntry {
  stationId: number;
  transportType: TransportType;
  /** Left out when the station saw no direction in this slice */
  sectorMaxDist?: number[];
  sectorMsgCount?: number[];
  sectorLevelSum?: number[];
  totalMessages: number;
  messagesWithPosition: number;
  totalLevelSum: number;
  levelCount: number;
  errorCount: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const TRANSPORT_TYPES: TransportType[] = ['aircraft', 'marine', 'sonde', 'space'];

/** Running totals for one station while its slices are added up */
interface CoverageAccumulator {
  result: StationCoverage;
  totalLevelSum: number;
  levelCount: number;
  errorCount: number;
  sectorLevelSums: Float64Array;
}

function createAccumulator(stationId: number): CoverageAccumulator {
  return {
    result: {
      stationId,
      bearingSectors: new Float64Array(36),
      sectorMessageCounts: new Uint32Array(36),
      sectorAvgLevels: new Float64Array(36),
      totalMessages: 0,
      messagesWithPosition: 0,
      maxDistance: 0,
      avgLevel: 0,
      errorRate: 0,
      confidence: 0,
      lastUpdated: 0,
    },
    totalLevelSum: 0,
    levelCount: 0,
    errorCount: 0,
    sectorLevelSums: new Float64Array(36),
  };
}

function accumulate(acc: CoverageAccumulator, data: StationSliceData): void {
  const { result } = acc;
  result.totalMessages += data.totalMessages;
  result.messagesWithPosition += data.messagesWithPosition;
  acc.totalLevelSum += data.totalLevelSum;
  acc.levelCount += data.levelCount;
  acc.errorCount += data.errorCount;

  for (let i = 0; i < 36; i++) {
    if (data.sectorMaxDist[i] > result.bearingSectors[i]) {
      result.bearingSectors[i] = data.sectorMaxDist[i];
    }
    result.sectorMessageCounts[i] += data.sectorMsgCount[i];
    acc.sectorLevelSums[i] += data.sectorLevelSum[i];
    if (data.sectorMaxDist[i] > result.maxDistance) {
      result.maxDistance = data.sectorMaxDist[i];
    }
  }
}

/** Turn the totals into averages; null when the station had no traffic */
function finishCoverage(acc: CoverageAccumulator): StationCoverage | null {
  const { result } = acc;
  if (result.totalMessages === 0) return null;

  result.avgLevel = acc.levelCount > 0 ? acc.totalLevelSum / acc.levelCount : 0;
  result.errorRate = acc.errorCount / result.totalMessages;
  for (let i = 0; i < 36; i++) {
    if (result.sectorMessageCounts[i] > 0) {
      result.sectorAvgLevels[i] = acc.sectorLevelSums[i] / result.sectorMessageCounts[i];
    }
  }
  result.lastUpdated = Date.now();
  return result;
}

/**
 * Sliding window for per-station bearing sector data.
 * Data is keyed by stationId+transportType so coverage can be
 * filtered by transport type at query time.
 */
export class StationSlidingWindow {
  readonly config: WindowConfig;
  private slices: Slice[];
  private currentIndex: number;
  /** When each slice started taking data */
  private sliceStarts: number[];
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
    this.timer = setInterval(() => this.rotate(), config.sliceMs);
  }

  private rotate(): void {
    this.currentIndex = (this.currentIndex + 1) % this.config.slices;
    this.slices[this.currentIndex].clear();
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

  /** Record a reception event */
  record(
    stationId: number,
    sector: number,
    distance: number,
    signalLevel: number | null,
    hasPosition: boolean,
    hasError: boolean,
    transportType: TransportType = 'aircraft',
  ): void {
    const key = sliceKey(stationId, transportType);
    const slice = this.slices[this.currentIndex];
    let data = slice.get(key);
    if (!data) {
      data = createEmptySliceData(transportType);
      slice.set(key, data);
    }

    data.totalMessages++;

    if (hasPosition) data.messagesWithPosition++;

    // sector is -1 when the position says nothing about direction or range
    if (hasPosition && sector >= 0 && sector < 36) {
      if (distance > data.sectorMaxDist[sector]) {
        data.sectorMaxDist[sector] = distance;
      }
      data.sectorMsgCount[sector]++;
      if (signalLevel !== null) {
        data.sectorLevelSum[sector] += signalLevel;
      }
    }

    if (signalLevel !== null) {
      data.totalLevelSum += signalLevel;
      data.levelCount++;
    }

    if (hasError) {
      data.errorCount++;
    }
  }

  /**
   * Add saved totals for a station to the current slice in one step. Restoring
   * a snapshot must not cost one call per saved message: a busy day is tens of
   * millions of messages per window.
   */
  restore(stationId: number, transportType: TransportType, saved: {
    sectorMaxDist: ArrayLike<number>;
    sectorMsgCount: ArrayLike<number>;
    sectorAvgLevel?: ArrayLike<number>;
    totalMessages: number;
    messagesWithPosition: number;
    avgLevel: number | null;
    errorRate: number;
  }): void {
    const key = sliceKey(stationId, transportType);
    const slice = this.slices[this.currentIndex];
    let data = slice.get(key);
    if (!data) {
      data = createEmptySliceData(transportType);
      slice.set(key, data);
    }

    const total = Math.max(0, Math.floor(saved.totalMessages) || 0);
    data.totalMessages += total;
    data.messagesWithPosition += Math.min(total, Math.max(0, Math.floor(saved.messagesWithPosition) || 0));

    for (let i = 0; i < 36; i++) {
      const count = Math.max(0, Math.floor(saved.sectorMsgCount[i] ?? 0) || 0);
      const dist = saved.sectorMaxDist[i] ?? 0;
      if (dist > data.sectorMaxDist[i]) data.sectorMaxDist[i] = dist;
      data.sectorMsgCount[i] += count;
      data.sectorLevelSum[i] += (saved.sectorAvgLevel?.[i] ?? 0) * count;
    }

    if (saved.avgLevel !== null && Number.isFinite(saved.avgLevel)) {
      data.totalLevelSum += saved.avgLevel * total;
      data.levelCount += total;
    }
    data.errorCount += Math.round((saved.errorRate || 0) * total);
  }

  /** Every slice with data, newest first, in the form snapshots store */
  exportSlices(): { startedAt: number; current: boolean; entries: SavedStationSliceEntry[] }[] {
    return this.slicesByAge().map(({ startedAt, current, slice }) => ({
      startedAt,
      current,
      entries: Array.from(slice, ([key, d]): SavedStationSliceEntry => ({
        stationId: parseInt(key, 10),
        transportType: d.transportType,
        // Most entries never saw a direction (no positions, or a satellite
        // relay); leave their empty sector arrays out of the snapshot
        ...(d.sectorMsgCount.some(n => n > 0) || d.sectorMaxDist.some(n => n > 0)
          ? {
            sectorMaxDist: Array.from(d.sectorMaxDist, round1),
            sectorMsgCount: Array.from(d.sectorMsgCount),
            sectorLevelSum: Array.from(d.sectorLevelSum, round1),
          }
          : {}),
        totalMessages: d.totalMessages,
        messagesWithPosition: d.messagesWithPosition,
        totalLevelSum: round1(d.totalLevelSum),
        levelCount: d.levelCount,
        errorCount: d.errorCount,
      })),
    }));
  }

  /**
   * Put a saved slice back at its age. Returns whether it went into the
   * current slice, or null when it is older than the window.
   */
  importSlice(startedAt: number, entries: SavedStationSliceEntry[], now = Date.now()): boolean | null {
    const target = this.sliceFor(startedAt, now);
    if (!target) return null;
    for (const e of entries) {
      if (!Number.isInteger(e.stationId) || !TRANSPORT_TYPES.includes(e.transportType)) continue;
      const key = sliceKey(e.stationId, e.transportType);
      let data = target.slice.get(key);
      if (!data) {
        data = createEmptySliceData(e.transportType);
        target.slice.set(key, data);
      }
      data.totalMessages += e.totalMessages || 0;
      data.messagesWithPosition += e.messagesWithPosition || 0;
      data.totalLevelSum += e.totalLevelSum || 0;
      data.levelCount += e.levelCount || 0;
      data.errorCount += e.errorCount || 0;
      for (let i = 0; i < 36; i++) {
        const dist = e.sectorMaxDist?.[i] ?? 0;
        if (dist > data.sectorMaxDist[i]) data.sectorMaxDist[i] = dist;
        data.sectorMsgCount[i] += e.sectorMsgCount?.[i] ?? 0;
        data.sectorLevelSum[i] += e.sectorLevelSum?.[i] ?? 0;
      }
    }
    return target.current;
  }

  /**
   * Coverage of one station across all slices.
   * @param transportFilter - if set, only include data from matching transport types
   */
  getStationCoverage(stationId: number, transportFilter?: TransportType): StationCoverage | null {
    // Look the station's keys up directly. Scanning every entry of every slice
    // for one station made the station list cost stations x entries.
    const keys = (transportFilter ? [transportFilter] : TRANSPORT_TYPES)
      .map(transportType => sliceKey(stationId, transportType));
    const acc = createAccumulator(stationId);
    for (const slice of this.slices) {
      for (const key of keys) {
        const data = slice.get(key);
        if (data) accumulate(acc, data);
      }
    }
    return finishCoverage(acc);
  }

  /**
   * Coverage of every station with traffic, in one pass over the slices.
   * @param transportFilter - if set, only include data from matching transport types
   */
  allStationCoverage(transportFilter?: TransportType): StationCoverage[] {
    const byStation = new Map<number, CoverageAccumulator>();
    for (const slice of this.slices) {
      for (const [key, data] of slice) {
        if (transportFilter && data.transportType !== transportFilter) continue;
        const stationId = parseInt(key, 10);
        let acc = byStation.get(stationId);
        if (!acc) {
          acc = createAccumulator(stationId);
          byStation.set(stationId, acc);
        }
        accumulate(acc, data);
      }
    }
    const results: StationCoverage[] = [];
    for (const acc of byStation.values()) {
      const coverage = finishCoverage(acc);
      if (coverage) results.push(coverage);
    }
    return results;
  }

  /** Get all unique station IDs, optionally filtered by transport type */
  activeStationIds(transportFilter?: TransportType): Set<number> {
    const ids = new Set<number>();
    for (const slice of this.slices) {
      for (const [key, data] of slice) {
        if (transportFilter && data.transportType !== transportFilter) continue;
        const stationId = parseInt(key.split(':')[0], 10);
        ids.add(stationId);
      }
    }
    return ids;
  }

  /**
   * Forget a station's range and direction, keeping its message counts. Used
   * when the station turns out to be somewhere else: distances and bearings
   * measured from the old spot mean nothing.
   */
  clearSectors(stationId: number): void {
    const prefix = `${stationId}:`;
    for (const slice of this.slices) {
      for (const [key, data] of slice) {
        if (!key.startsWith(prefix)) continue;
        data.sectorMaxDist.fill(0);
        data.sectorMsgCount.fill(0);
        data.sectorLevelSum.fill(0);
      }
    }
  }

  /** Message total and furthest reception of one station, by key lookup */
  stationTotal(stationId: number): { totalMessages: number; maxDistance: number } | null {
    const keys = TRANSPORT_TYPES.map(transportType => sliceKey(stationId, transportType));
    let totalMessages = 0;
    let maxDistance = 0;
    for (const slice of this.slices) {
      for (const key of keys) {
        const data = slice.get(key);
        if (!data || data.totalMessages === 0) continue;
        totalMessages += data.totalMessages;
        for (let i = 0; i < 36; i++) {
          if (data.sectorMaxDist[i] > maxDistance) maxDistance = data.sectorMaxDist[i];
        }
      }
    }
    return totalMessages > 0 ? { totalMessages, maxDistance } : null;
  }

  /** Message total and furthest reception per station across all slices, in one pass */
  stationTotals(): Map<number, { totalMessages: number; maxDistance: number }> {
    const totals = new Map<number, { totalMessages: number; maxDistance: number }>();
    for (const slice of this.slices) {
      for (const [key, data] of slice) {
        if (data.totalMessages === 0) continue;
        const stationId = parseInt(key, 10);
        let entry = totals.get(stationId);
        if (!entry) {
          entry = { totalMessages: 0, maxDistance: 0 };
          totals.set(stationId, entry);
        }
        entry.totalMessages += data.totalMessages;
        for (let i = 0; i < 36; i++) {
          if (data.sectorMaxDist[i] > entry.maxDistance) entry.maxDistance = data.sectorMaxDist[i];
        }
      }
    }
    return totals;
  }

  /** Events recorded across all slices of this window */
  totalMessages(): number {
    let total = 0;
    for (const slice of this.slices) {
      for (const data of slice.values()) total += data.totalMessages;
    }
    return total;
  }

  destroy(): void {
    clearInterval(this.timer);
  }
}
