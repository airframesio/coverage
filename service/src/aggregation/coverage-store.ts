import { SlidingWindow, createEmptyCell, mergeIntoCell } from './sliding-window.js';
import { indexPoint, shouldMaintainResolution } from '../compute/h3-indexer.js';
import { haversineDistance, bearing, bearingToSector } from '../compute/distance.js';
import { computeConfidence } from '../compute/signal-analysis.js';
import { validateCoordinate } from '../validation/coordinate-validator.js';
import { validateSignal } from '../validation/signal-validator.js';
import { checkStationTrust } from '../validation/station-trust.js';
import { RateLimiter } from '../validation/rate-limiter.js';
import { config } from '../config.js';
import { WINDOW_CONFIGS, H3_RESOLUTION_CONFIGS } from '../types/coverage.js';
import type { CellAggregation, CellResponse, StationCoverage, WindowConfig } from '../types/coverage.js';
import type { CoverageEvent, StationMeta, TransportType } from '../types/events.js';

/**
 * Main in-memory coverage data store.
 * Manages sliding windows at multiple H3 resolutions and per-station coverage.
 */
export class CoverageStore {
  /** windows[resolutionIdx][windowIdx] = SlidingWindow */
  private windows: SlidingWindow[][] = [];
  /** Per-station directional coverage: stationId -> windowName -> StationCoverage */
  private stationCoverage = new Map<number, Map<string, StationCoverage>>();
  /** Synced station metadata from main API */
  public stationMap = new Map<number, StationMeta>();
  /** Rate limiter */
  private rateLimiter = new RateLimiter();

  // Metrics
  public eventsProcessed = 0;
  public eventsRejected = 0;
  public eventsWithPosition = 0;
  public eventsWithoutPosition = 0;

  constructor() {
    // Initialize sliding windows for each resolution x window combination
    for (const resConfig of H3_RESOLUTION_CONFIGS) {
      const resWindows: SlidingWindow[] = [];
      for (let wi = 0; wi < WINDOW_CONFIGS.length; wi++) {
        if (shouldMaintainResolution(resConfig.resolution, wi)) {
          resWindows.push(new SlidingWindow(WINDOW_CONFIGS[wi]));
        } else {
          // Placeholder: won't be used but keeps indexing consistent
          resWindows.push(new SlidingWindow(WINDOW_CONFIGS[wi]));
        }
      }
      this.windows.push(resWindows);
    }
  }

  /**
   * Process a validated coverage event into all relevant windows.
   * This is the hot path — called for every NATS message.
   */
  ingest(event: CoverageEvent): void {
    // 1. Station trust check (uses synced metadata, not NATS payload)
    // In dev mode, auto-register unknown stations from NATS payload coordinates
    if (config.devAutoTrustStations && !this.stationMap.has(event.stationId)) {
      const nLat = event._natsStationLat;
      const nLon = event._natsStationLon;
      if (nLat != null && nLon != null && Number.isFinite(nLat) && Number.isFinite(nLon)) {
        this.stationMap.set(event.stationId, {
          id: event.stationId,
          uuid: event.stationUuid,
          ident: `dev-${event.stationId}`,
          latitude: nLat,
          longitude: nLon,
          sourceType: event.sourceType,
          status: 'active',
          flagged: false,
          blocked: false,
          trustScore: 0.5,
          lastSyncedAt: new Date(),
        });
      }
    }

    const trust = checkStationTrust(event, this.stationMap);
    if (!trust.trusted) {
      this.eventsRejected++;
      return;
    }

    // 2. Rate limiting
    if (!this.rateLimiter.check(event.stationId)) {
      this.eventsRejected++;
      return;
    }

    // 3. Use authoritative station coordinates from our synced data
    const stationLat = trust.stationLat;
    const stationLon = trust.stationLon;

    // 4. Validate target coordinates if present
    let distance = 0;
    let brng = 0;
    let hasValidTarget = false;

    if (event.hasTargetPosition && event.targetLat !== null && event.targetLon !== null) {
      const targetCheck = validateCoordinate(event.targetLat, event.targetLon);
      if (targetCheck.valid) {
        distance = haversineDistance(stationLat, stationLon, event.targetLat, event.targetLon);
        brng = bearing(stationLat, stationLon, event.targetLat, event.targetLon);

        // Signal validation includes range plausibility
        const sigCheck = validateSignal(
          event.sourceType,
          event.frequency,
          event.signalLevel,
          event.errorCount,
          distance,
        );
        if (!sigCheck.valid) {
          this.eventsRejected++;
          return;
        }

        hasValidTarget = true;
        this.eventsWithPosition++;
      }
    } else {
      this.eventsWithoutPosition++;
    }

    this.eventsProcessed++;

    // 5. Index into H3 cells (only if we have a valid target position)
    if (hasValidTarget && event.targetLat !== null && event.targetLon !== null) {
      const h3Cells = indexPoint(event.targetLat, event.targetLon);

      for (let ri = 0; ri < H3_RESOLUTION_CONFIGS.length; ri++) {
        const resolution = H3_RESOLUTION_CONFIGS[ri].resolution;
        const h3Index = h3Cells.get(resolution);
        if (!h3Index) continue;

        for (let wi = 0; wi < WINDOW_CONFIGS.length; wi++) {
          if (!shouldMaintainResolution(resolution, wi)) continue;

          const window = this.windows[ri][wi];
          const slice = window.current;

          let cell = slice.get(h3Index);
          if (!cell) {
            cell = createEmptyCell();
            slice.set(h3Index, cell);
          }

          mergeIntoCell(
            cell,
            distance,
            event.signalLevel,
            event.errorCount,
            event.frequency,
            event.sourceType,
            event.stationId,
            event.transportType,
          );
        }
      }
    }

    // 6. Update per-station directional coverage
    this.updateStationCoverage(event, stationLat, stationLon, distance, brng, hasValidTarget);
  }

  private updateStationCoverage(
    event: CoverageEvent,
    stationLat: number,
    stationLon: number,
    distance: number,
    brng: number,
    hasValidTarget: boolean,
  ): void {
    let stationWindows = this.stationCoverage.get(event.stationId);
    if (!stationWindows) {
      stationWindows = new Map();
      this.stationCoverage.set(event.stationId, stationWindows);
    }

    for (const wc of WINDOW_CONFIGS) {
      let cov = stationWindows.get(wc.name);
      if (!cov) {
        cov = {
          stationId: event.stationId,
          bearingSectors: new Float64Array(36),
          sectorMessageCounts: new Uint32Array(36),
          sectorAvgLevels: new Float64Array(36),
          totalMessages: 0,
          messagesWithPosition: 0,
          maxDistance: 0,
          avgLevel: 0,
          errorRate: 0,
          confidence: 0,
          lastUpdated: Date.now(),
        };
        stationWindows.set(wc.name, cov);
      }

      cov.totalMessages++;
      cov.lastUpdated = Date.now();

      if (hasValidTarget) {
        cov.messagesWithPosition++;
        if (distance > cov.maxDistance) cov.maxDistance = distance;

        const sector = bearingToSector(brng);
        if (distance > cov.bearingSectors[sector]) {
          cov.bearingSectors[sector] = distance;
        }
        cov.sectorMessageCounts[sector]++;

        if (event.signalLevel !== null) {
          // Running average
          const prevAvg = cov.sectorAvgLevels[sector];
          const count = cov.sectorMessageCounts[sector];
          cov.sectorAvgLevels[sector] = prevAvg + (event.signalLevel - prevAvg) / count;
        }
      }

      if (event.signalLevel !== null) {
        const prevAvg = cov.avgLevel;
        cov.avgLevel = prevAvg + (event.signalLevel - prevAvg) / cov.totalMessages;
      }

      if (event.errorCount !== null && event.errorCount > 0) {
        cov.errorRate = (cov.errorRate * (cov.totalMessages - 1) + 1) / cov.totalMessages;
      }
    }
  }

  /**
   * Get H3 cell data for a specific resolution and time window.
   * Optionally filter by transport type and bounding box.
   */
  getH3Data(
    resolution: number,
    windowName: string,
    opts?: {
      transportType?: TransportType;
      bounds?: { swLat: number; swLon: number; neLat: number; neLon: number };
      minConfidence?: number;
    },
  ): CellResponse[] {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === resolution);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return [];

    const window = this.windows[ri][wi];
    const aggregated = window.getAggregated();
    const results: CellResponse[] = [];

    for (const [h3, cell] of aggregated) {
      if (cell.messageCount === 0) continue;

      // Transport type filter
      if (opts?.transportType) {
        if (!cell.transportTypes.has(opts.transportType)) continue;
      }

      const confidence = computeConfidence(cell);

      // Min confidence filter
      if (opts?.minConfidence && confidence < opts.minConfidence) continue;

      results.push({
        h3,
        msgCount: cell.messageCount,
        avgLevel: cell.totalLevel !== 0 ? Math.round(cell.totalLevel / cell.messageCount * 10) / 10 : null,
        maxDistance: Math.round(cell.maxDistance * 10) / 10,
        errorRate: Math.round((cell.errorMessages / cell.messageCount) * 1000) / 1000,
        confidence,
        sources: Array.from(cell.sources),
        stationCount: cell.stationIds.size,
        transportTypes: Array.from(cell.transportTypes),
      });
    }

    return results;
  }

  /** Get station coverage data for a specific station and window */
  getStationCoverage(stationId: number, windowName: string): StationCoverage | null {
    return this.stationCoverage.get(stationId)?.get(windowName) ?? null;
  }

  /** Get all stations with coverage data for a given window */
  getAllStationCoverage(windowName: string): StationCoverage[] {
    const results: StationCoverage[] = [];
    for (const [, windows] of this.stationCoverage) {
      const cov = windows.get(windowName);
      if (cov && cov.totalMessages > 0) {
        results.push(cov);
      }
    }
    return results;
  }

  /** Get summary metrics */
  getStats(): {
    eventsProcessed: number;
    eventsRejected: number;
    eventsWithPosition: number;
    eventsWithoutPosition: number;
    stationsTracked: number;
    activeCells: Record<number, number>;
  } {
    const activeCells: Record<number, number> = {};
    for (let ri = 0; ri < H3_RESOLUTION_CONFIGS.length; ri++) {
      const res = H3_RESOLUTION_CONFIGS[ri].resolution;
      // Use the 1h window as representative
      const wi = 2;
      activeCells[res] = this.windows[ri][wi].activeCells();
    }

    return {
      eventsProcessed: this.eventsProcessed,
      eventsRejected: this.eventsRejected,
      eventsWithPosition: this.eventsWithPosition,
      eventsWithoutPosition: this.eventsWithoutPosition,
      stationsTracked: this.stationCoverage.size,
      activeCells,
    };
  }

  destroy(): void {
    for (const resWindows of this.windows) {
      for (const window of resWindows) {
        window.destroy();
      }
    }
    this.rateLimiter.destroy();
  }
}
