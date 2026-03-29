import { SlidingWindow, createEmptyCell, mergeIntoCell } from './sliding-window.js';
import { StationSlidingWindow } from './station-window.js';
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
  /** Per-station directional coverage with sliding windows: one per window config */
  private stationWindows: StationSlidingWindow[] = [];
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

    // Initialize station sliding windows (one per time window config)
    for (const wc of WINDOW_CONFIGS) {
      this.stationWindows.push(new StationSlidingWindow(wc));
    }
  }

  /**
   * Process a validated coverage event into all relevant windows.
   * This is the hot path — called for every NATS message.
   */
  ingest(event: CoverageEvent): void {
    // 1. Station trust check (uses synced metadata, not NATS payload)
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

    // 3. Determine station coordinates
    // Prefer authoritative (synced from main API), fall back to NATS payload
    // when the synced station has no coordinates (common when GeoIP isn't populated)
    let stationLat = trust.stationLat;
    let stationLon = trust.stationLon;

    const stationHasCoords = Number.isFinite(stationLat) && Number.isFinite(stationLon)
      && !(Math.abs(stationLat) < 0.01 && Math.abs(stationLon) < 0.01);

    if (!stationHasCoords && event._natsStationLat != null && event._natsStationLon != null) {
      const nLat = event._natsStationLat;
      const nLon = event._natsStationLon;
      const nCheck = validateCoordinate(nLat, nLon);
      if (nCheck.valid) {
        stationLat = nLat;
        stationLon = nLon;
        // Update synced metadata so future events use these coords
        const meta = this.stationMap.get(event.stationId);
        if (meta) {
          meta.latitude = nLat;
          meta.longitude = nLon;
        }
      }
    }

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

    // 5. Index into H3 cells
    // If we have a target position, index at the target (aircraft/vessel) location.
    // If not, index at the station location — receiving a message proves coverage there.
    const indexLat = hasValidTarget && event.targetLat !== null ? event.targetLat : stationLat;
    const indexLon = hasValidTarget && event.targetLon !== null ? event.targetLon : stationLon;

    // Skip if we still have no usable coordinates
    if (indexLat === 0 && indexLon === 0) {
      this.updateStationCoverage(event, stationLat, stationLon, distance, brng, hasValidTarget);
      return;
    }

    {
      const h3Cells = indexPoint(indexLat, indexLon);

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
    _stationLat: number,
    _stationLon: number,
    distance: number,
    brng: number,
    hasValidTarget: boolean,
  ): void {
    const sector = hasValidTarget ? bearingToSector(brng) : -1;
    const hasError = event.errorCount !== null && event.errorCount > 0;

    for (const sw of this.stationWindows) {
      sw.record(
        event.stationId,
        sector,
        distance,
        event.signalLevel,
        hasValidTarget,
        hasError,
      );
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
        stationIds: Array.from(cell.stationIds),
        transportTypes: Array.from(cell.transportTypes),
      });
    }

    return results;
  }

  /** Get station coverage data for a specific station and window (sliding window scoped) */
  getStationCoverage(stationId: number, windowName: string): StationCoverage | null {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return null;
    return this.stationWindows[wi].getStationCoverage(stationId);
  }

  /** Get all stations with coverage data for a given window */
  getAllStationCoverage(windowName: string): StationCoverage[] {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return [];
    const sw = this.stationWindows[wi];
    const results: StationCoverage[] = [];
    for (const id of sw.activeStationIds()) {
      const cov = sw.getStationCoverage(id);
      if (cov && cov.totalMessages > 0) results.push(cov);
    }
    return results;
  }

  /**
   * Get per-station message counts derived from the H3 sliding windows.
   * Unlike StationCoverage (which accumulates forever), this properly
   * reflects only messages within the selected time window.
   */
  getStationMessageCounts(windowName: string): Map<number, { messageCount: number; maxDistance: number }> {
    const stationCounts = new Map<number, { messageCount: number; maxDistance: number }>();
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return stationCounts;

    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === 3);

    // Scan the requested window AND all shorter windows.
    // A station visible in a shorter window must appear in all longer windows.
    // Use the requested window's counts as the primary, but ensure stations
    // from shorter windows are included.
    const windowsToCheck = ri !== -1
      ? Array.from({ length: wi + 1 }, (_, i) => i)
      : [];

    for (const checkWi of windowsToCheck) {
      if (ri === -1) continue;
      const window = this.windows[ri][checkWi];
      const aggregated = window.getAggregated();
      for (const [, cell] of aggregated) {
        for (const stationId of cell.stationIds) {
          const existing = stationCounts.get(stationId);
          if (existing) {
            // Use the max values (longer window should have more data)
            if (checkWi === wi) {
              existing.messageCount += cell.messageCount;
            }
            existing.maxDistance = Math.max(existing.maxDistance, cell.maxDistance);
          } else {
            stationCounts.set(stationId, {
              messageCount: cell.messageCount,
              maxDistance: cell.maxDistance,
            });
          }
        }
      }
    }

    // Also check station sliding windows (for persistence-loaded data)
    for (let swi = 0; swi <= wi && swi < this.stationWindows.length; swi++) {
      const sw = this.stationWindows[swi];
      for (const stationId of sw.activeStationIds()) {
        if (stationCounts.has(stationId)) continue;
        const cov = sw.getStationCoverage(stationId);
        if (cov && cov.totalMessages > 0) {
          stationCounts.set(stationId, {
            messageCount: cov.totalMessages,
            maxDistance: cov.maxDistance,
          });
        }
      }
    }

    return stationCounts;
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
      const wi = WINDOW_CONFIGS.findIndex(c => c.name === '1h');
      activeCells[res] = this.windows[ri][wi].activeCells();
    }

    return {
      eventsProcessed: this.eventsProcessed,
      eventsRejected: this.eventsRejected,
      eventsWithPosition: this.eventsWithPosition,
      eventsWithoutPosition: this.eventsWithoutPosition,
      stationsTracked: this.stationWindows.length > 3 ? this.stationWindows[3].activeStationIds().size : 0,
      activeCells,
    };
  }

  /** Load a persisted H3 snapshot into the current sliding window slice */
  loadH3Snapshot(windowName: string, resolution: number, cells: CellResponse[]): void {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === resolution);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return;

    const window = this.windows[ri][wi];
    const slice = window.current;

    for (const cell of cells) {
      const existing = slice.get(cell.h3);
      if (existing) continue; // Don't overwrite live data

      const newCell = createEmptyCell();
      newCell.messageCount = cell.msgCount;
      newCell.maxDistance = cell.maxDistance;
      if (cell.avgLevel !== null) {
        newCell.totalLevel = cell.avgLevel * cell.msgCount;
      }
      newCell.errorMessages = Math.round(cell.errorRate * cell.msgCount);
      for (const src of cell.sources) newCell.sources.add(src);
      if (cell.stationIds) {
        for (const sid of cell.stationIds) newCell.stationIds.add(sid);
      }
      for (const tt of cell.transportTypes) newCell.transportTypes.add(tt as TransportType);
      slice.set(cell.h3, newCell);
    }
  }

  /** Load persisted station coverage into the current sliding window slice */
  loadStationSnapshot(windowName: string, stationData: any[]): void {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1 || !this.stationWindows[wi]) return;

    const sw = this.stationWindows[wi];
    for (const s of stationData) {
      if (!s.stationId || !s.bearingSectors) continue;
      // Record each sector's data into the current slice
      for (let i = 0; i < 36; i++) {
        const dist = s.bearingSectors[i] ?? 0;
        const count = s.sectorMessageCounts?.[i] ?? 0;
        if (dist > 0 || count > 0) {
          for (let j = 0; j < count; j++) {
            sw.record(s.stationId, i, dist, s.sectorAvgLevels?.[i] ?? null, true, false);
          }
        }
      }
      // Record messages without position
      const noPos = (s.totalMessages ?? 0) - (s.messagesWithPosition ?? 0);
      for (let j = 0; j < noPos; j++) {
        sw.record(s.stationId, -1, 0, s.avgLevel ?? null, false, false);
      }
    }
  }

  destroy(): void {
    for (const resWindows of this.windows) {
      for (const window of resWindows) {
        window.destroy();
      }
    }
    for (const sw of this.stationWindows) sw.destroy();
    this.rateLimiter.destroy();
  }
}
