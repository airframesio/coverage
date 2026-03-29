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

/**
 * Sliding window for per-station bearing sector data.
 * Data is keyed by stationId+transportType so coverage can be
 * filtered by transport type at query time.
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

  /**
   * Aggregate all slices into per-station coverage.
   * @param transportFilter - if set, only include data from matching transport types
   */
  getStationCoverage(stationId: number, transportFilter?: TransportType): StationCoverage | null {
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
      // Check all matching keys for this station
      for (const [key, data] of slice) {
        if (!key.startsWith(`${stationId}:`)) continue;
        if (transportFilter && data.transportType !== transportFilter) continue;

        result.totalMessages += data.totalMessages;
        result.messagesWithPosition += data.messagesWithPosition;
        totalLevelSum += data.totalLevelSum;
        levelCount += data.levelCount;
        errorCount += data.errorCount;

        for (let i = 0; i < 36; i++) {
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
    }

    if (result.totalMessages === 0) return null;

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

  destroy(): void {
    clearInterval(this.timer);
  }
}
