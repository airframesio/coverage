import {
  SlidingWindow, createEmptyCell, mergeIntoCell, cellSources, cellHasFamily, cellStationIds, cellTransportTypes,
  cellHasTransport, addCellSource, addCellStation, addCellTransport,
} from './sliding-window.js';
import { StationSlidingWindow, type SavedStationSliceEntry } from './station-window.js';
import { cellArea } from 'h3-js';
import { indexPoint, shouldMaintainResolution } from '../compute/h3-indexer.js';
import { haversineDistance, bearing, bearingToSector } from '../compute/distance.js';
import { computeConfidence, maxRangeKm } from '../compute/signal-analysis.js';
import { validateCoordinate } from '../validation/coordinate-validator.js';
import { validateSignal, isPlausibleRange } from '../validation/signal-validator.js';
import { checkStationTrust } from '../validation/station-trust.js';
import { sourceFamily, type SourceFamily } from '../compute/source-family.js';
import {
  HeardLocationEstimator, AIRCRAFT_PROFILE, MARINE_PROFILE, type HeardLocation,
} from '../compute/heard-location.js';
import { config } from '../config.js';
import { WINDOW_CONFIGS, H3_RESOLUTION_CONFIGS } from '../types/coverage.js';
import type { CellAggregation, CellResponse, StationCoverage, WindowConfig } from '../types/coverage.js';
import type { CoverageEvent, StationMeta, TransportType } from '../types/events.js';

/** A heard centre this close to the registered location does not move the station */
const HEARD_MIN_OFFSET_KM = 100;
/** A station already placed by what it hears moves again only for a shift this large */
const HEARD_MOVE_KM = 25;

/** Grid used for coverage area figures */
const AREA_RESOLUTION = 3;

/** A cell as the API and snapshots give it */
function cellResponse(h3: string, cell: CellAggregation, confidence: number): CellResponse {
  const stationIds = cellStationIds(cell);
  return {
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
  };
}

/** South of this no sea can be reached (the Ross Sea ends at about 78.5° S) */
const SOUTHERNMOST_SEA_LAT = -79;

/**
 * Main in-memory coverage data store.
 * Manages sliding windows at multiple H3 resolutions and per-station coverage.
 */
/** Upper edges (km) of the distance bands out-of-range positions are counted in */
const OUT_OF_RANGE_BANDS_KM = [500, 750, 1000, 1500, 2000, 3000, 5000, 10000];

const TRANSPORT_TYPES: TransportType[] = ['aircraft', 'marine', 'sonde', 'space'];

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
  /** How far out the discarded positions were, by radio family and distance band */
  private outOfRangeDistances: Record<string, number[]> = {};
  private outOfRangeByStation = new Map<number, { near: number; far: number; maxDistanceKm: number }>();

  /** Where stations without an owner-entered location appear to be, from what they hear */
  private heard = new HeardLocationEstimator();
  /** Stations whose restored estimate has been applied since start */
  private heardApplied = new Set<number>();
  /** How many times a station was moved to, or back from, where it is heard */
  public stationsRelocated = 0;
  /** See stationSectorsRevision() */
  private sectorsRevision = 0;

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

    // 2b. A station without an owner-entered location is placed where it is heard
    this.placeByHeard(event);

    // 3. Determine station coordinates
    // Prefer authoritative (synced from main API), fall back to NATS payload
    // when the synced station has no coordinates (common when GeoIP isn't populated)
    const located = this.stationMap.get(event.stationId);
    let stationLat = located?.latitude ?? trust.stationLat;
    let stationLon = located?.longitude ?? trust.stationLon;

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
      } else if (event.transportType === 'marine' && event.targetLat < SOUTHERNMOST_SEA_LAT) {
        // Inland ice: no ship gets there. Imported AIS feeds pass on corrupt
        // fixes, and an importer has no location to range-check them against.
        this.discardPosition('marine_on_ice');
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

  /**
   * Feed the station's heard-location estimate with this event's position and
   * move the station when the estimate says the registered spot is wrong.
   *
   * Applies only to stations whose location nobody entered (a GeoIP guess, often
   * the internet provider's city), that hear their targets directly, and that
   * are not area feeds. The station moves to the centre of what it hears when
   * the heard positions form one group no wider than the radio's range and that
   * centre is at least twice as far from the registered spot as the group is
   * wide (and at least 100 km): a real antenna in the right place sits inside
   * its own group.
   */
  private placeByHeard(event: CoverageEvent): void {
    const meta = this.stationMap.get(event.stationId);
    if (!meta || meta.ownerLocated !== false) return;
    if (sourceFamily(event.sourceType) === 'satcom') return;
    if (config.areaFeedStations.has(meta.ident.toLowerCase())) return;

    const profile = sourceFamily(event.sourceType) === 'ais' ? MARINE_PROFILE : AIRCRAFT_PROFILE;
    let recomputed = false;
    if (event.hasTargetPosition && event.targetLat !== null && event.targetLon !== null
      && validateCoordinate(event.targetLat, event.targetLon).valid) {
      recomputed = this.heard.add(event.stationId, event.targetLat, event.targetLon, profile);
    }

    // An estimate restored after a restart is applied on the station's first
    // event. The saved sectors were measured from it, so they are kept.
    const restored = !this.heardApplied.has(event.stationId);
    if (!recomputed && !restored) return;
    this.heardApplied.add(event.stationId);

    const estimate = this.heard.get(event.stationId);
    // Also ignores an estimate saved by a build that asked for fewer positions
    if (!estimate || estimate.samples < profile.minSamples) return;

    const regLat = meta.registeredLatitude ?? meta.latitude;
    const regLon = meta.registeredLongitude ?? meta.longitude;
    const registered = Number.isFinite(regLat) && Number.isFinite(regLon)
      && !(Math.abs(regLat) < 0.01 && Math.abs(regLon) < 0.01);

    const oneAntenna = estimate.spreadKm <= maxRangeKm(event.sourceType);
    const offsetKm = registered
      ? haversineDistance(regLat, regLon, estimate.latitude, estimate.longitude)
      : Infinity;
    // Moving a station takes a clear case: the centre must be twice as far from
    // the registered spot as the group is wide. That leaves alone a station that
    // hears a long stretch of coast or a wide patch of sky, where the centre is
    // open water or the middle of the traffic, not the antenna. A station already
    // moved stays moved until the centre is back within the group's own width,
    // so one near the threshold does not flip back and forth.
    const placed = meta.locationSource === 'heard';
    const needed = Math.max(HEARD_MIN_OFFSET_KM, estimate.spreadKm * (placed ? 1 : 2));
    const useHeard = oneAntenna && offsetKm > needed;

    if (useHeard) {
      // Drifts of the centre within the group are not worth throwing the sectors away for
      if (placed && haversineDistance(meta.latitude, meta.longitude, estimate.latitude, estimate.longitude)
        < Math.max(HEARD_MOVE_KM, estimate.spreadKm / 2)) return;
      meta.latitude = estimate.latitude;
      meta.longitude = estimate.longitude;
      meta.locationSource = 'heard';
    } else {
      if (meta.locationSource !== 'heard') return;
      meta.latitude = regLat;
      meta.longitude = regLon;
      meta.locationSource = 'registered';
    }

    if (recomputed) {
      for (const sw of new Set(this.stationWindows)) sw.clearSectors(event.stationId);
      this.sectorsRevision++;
      this.outOfRangeByStation.delete(event.stationId);
      this.stationsRelocated++;
    }
  }

  /** Heard-location estimates, for saving across restarts */
  getHeardLocations(): Array<HeardLocation & { stationId: number }> {
    return [...this.heard.entries()].map(([stationId, location]) => ({ stationId, ...location }));
  }

  loadHeardLocations(saved: any[]): void {
    for (const s of saved) {
      if (!Number.isFinite(s?.stationId) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)
        || !Number.isFinite(s.spreadKm)) continue;
      this.heard.restore(s.stationId, {
        latitude: s.latitude, longitude: s.longitude, spreadKm: s.spreadKm, samples: s.samples ?? 0,
      });
    }
  }

  /** Stations currently shown where they are heard, not where they are registered */
  getStationsPlacedByHeard(): number {
    let n = 0;
    for (const meta of this.stationMap.values()) if (meta.locationSource === 'heard') n++;
    return n;
  }

  private discardPosition(reason: string): void {
    this.positionsDiscarded[reason] = (this.positionsDiscarded[reason] ?? 0) + 1;
  }

  private countOutOfRange(sourceType: string, distanceKm: number, stationId: number): void {
    const family = sourceFamily(sourceType);
    const far = distanceKm > maxRangeKm(sourceType) * 2;
    const entry = (this.outOfRange[family] ??= { near: 0, far: 0 });
    const bands = (this.outOfRangeDistances[family] ??= new Array(OUT_OF_RANGE_BANDS_KM.length + 1).fill(0));
    let band = OUT_OF_RANGE_BANDS_KM.findIndex(limit => distanceKm <= limit);
    if (band === -1) band = OUT_OF_RANGE_BANDS_KM.length;
    bands[band]++;
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

  /**
   * Out-of-range positions since start by distance from the station, per radio
   * family: `upTo500` is everything up to 500 km, `upTo750` from there to 750 km,
   * and so on, with `over10000` last. Bands below a family's limit stay at zero.
   */
  getOutOfRangeDistances(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [family, bands] of Object.entries(this.outOfRangeDistances)) {
      const named: Record<string, number> = {};
      OUT_OF_RANGE_BANDS_KM.forEach((limit, i) => { named[`upTo${limit}`] = bands[i]; });
      named[`over${OUT_OF_RANGE_BANDS_KM[OUT_OF_RANGE_BANDS_KM.length - 1]}`] = bands[OUT_OF_RANGE_BANDS_KM.length];
      result[family] = named;
    }
    return result;
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
      /** Radio families to keep; undefined keeps every cell */
      modes?: ReadonlySet<SourceFamily>;
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
      if (opts?.modes && !cellHasFamily(cell, opts.modes)) continue;

      const confidence = computeConfidence(cell);

      // Min confidence filter
      if (opts?.minConfidence && confidence < opts.minConfidence) continue;

      results.push(cellResponse(h3, cell, confidence));
    }

    return results;
  }

  /**
   * A window's cells slice by slice, newest first, with each slice's start
   * time, for snapshots. Views have no slices of their own (their owner's
   * snapshot covers them) and answer nothing.
   */
  getH3Slices(resolution: number, windowName: string): { startedAt: number; current: boolean; cells: CellResponse[] }[] {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === resolution);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1 || WINDOW_CONFIGS[wi].viewOf) return [];
    const window = this.windows[ri][wi];
    if (!window) return [];
    return window.slicesByAge().map(({ startedAt, current, slice }) => {
      const cells: CellResponse[] = [];
      for (const [h3, cell] of slice) {
        if (cell.messageCount > 0) cells.push(cellResponse(h3, cell, computeConfidence(cell)));
      }
      return { startedAt, current, cells };
    });
  }

  /** A window's per-station totals slice by slice, newest first, for snapshots */
  getStationSlices(windowName: string): { startedAt: number; current: boolean; entries: SavedStationSliceEntry[] }[] {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1 || !this.stationWindows[wi]) return [];
    return this.stationWindows[wi].exportSlices();
  }

  /**
   * Put one saved slice of station totals back at its age. Returns whether it
   * went into the current slice, or null when it is older than the window.
   */
  loadStationSlice(
    windowName: string, startedAt: number, entries: SavedStationSliceEntry[], now = Date.now(),
  ): boolean | null {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1 || !this.stationWindows[wi]) return null;
    return this.stationWindows[wi].importSlice(startedAt, entries, now);
  }

  /**
   * Goes up each time a moved station's range and direction are cleared. That
   * changes closed station slices too, so they have to be saved again.
   */
  stationSectorsRevision(): number {
    return this.sectorsRevision;
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
    return this.stationWindows[wi].allStationCoverage(transportFilter);
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
   * The same figure as getStationMessageCounts, for one station. The map asks
   * for every station's coverage one request at a time, so this must not walk
   * every station's data.
   */
  getStationMessageCount(stationId: number, windowName: string): { messageCount: number; maxDistance: number } | null {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1) return null;
    const own = this.stationWindows[wi].stationTotal(stationId);
    let result = own ? { messageCount: own.totalMessages, maxDistance: own.maxDistance } : null;
    for (let swi = 0; swi < wi; swi++) {
      const totals = this.stationWindows[swi].stationTotal(stationId);
      if (!totals) continue;
      if (!result) {
        result = { messageCount: totals.totalMessages, maxDistance: totals.maxDistance };
      } else if (result.messageCount < totals.totalMessages) {
        result.messageCount = totals.totalMessages;
        result.maxDistance = Math.max(result.maxDistance, totals.maxDistance);
      }
    }
    return result;
  }

  /**
   * Area of the cells with coverage in a window, in km².
   * Always measured on the resolution 3 grid (cells about 110 km across) so
   * the figure does not depend on which resolution a client happens to load.
   */
  getCoverageAreaKm2(windowName: string, transportType?: TransportType, modes?: ReadonlySet<SourceFamily>): number {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === AREA_RESOLUTION);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return 0;

    let area = 0;
    for (const [h3, cell] of this.aggregated(ri, wi)) {
      if (cell.messageCount === 0) continue;
      if (transportType && !cellHasTransport(cell, transportType)) continue;
      if (modes && !cellHasFamily(cell, modes)) continue;
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

  /**
   * Load a persisted H3 snapshot. A per-slice snapshot (`startedAt` given) goes
   * back into the slice of its age; an older whole-window snapshot goes into
   * the current slice. Returns whether it went into the current slice, or null
   * when it was not loaded (older than the window, or not kept for it).
   */
  loadH3Snapshot(
    windowName: string, resolution: number, cells: CellResponse[], startedAt?: number, now = Date.now(),
  ): boolean | null {
    const ri = H3_RESOLUTION_CONFIGS.findIndex(c => c.resolution === resolution);
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (ri === -1 || wi === -1) return null;
    // Snapshots saved before a resolution was dropped for this window
    if (!shouldMaintainResolution(resolution, wi)) return null;
    // A view has no cells of its own; its owner's snapshot covers it.
    if (WINDOW_CONFIGS[wi].viewOf) return null;

    const window = this.windows[ri][wi];
    let slice = window.current;
    let current = true;
    if (startedAt !== undefined) {
      const target = window.sliceFor(startedAt, now);
      if (!target) return null;
      slice = target.slice;
      current = target.current;
    }

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
    return current;
  }

  /**
   * Station entries from snapshots of older builds, which do not name a
   * transport type, held back because station metadata was not available yet
   */
  private pendingStationSnapshots: { windowName: string; entry: any }[] = [];

  /** Load persisted station coverage into the current sliding window slice */
  loadStationSnapshot(windowName: string, stationData: any[]): void {
    const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
    if (wi === -1 || !this.stationWindows[wi]) return;

    for (const s of stationData) {
      if (!s.stationId || !s.bearingSectors) continue;
      // Snapshots name the transport type. Ones saved by older builds do not,
      // and need the station's metadata. With no metadata at all (the first
      // sync failed) they wait, rather than being filed, and later saved, as
      // aircraft.
      if (!TRANSPORT_TYPES.includes(s.transportType) && this.stationMap.size === 0) {
        this.pendingStationSnapshots.push({ windowName, entry: s });
        continue;
      }
      this.restoreStationEntry(wi, s);
    }
  }

  /**
   * Restore held-back snapshot entries once station metadata has arrived.
   * Returns how many were restored.
   */
  applyPendingStationSnapshots(): number {
    if (this.pendingStationSnapshots.length === 0 || this.stationMap.size === 0) return 0;
    const pending = this.pendingStationSnapshots;
    this.pendingStationSnapshots = [];
    for (const { windowName, entry } of pending) {
      const wi = WINDOW_CONFIGS.findIndex(c => c.name === windowName);
      if (wi !== -1 && this.stationWindows[wi]) this.restoreStationEntry(wi, entry);
    }
    return pending.length;
  }

  /** True while snapshot entries wait for station metadata */
  hasPendingStationSnapshots(): boolean {
    return this.pendingStationSnapshots.length > 0;
  }

  private restoreStationEntry(wi: number, s: any): void {
    let tt: TransportType;
    if (TRANSPORT_TYPES.includes(s.transportType)) {
      tt = s.transportType;
    } else {
      const meta = this.stationMap.get(s.stationId);
      tt = (meta?.sourceType === 'aiscatcher' || meta?.sourceType === 'ais') ? 'marine' : 'aircraft';
    }
    this.stationWindows[wi].restore(s.stationId, tt, {
      sectorMaxDist: s.bearingSectors,
      sectorMsgCount: s.sectorMessageCounts ?? [],
      sectorAvgLevel: s.sectorAvgLevels,
      totalMessages: s.totalMessages ?? 0,
      messagesWithPosition: s.messagesWithPosition ?? 0,
      avgLevel: typeof s.avgLevel === 'number' ? s.avgLevel : null,
      errorRate: s.errorRate ?? 0,
    });
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
