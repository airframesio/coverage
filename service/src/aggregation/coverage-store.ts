import {
  SlidingWindow, createEmptyCell, mergeIntoCell, cellSources, cellStationIds, cellTransportTypes,
  cellHasTransport, addCellSource, addCellStation, addCellTransport,
} from './sliding-window.js';
import { StationSlidingWindow } from './station-window.js';
import { cellArea } from 'h3-js';
import { indexPoint, shouldMaintainResolution } from '../compute/h3-indexer.js';
import { haversineDistance, bearing, bearingToSector } from '../compute/distance.js';
import { computeConfidence, maxRangeKm } from '../compute/signal-analysis.js';
import { validateCoordinate } from '../validation/coordinate-validator.js';
import { validateSignal, isPlausibleRange } from '../validation/signal-validator.js';
import { checkStationTrust } from '../validation/station-trust.js';
import { sourceFamily } from '../compute/source-family.js';
import { config } from '../config.js';
import { WINDOW_CONFIGS, H3_RESOLUTION_CONFIGS } from '../types/coverage.js';
import type { CellAggregation, CellResponse, StationCoverage, WindowConfig } from '../types/coverage.js';
import type { CoverageEvent, StationMeta, TransportType } from '../types/events.js';

/** Grid used for coverage area figures */
const AREA_RESOLUTION = 3;

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

  // Metrics
  public eventsProcessed = 0;
  /** Accepted events by radio family. Sums to eventsProcessed. */
  public processedBySource: Record<string, number> = {};
  public eventsRejected = 0;
  public eventsWithPosition = 0;
  public eventsWithoutPosition = 0;
  /** Why events were rejected, by reason. Sums to eventsRejected. */
  public rejections: Record<string, number> = {};
  /** Events kept, but whose target position was discarded, by reason */
  public positionsDiscarded: Record<string, number> = {};
  /**
   * Out-of-range positions by radio family: how many were within twice the
   * limit (the limit may be too tight) and how many beyond it (a stale target
   * position or a wrongly located station).
   */
  public outOfRange: Record<string, { near: number; far: number }> = {};
  /**
   * The same discards per station, with the furthest distance seen. A station
   * with many `far` discards is usually located in the wrong place (GeoIP) or
   * relays a feed from elsewhere, which the per-family totals cannot show.
   */
  private outOfRangeByStation = new Map<number, { near: number; far: number; maxDistanceKm: number }>();

  constructor() {
    // Initialize sliding windows for each resolution x window combination
    // Windows a resolution is not kept for stay empty; they only keep indexing consistent.
    // A window that is a view of another shares that window's slices.
    for (let ri = 0; ri < H3_RESOLUTION_CONFIGS.length; ri++) {
      const own = WINDOW_CONFIGS.map(wc => (wc.viewOf ? null : new SlidingWindow(wc)));
      this.windows.push(WINDOW_CONFIGS.map((wc, wi) => {
        const ownerIndex = wc.viewOf ? WINDOW_CONFIGS.findIndex(c => c.name === wc.viewOf) : wi;
        const owner = own[ownerIndex];
        if (!owner) throw new Error(`Window ${wc.name} is a view of unknown window ${wc.viewOf}`);
        return owner;
      }));
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
      this.reject(trust.reason ?? 'untrusted');
      return;
    }

    // There is deliberately no per-station rate limit: a receiver near a busy
    // port or airport is legitimately far busier than the rest.

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

    const stationLocated = Number.isFinite(stationLat) && Number.isFinite(stationLon)
      && !(Math.abs(stationLat) < 0.01 && Math.abs(stationLon) < 0.01);

    // 4. Validate target coordinates if present
    let distance = 0;
    let brng = 0;
    let hasValidTarget = false;
    let directional = false;

    if (event.hasTargetPosition && event.targetLat !== null && event.targetLon !== null) {
      const targetCheck = validateCoordinate(event.targetLat, event.targetLon);
      if (!targetCheck.valid) {
        this.discardPosition('invalid_coordinate');
      } else {
        const sigCheck = validateSignal(
          event.sourceType,
          event.frequency,
          event.signalLevel,
          event.errorCount,
        );
        if (!sigCheck.valid) {
          this.reject(sigCheck.reason ?? 'signal');
          return;
        }

        hasValidTarget = true;

        // Distance and bearing only mean something when we know where the station
        // is, and when the station hears the target directly. A satellite relay
        // says nothing about the receiver's own range or direction, and neither
        // does an imported area feed (see config.areaFeedStations): its positions
        // are kept wherever they are, with no range limit.
        const ident = this.stationMap.get(event.stationId)?.ident.toLowerCase() ?? '';
        directional = stationLocated
          && sourceFamily(event.sourceType) !== 'satcom'
          && !config.areaFeedStations.has(ident);
        if (directional) {
          distance = haversineDistance(stationLat, stationLon, event.targetLat, event.targetLon);
          brng = bearing(stationLat, stationLon, event.targetLat, event.targetLon);

          // A target too far away for this kind of link is a bad or stale
          // position (flight positions can be old), not a bad reception. Keep
          // the event as proof the station is receiving and drop the position.
          if (!isPlausibleRange(event.sourceType, distance)) {
            this.discardPosition('out_of_range');
            this.countOutOfRange(event.sourceType, distance, event.stationId);
            hasValidTarget = false;
            directional = false;
            distance = 0;
            brng = 0;
          }
        }
      }
    }

    if (hasValidTarget) this.eventsWithPosition++;
    else this.eventsWithoutPosition++;

    this.eventsProcessed++;
    const family = sourceFamily(event.sourceType);
    this.processedBySource[family] = (this.processedBySource[family] ?? 0) + 1;

    // 5. Index into H3 cells
    // If we have a target position, index at the target (aircraft/vessel) location.
    // If not, index at the station location — receiving a message proves coverage there.
    const indexLat = hasValidTarget && event.targetLat !== null ? event.targetLat : stationLat;
    const indexLon = hasValidTarget && event.targetLon !== null ? event.targetLon : stationLon;

    // Skip if we still have no usable coordinates
    if (indexLat === 0 && indexLon === 0) {
      this.updateStationCoverage(event, distance, brng, hasValidTarget, directional);
      return;
    }

    {
      const h3Cells = indexPoint(indexLat, indexLon);

      for (let ri = 0; ri < H3_RESOLUTION_CONFIGS.length; ri++) {
        const resolution = H3_RESOLUTION_CONFIGS[ri].resolution;
        const h3Index = h3Cells.get(resolution);
        if (!h3Index) continue;

        for (let wi = 0; wi < WINDOW_CONFIGS.length; wi++) {
          if (WINDOW_CONFIGS[wi].viewOf) continue; // written once, through its owner
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
            event.sourceType,
            event.stationId,
            event.transportType,
          );
        }
      }
    }

    // 6. Update per-station coverage. Sector and range are recorded only for
    // directly received targets from a located station.
    this.updateStationCoverage(event, distance, brng, hasValidTarget, directional);
  }

  private reject(reason: string): void {
    this.eventsRejected++;
    this.rejections[reason] = (this.rejections[reason] ?? 0) + 1;
  }

  private discardPosition(reason: string): void {
    this.positionsDiscarded[reason] = (this.positionsDiscarded[reason] ?? 0) + 1;
  }

  private countOutOfRange(sourceType: string, distanceKm: number, stationId: number): void {
    const family = sourceFamily(sourceType);
    const far = distanceKm > maxRangeKm(sourceType) * 2;
    const entry = (this.outOfRange[family] ??= { near: 0, far: 0 });
    let station = this.outOfRangeByStation.get(stationId);
    if (!station) {
      station = { near: 0, far: 0, maxDistanceKm: 0 };
      this.outOfRangeByStation.set(stationId, station);
    }
    if (far) {
      entry.far++;
      station.far++;
    } else {
      entry.near++;
      station.near++;
    }
    if (distanceKm > station.maxDistanceKm) station.maxDistanceKm = distanceKm;
  }

  /** Stations with the most out-of-range positions since start, worst first */
  getOutOfRangeStations(limit = 20): Array<{
    stationId: number; ident: string; sourceType: string; near: number; far: number; maxDistanceKm: number;
  }> {
    return [...this.outOfRangeByStation]
      .sort(([, a], [, b]) => (b.near + b.far) - (a.near + a.far))
      .slice(0, limit)
      .map(([stationId, counts]) => {
        const meta = this.stationMap.get(stationId);
        return {
          stationId,
          ident: meta?.ident ?? '',
          sourceType: meta?.sourceType ?? '',
          near: counts.near,
          far: counts.far,
          maxDistanceKm: Math.round(counts.maxDistanceKm),
        };
      });
  }

  private updateStationCoverage(
    event: CoverageEvent,
    distance: number,
    brng: number,
    hasValidTarget: boolean,
    directional: boolean,
  ): void {
    const sector = hasValidTarget && directional ? bearingToSector(brng) : -1;
    const hasError = event.errorCount !== null && event.errorCount > 0;

    for (const sw of this.stationWindows) {
      sw.record(
        event.stationId,
        sector,
        distance,
        event.signalLevel,
        hasValidTarget,
        hasError,
        event.transportType,
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

    const aggregated = this.aggregated(ri, wi);
    const results: CellResponse[] = [];

    for (const [h3, cell] of aggregated) {
      if (cell.messageCount === 0) continue;

      // Transport type filter
      if (opts?.transportType) {
        if (!cellHasTransport(cell, opts.transportType)) continue;
      }

      const confidence = computeConfidence(cell);

      // Min confidence filter
      if (opts?.minConfidence && confidence < opts.minConfidence) continue;

      const stationIds = cellStationIds(cell);
      results.push({
        h3,
        msgCount: cell.messageCount,
        avgLevel: cell.totalLevel !== 0 ? Math.round(cell.totalLevel / cell.messageCount * 10) / 10 : null,
        maxDistance: Math.round(cell.maxDistance * 10) / 10,
        errorRate: Math.round((cell.errorMessages / cell.messageCount) * 1000) / 1000,
        confidence,
        sources: cellSources(cell),
        stationCount: stationIds.length,
        stationIds,
        transportTypes: cellTransportTypes(cell),
      });
    }

    return results;
  }

  /** Get station coverage data for a specific station and window (sliding window scoped) */
  getStationCoverage(stationId: number, windowName: string, transportFilter?: TransportType): StationCoverage | null {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return null;
    return this.stationWindows[wi].getStationCoverage(stationId, transportFilter);
  }

  /** Get all stations with coverage data for a given window */
  getAllStationCoverage(windowName: string, transportFilter?: TransportType): StationCoverage[] {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return [];
    const sw = this.stationWindows[wi];
    const results: StationCoverage[] = [];
    for (const id of sw.activeStationIds(transportFilter)) {
      const cov = sw.getStationCoverage(id, transportFilter);
      if (cov && cov.totalMessages > 0) results.push(cov);
    }
    return results;
  }

  /**
   * Per-station message counts within a time window, from the per-station
   * sliding windows, which count every accepted event exactly once.
   *
   * These must not be derived from the H3 cells: a cell's count is the total
   * of every station that reported into it, so crediting it to each of those
   * stations multiplies the figure wherever stations share a cell, and events
   * without a position are in no cell at all.
   */
  getStationMessageCounts(windowName: string): Map<number, { messageCount: number; maxDistance: number }> {
    const stationCounts = new Map<number, { messageCount: number; maxDistance: number }>();
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return stationCounts;

    // The requested window is authoritative. Slices of different windows do not
    // rotate together, so a station can be in a shorter window and just have left
    // this one; it is then listed with its largest single-window count. Windows
    // overlap, so their counts are never added together.
    for (const [stationId, totals] of this.stationWindows[wi].stationTotals()) {
      stationCounts.set(stationId, { messageCount: totals.totalMessages, maxDistance: totals.maxDistance });
    }
    for (let swi = 0; swi < wi; swi++) {
      for (const [stationId, totals] of this.stationWindows[swi].stationTotals()) {
        const existing = stationCounts.get(stationId);
        if (!existing) {
          stationCounts.set(stationId, { messageCount: totals.totalMessages, maxDistance: totals.maxDistance });
        } else if (existing.messageCount < totals.totalMessages) {
          existing.messageCount = totals.totalMessages;
          existing.maxDistance = Math.max(existing.maxDistance, totals.maxDistance);
        }
      }
    }

    return stationCounts;
  }

  /**
   * Area of the cells with coverage in a window, in km².
   * Always measured on the resolution 3 grid (cells about 110 km across) so
   * the figure does not depend on which resolution a client happens to load.
   */
  getCoverageAreaKm2(windowName: string, transportType?: TransportType): number {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === AREA_RESOLUTION);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return 0;

    let area = 0;
    for (const [h3, cell] of this.aggregated(ri, wi)) {
      if (cell.messageCount === 0) continue;
      if (transportType && !cellHasTransport(cell, transportType)) continue;
      area += cellArea(h3, 'km2');
    }
    return Math.round(area);
  }

  /** Cells of one resolution merged across a window's slices */
  private aggregated(ri: number, wi: number): Map<string, CellAggregation> {
    return this.windows[ri][wi].getAggregated(WINDOW_CONFIGS[wi].viewSlices);
  }

  /** Events accepted per second, averaged over the last minute */
  getEventsPerSecond(): number {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === '1m');
    if (wi === -1) return 0;
    return Math.round(this.stationWindows[wi].totalMessages() / 60 * 10) / 10;
  }

  /** Cells held in memory across every window and slice */
  getCellsInMemory(): number {
    let total = 0;
    for (const resWindows of this.windows) {
      for (const window of new Set(resWindows)) total += window.storedCells();
    }
    return total;
  }

  /** Get summary metrics */
  getStats(): {
    eventsProcessed: number;
    processedBySource: Record<string, number>;
    eventsRejected: number;
    eventsWithPosition: number;
    eventsWithoutPosition: number;
    rejections: Record<string, number>;
    positionsDiscarded: Record<string, number>;
    outOfRange: Record<string, { near: number; far: number }>;
    stationsTracked: number;
    activeCells: Record<number, number>;
  } {
    const activeCells: Record<number, number> = {};
    const hourIndex = WINDOW_CONFIGS.findIndex(c => c.name === '1h');
    for (let ri = 0; ri < H3_RESOLUTION_CONFIGS.length; ri++) {
      const { resolution, maxWindowIndex } = H3_RESOLUTION_CONFIGS[ri];
      // The 1h window, or the longest window this resolution is kept for
      const wi = Math.min(hourIndex, maxWindowIndex);
      activeCells[resolution] = this.windows[ri][wi].activeCells(WINDOW_CONFIGS[wi].viewSlices);
    }

    return {
      eventsProcessed: this.eventsProcessed,
      processedBySource: { ...this.processedBySource },
      eventsRejected: this.eventsRejected,
      eventsWithPosition: this.eventsWithPosition,
      eventsWithoutPosition: this.eventsWithoutPosition,
      rejections: { ...this.rejections },
      positionsDiscarded: { ...this.positionsDiscarded },
      outOfRange: structuredClone(this.outOfRange),
      stationsTracked: this.stationWindows.length > 3 ? this.stationWindows[3].activeStationIds().size : 0,
      activeCells,
    };
  }

  /** Load a persisted H3 snapshot into the current sliding window slice */
  loadH3Snapshot(windowName: string, resolution: number, cells: CellResponse[]): void {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === resolution);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return;
    // Snapshots saved before a resolution was dropped for this window
    if (!shouldMaintainResolution(resolution, wi)) return;
    // A view has no cells of its own; its owner's snapshot covers it.
    if (WINDOW_CONFIGS[wi].viewOf) return;

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
      for (const src of cell.sources) addCellSource(newCell, src);
      if (cell.stationIds) {
        for (const sid of cell.stationIds) addCellStation(newCell, sid);
      }
      for (const tt of cell.transportTypes) addCellTransport(newCell, tt as TransportType);
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
      // Determine transport type from station metadata
      const meta = this.stationMap.get(s.stationId);
      const tt: TransportType = (meta?.sourceType === 'aiscatcher' || meta?.sourceType === 'ais')
        ? 'marine' : 'aircraft';
      // Record each sector's data into the current slice
      for (let i = 0; i < 36; i++) {
        const dist = s.bearingSectors[i] ?? 0;
        const count = s.sectorMessageCounts?.[i] ?? 0;
        if (dist > 0 || count > 0) {
          for (let j = 0; j < count; j++) {
            sw.record(s.stationId, i, dist, s.sectorAvgLevels?.[i] ?? null, true, false, tt);
          }
        }
      }
      // Positions that carry no sector (satellite relays, unlocated stations)
      let sectorTotal = 0;
      for (let i = 0; i < 36; i++) sectorTotal += s.sectorMessageCounts?.[i] ?? 0;
      const unsectored = Math.max(0, (s.messagesWithPosition ?? 0) - sectorTotal);
      for (let j = 0; j < unsectored; j++) {
        sw.record(s.stationId, -1, 0, s.avgLevel ?? null, true, false, tt);
      }
      // Record messages without position
      const noPos = (s.totalMessages ?? 0) - (s.messagesWithPosition ?? 0);
      for (let j = 0; j < noPos; j++) {
        sw.record(s.stationId, -1, 0, s.avgLevel ?? null, false, false, tt);
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
  }
}
