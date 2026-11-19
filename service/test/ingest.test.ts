import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

function station(id: number, latitude: number, longitude: number): StationMeta {
  return {
    id,
    uuid: `uuid-${id}`,
    ident: `TEST-${id}`,
    latitude,
    longitude,
    sourceType: 'vdl',
    status: 'active',
    flagged: false,
    blocked: false,
    trustScore: 0.5,
    lastSyncedAt: new Date(),
  };
}

function event(stationId: number, targetLat: number | null, targetLon: number | null): CoverageEvent {
  return {
    stationId,
    stationUuid: `uuid-${stationId}`,
    targetLat,
    targetLon,
    targetAlt: null,
    transportType: 'aircraft',
    sourceType: 'dumpvdl2',
    source: 'dumpvdl2',
    frequency: 136.975,
    signalLevel: -20,
    errorCount: 0,
    timestamp: new Date(),
    hasTargetPosition: targetLat !== null && targetLon !== null,
  };
}

let store: CoverageStore;
afterEach(() => store.destroy());

describe('ingest', () => {
  it('indexes a target position for a station with no known location', () => {
    store = new CoverageStore();
    store.stationMap.set(1, station(1, 0, 0));

    // Frankfurt. Measured from (0,0) this is ~5,600 km, far beyond VDL2 range.
    store.ingest(event(1, 50.03, 8.57));

    expect(store.eventsRejected).toBe(0);
    expect(store.eventsProcessed).toBe(1);
    expect(store.eventsWithPosition).toBe(1);

    const counts = store.getStationMessageCounts('1h').get(1);
    expect(counts?.messageCount).toBe(1);
    expect(counts?.maxDistance).toBe(0);
  });

  it('keeps an event with an implausible range but drops its position', () => {
    store = new CoverageStore();
    store.stationMap.set(2, station(2, 50.03, 8.57));

    // New York is not reachable on VDL2 from Frankfurt.
    store.ingest(event(2, 40.64, -73.78));

    expect(store.eventsRejected).toBe(0);
    expect(store.eventsProcessed).toBe(1);
    expect(store.eventsWithPosition).toBe(0);
    expect(store.eventsWithoutPosition).toBe(1);
    expect(store.positionsDiscarded).toEqual({ out_of_range: 1 });
    // Counted at the station, not in New York
    expect(store.getStationCoverage(2, '1h')?.messagesWithPosition).toBe(0);
  });

  it('applies range limits to production source type names', () => {
    store = new CoverageStore();
    store.stationMap.set(7, station(7, 50.03, 8.57));

    // 700 km away: plausible for HFDL, not for VDL2
    store.ingest({ ...event(7, 50.03, 18.4), sourceType: 'vdl' });
    expect(store.positionsDiscarded).toEqual({ out_of_range: 1 });

    store.ingest({ ...event(7, 50.03, 18.4), sourceType: 'hfdl', frequency: 8.9 });
    expect(store.positionsDiscarded).toEqual({ out_of_range: 1 });
    expect(store.eventsWithPosition).toBe(1);
  });

  it('indexes a satellite-relayed position without giving the station a range', () => {
    store = new CoverageStore();
    store.stationMap.set(8, station(8, 50.03, 8.57));

    // Mid-Atlantic aircraft heard through Inmarsat
    store.ingest({ ...event(8, 45.0, -40.0), sourceType: 'aero-acars', frequency: 1545.1 });

    expect(store.eventsRejected).toBe(0);
    expect(store.eventsWithPosition).toBe(1);
    const coverage = store.getStationCoverage(8, '1h');
    expect(coverage?.messagesWithPosition).toBe(1);
    expect(coverage?.maxDistance).toBe(0);
    expect(store.getH3Data(3, '1h')).toHaveLength(1);
  });

  it('accepts flagged stations and rejects blocked ones, with reasons', () => {
    store = new CoverageStore();
    store.stationMap.set(4, { ...station(4, 50.03, 8.57), flagged: true });
    store.stationMap.set(5, { ...station(5, 50.03, 8.57), blocked: true });

    store.ingest(event(4, 50.9, 9.5));
    store.ingest(event(5, 50.9, 9.5));
    store.ingest(event(6, 50.9, 9.5));

    expect(store.eventsProcessed).toBe(1);
    expect(store.eventsRejected).toBe(2);
    expect(store.rejections).toEqual({ station_blocked: 1, unknown_station: 1 });
  });

  it('reports the same coverage area whatever resolution is loaded', () => {
    store = new CoverageStore();
    store.stationMap.set(9, station(9, 50.03, 8.57));
    store.ingest(event(9, 50.9, 9.5));
    store.ingest(event(9, 51.9, 7.5));

    const area = store.getCoverageAreaKm2('1h');
    // Two resolution 3 cells of roughly 12,000 km² each
    expect(area).toBeGreaterThan(15_000);
    expect(area).toBeLessThan(35_000);
    expect(store.getCoverageAreaKm2('1h', 'marine')).toBe(0);
    expect(store.getEventsPerSecond()).toBeCloseTo(2 / 60, 1);
  });

  it('ages a cell out of the shorter windows that share slices with a longer one', () => {
    vi.useFakeTimers();
    try {
      store = new CoverageStore();
      store.stationMap.set(10, station(10, 50.03, 8.57));
      store.ingest(event(10, 50.9, 9.5));

      // Stored once per resolution for the 6h, 12h and 24h windows together
      for (const w of ['1h', '6h', '12h', '24h', '1w', '1mo']) {
        expect(store.getH3Data(3, w)).toHaveLength(1);
      }

      vi.advanceTimersByTime(7 * 3_600_000);
      expect(store.getH3Data(3, '1h')).toHaveLength(0);
      expect(store.getH3Data(3, '6h')).toHaveLength(0);
      expect(store.getH3Data(3, '12h')).toHaveLength(1);
      expect(store.getH3Data(3, '24h')).toHaveLength(1);

      vi.advanceTimersByTime(18 * 3_600_000);
      expect(store.getH3Data(3, '24h')).toHaveLength(0);
      expect(store.getH3Data(3, '1w')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records range for a located station and a nearby target', () => {
    store = new CoverageStore();
    store.stationMap.set(3, station(3, 50.03, 8.57));

    store.ingest(event(3, 50.9, 9.5));

    expect(store.eventsProcessed).toBe(1);
    const counts = store.getStationMessageCounts('1h').get(3);
    expect(counts?.maxDistance).toBeGreaterThan(50);
  });
});
