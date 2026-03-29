import type { WindowConfig, StationCoverage } from '../types/coverage.js';

/** Per-station sector data stored in one time slice */
interface StationSliceData {
  /** Max distance per 10-degree sector (36 sectors) */
  sectorMaxDist: Float64Array;
  /** Message count per sector */
  sectorMsgCount: Uint32Array;
  /** Sum of signal levels per sector (for averaging) */
  sectorLevelSum: Float64Array;
  /** Total messages (with and without position) */
  totalMessages: number;
  /** Messages that had target position */
  messagesWithPosition: number;
  /** Sum of signal levels for overall average */
  totalLevelSum: number;
  /** Count of messages with signal level data */
  levelCount: number;
  /** Count of messages with errors */
  errorCount: number;
}

function createEmptySliceData(): StationSliceData {
  return {
    sectorMaxDist: new Float64Array(36),
    sectorMsgCount: new Uint32Array(36),
    sectorLevelSum: new Float64Array(36),
    totalMessages: 0,
    messagesWithPosition: 0,
    totalLevelSum: 0,
    levelCount: 0,
    errorCount: 0,
  };
}

type Slice = Map<number, StationSliceData>; // stationId -> data

/**
 * Sliding window for per-station bearing sector data.
 * Each slice stores sector data for all stations active in that period.
 * Aggregation across slices computes the window-scoped StationCoverage.
 */
export class StationSlidingWindow {
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
    this.timer = setInterval(() => this.rotate(), config.sliceMs);
  }

  private rotate(): void {
    this.currentIndex = (this.currentIndex + 1) % this.config.slices;
    this.slices[this.currentIndex].clear();
  }

  /** Record a reception event for a station in the current slice */
  record(
    stationId: number,
    sector: number,
    distance: number,
    signalLevel: number | null,
    hasPosition: boolean,
    hasError: boolean,
  ): void {
    const slice = this.slices[this.currentIndex];
    let data = slice.get(stationId);
    if (!data) {
      data = createEmptySliceData();
      slice.set(stationId, data);
    }

    data.totalMessages++;

    if (hasPosition && sector >= 0 && sector < 36) {
      data.messagesWithPosition++;
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

  /** Aggregate all slices into per-station coverage for the full window */
  getStationCoverage(stationId: number): StationCoverage | null {
    const result: StationCoverage = {
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
    };

    let totalLevelSum = 0;
    let levelCount = 0;
    let errorCount = 0;
    const sectorLevelSums = new Float64Array(36);

    for (const slice of this.slices) {
      const data = slice.get(stationId);
      if (!data) continue;

      result.totalMessages += data.totalMessages;
      result.messagesWithPosition += data.messagesWithPosition;
      totalLevelSum += data.totalLevelSum;
      levelCount += data.levelCount;
      errorCount += data.errorCount;

      for (let i = 0; i < 36; i++) {
        // Max distance across all slices per sector
        if (data.sectorMaxDist[i] > result.bearingSectors[i]) {
          result.bearingSectors[i] = data.sectorMaxDist[i];
        }
        result.sectorMessageCounts[i] += data.sectorMsgCount[i];
        sectorLevelSums[i] += data.sectorLevelSum[i];

        if (data.sectorMaxDist[i] > result.maxDistance) {
          result.maxDistance = data.sectorMaxDist[i];
        }
      }
    }

    if (result.totalMessages === 0) return null;

    // Compute averages
    result.avgLevel = levelCount > 0 ? totalLevelSum / levelCount : 0;
    result.errorRate = result.totalMessages > 0 ? errorCount / result.totalMessages : 0;

    for (let i = 0; i < 36; i++) {
      if (result.sectorMessageCounts[i] > 0) {
        result.sectorAvgLevels[i] = sectorLevelSums[i] / result.sectorMessageCounts[i];
      }
    }

    result.lastUpdated = Date.now();
    return result;
  }

  /** Get all station IDs that have data in this window */
  activeStationIds(): Set<number> {
    const ids = new Set<number>();
    for (const slice of this.slices) {
      for (const id of slice.keys()) {
        ids.add(id);
      }
    }
    return ids;
  }

  destroy(): void {
    clearInterval(this.timer);
  }
}
