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

  it('calibrates a cell against the source first recorded for it', () => {
    store = new CoverageStore();
    store.stationMap.set(11, station(11, 50.03, 8.57));
    // Another cell sees 'first-elsewhere' before this cell does
    store.ingest({ ...event(11, 48.0, 2.0), sourceType: 'first-elsewhere' });
    store.ingest({ ...event(11, 50.9, 9.5), sourceType: 'recorded-first' });
    store.ingest({ ...event(11, 50.9, 9.5), sourceType: 'first-elsewhere' });

    const cell = store.getH3Data(3, '1h').find(c => c.sources.length === 2)!;
    expect(cell.sources).toEqual(['recorded-first', 'first-elsewhere']);

    // A restored snapshot keeps that order
    const restored = new CoverageStore();
    restored.loadH3Snapshot('1h', 3, [cell]);
    expect(restored.getH3Data(3, '1h')[0].sources).toEqual(['recorded-first', 'first-elsewhere']);
    restored.destroy();
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

  it('counts each station\'s own messages when stations share a cell', () => {
    store = new CoverageStore();
    store.stationMap.set(1, station(1, 50.0, 8.0));
    store.stationMap.set(2, station(2, 50.1, 8.1));

    // Same target position, so both stations report into the same cells
    for (let i = 0; i < 30; i++) store.ingest(event(1, 50.3, 8.3));
    for (let i = 0; i < 5; i++) store.ingest(event(2, 50.3, 8.3));
    // Messages without a position count too
    for (let i = 0; i < 4; i++) store.ingest(event(2, null, null));

    for (const window of ['1m', '1h', '1mo']) {
      const counts = store.getStationMessageCounts(window);
      expect(counts.get(1)?.messageCount).toBe(30);
      expect(counts.get(2)?.messageCount).toBe(9);
    }
    const total = [...store.getStationMessageCounts('1m').values()].reduce((sum, c) => sum + c.messageCount, 0);
    expect(total).toBe(store.eventsProcessed);
    expect(store.getStationMessageCounts('1m').get(1)?.maxDistance).toBeGreaterThan(30);
  });

  it('keeps every position of an imported area feed, however far away', () => {
    store = new CoverageStore();
    // An ordinary AIS receiver and the Norwegian coastal feed, both placed in Oslo
    store.stationMap.set(30, { ...station(30, 59.9, 10.7), ident: 'AIS-OSLO', sourceType: 'aiscatcher' });
    store.stationMap.set(31, { ...station(31, 59.9, 10.7), ident: 'NCT', sourceType: 'aiscatcher' });
    const ais = (stationId: number): CoverageEvent => ({
      // A vessel off Tromso, about 1,150 km away
      ...event(stationId, 69.7, 18.9), transportType: 'marine', sourceType: 'ais', source: 'aiscatcher',
      frequency: null, signalLevel: null,
    });

    store.ingest(ais(30));
    expect(store.positionsDiscarded.out_of_range).toBe(1);

    store.ingest(ais(31));
    expect(store.positionsDiscarded.out_of_range).toBe(1);
    expect(store.eventsWithPosition).toBe(1);
    // The feed gets no range of its own from it
    expect(store.getStationMessageCounts('1h').get(31)).toEqual({ messageCount: 1, maxDistance: 0 });
  });

  it('does not limit how much a station may send', () => {
    store = new CoverageStore();
    store.stationMap.set(20, station(20, 51.95, 4.05));

    for (let i = 0; i < 10_000; i++) store.ingest(event(20, null, null));

    expect(store.eventsRejected).toBe(0);
    expect(store.eventsProcessed).toBe(10_000);
  });

  it('reports out-of-range positions by radio family and how far out they were', () => {
    store = new CoverageStore();
    store.stationMap.set(22, { ...station(22, 51.95, 4.05), sourceType: 'ais' });
    const marine = { transportType: 'marine' as const, sourceType: 'ais', frequency: null, signalLevel: null };

    store.ingest({ ...event(22, 51.95, 5.5), ...marine });  // about 100 km: accepted
    store.ingest({ ...event(22, 51.95, 7.55), ...marine }); // about 240 km: accepted
    store.ingest({ ...event(22, 51.95, 8.9), ...marine });  // about 330 km: just outside
    store.ingest({ ...event(22, 40.0, -70.0), ...marine }); // across the Atlantic

    expect(store.eventsWithPosition).toBe(2);
    expect(store.positionsDiscarded).toEqual({ out_of_range: 2 });
    expect(store.outOfRange).toEqual({ ais: { near: 1, far: 1 } });
    // and names the station they came from
    const [worst] = store.getOutOfRangeStations();
    expect(worst).toMatchObject({ stationId: 22, ident: 'TEST-22', sourceType: 'ais', near: 1, far: 1 });
    expect(worst.maxDistanceKm).toBeGreaterThan(5000);
  });
});

describe('stations without an owner-entered location', () => {
  let store: CoverageStore;
  afterEach(() => store?.destroy());

  const marine = { transportType: 'marine' as const, sourceType: 'ais', frequency: null, signalLevel: null };
  // Registered in Milan (a GeoIP guess); the vessels are in the Strait of Messina
  const milan = (id: number, ownerLocated: boolean): StationMeta => ({
    ...station(id, 45.46, 9.19), sourceType: 'ais',
    registeredLatitude: 45.46, registeredLongitude: 9.19, ownerLocated, locationSource: 'registered',
  });
  const hear = (id: number, n: number, lat: number, lon: number, jitter: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i * 137.5) * Math.PI / 180;
      const r = jitter * ((i % 10) + 1) / 10;
      store.ingest({ ...event(id, lat + r * Math.cos(a), lon + r * Math.sin(a)), ...marine });
    }
  };

  it('places a GeoIP-located station at the centre of what it hears', () => {
    store = new CoverageStore();
    store.stationMap.set(40, milan(40, false));

    hear(40, 60, 38.2, 15.6, 0.3);

    const meta = store.stationMap.get(40)!;
    expect(meta.locationSource).toBe('heard');
    expect(meta.latitude).toBeCloseTo(38.2, 0);
    expect(meta.longitude).toBeCloseTo(15.6, 0);
    expect(store.getStationsPlacedByHeard()).toBe(1);

    // Positions heard after the move count, with a plausible range
    const before = store.eventsWithPosition;
    hear(40, 10, 38.2, 15.6, 0.3);
    expect(store.eventsWithPosition).toBe(before + 10);
    const coverage = store.getStationCoverage(40, '1h');
    expect(coverage!.maxDistance).toBeGreaterThan(0);
    expect(coverage!.maxDistance).toBeLessThan(100);
    // The earlier discards were measured from the wrong place
    expect(store.getOutOfRangeStations().find(s => s.stationId === 40)).toBeUndefined();
  });

  it('never moves a station whose owner entered the location', () => {
    store = new CoverageStore();
    store.stationMap.set(41, milan(41, true));

    hear(41, 60, 38.2, 15.6, 0.3);

    const meta = store.stationMap.get(41)!;
    expect(meta.locationSource).toBe('registered');
    expect(meta.latitude).toBe(45.46);
    expect(store.eventsWithPosition).toBe(0);
    expect(store.positionsDiscarded).toEqual({ out_of_range: 60 });
  });

  it('leaves a station alone when the GeoIP guess is about right', () => {
    store = new CoverageStore();
    store.stationMap.set(42, milan(42, false));

    hear(42, 60, 45.2, 9.6, 0.3); // about 45 km from the registered point

    expect(store.stationMap.get(42)!.locationSource).toBe('registered');
    expect(store.eventsWithPosition).toBe(60);
  });

  it('does not place a station that relays a wide area', () => {
    store = new CoverageStore();
    store.stationMap.set(43, milan(43, false));

    hear(43, 60, 38.2, 15.6, 8); // spread over many hundreds of km

    expect(store.stationMap.get(43)!.locationSource).toBe('registered');
  });

  it('applies a saved estimate after a restart without waiting for new samples', () => {
    store = new CoverageStore();
    store.stationMap.set(44, milan(44, false));
    store.loadHeardLocations([{ stationId: 44, latitude: 38.2, longitude: 15.6, spreadKm: 30, samples: 200 }]);

    hear(44, 1, 38.25, 15.65, 0);

    expect(store.stationMap.get(44)!.locationSource).toBe('heard');
    expect(store.eventsWithPosition).toBe(1);
  });
  it('leaves a station alone when the centre is not clearly away from the registered spot', () => {
    store = new CoverageStore();
    // Registered about 270 km from the centre of vessels spread over about 150 km
    store.stationMap.set(45, { ...milan(45, false), latitude: 54.0, longitude: -6.4,
      registeredLatitude: 54.0, registeredLongitude: -6.4 });

    hear(45, 60, 51.6, -7.0, 1.8);

    expect(store.stationMap.get(45)!.locationSource).toBe('registered');
  });

  describe('aircraft stations', () => {
    // Registered in Milan (a GeoIP guess); the aircraft are over Sicily
    const vdl = (id: number): StationMeta => ({
      ...station(id, 45.46, 9.19),
      registeredLatitude: 45.46, registeredLongitude: 9.19, ownerLocated: false, locationSource: 'registered',
    });
    afterEach(() => vi.useRealTimers());
    // Positions arriving stepMs apart (spacing goes by arrival time)
    const hearAircraft = (id: number, n: number, stepMs: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now();
      for (let i = 0; i < n; i++) {
        vi.setSystemTime(start + i * stepMs);
        const a = (i * 137.5) * Math.PI / 180;
        const r = 1.2 * ((i % 10) + 1) / 10;
        store.ingest(event(id, 38.2 + r * Math.cos(a), 15.6 + r * Math.sin(a)));
      }
    };

    it('are not placed by a few flights', () => {
      store = new CoverageStore();
      store.stationMap.set(50, vdl(50));

      hearAircraft(50, 300, 10_000);

      expect(store.stationMap.get(50)!.locationSource).toBe('registered');
    });

    it('are not placed by a burst of positions in a short time', () => {
      store = new CoverageStore();
      store.stationMap.set(51, vdl(51));

      hearAircraft(51, 3000, 100); // five minutes of traffic

      expect(store.stationMap.get(51)!.locationSource).toBe('registered');
    });

    it('do not count positions by their own timestamps', () => {
      store = new CoverageStore();
      store.stationMap.set(54, vdl(54));

      // All arrive at once, each claiming to be 10 seconds before the last
      const now = Date.now();
      for (let i = 0; i < 1500; i++) {
        const a = (i * 137.5) * Math.PI / 180;
        store.ingest({ ...event(54, 38.2 + 0.5 * Math.cos(a), 15.6 + 0.5 * Math.sin(a)),
          timestamp: new Date(now - i * 10_000) });
      }

      expect(store.stationMap.get(54)!.locationSource).toBe('registered');
    });

    it('are placed after 1,000 positions spread over hours', () => {
      store = new CoverageStore();
      store.stationMap.set(52, vdl(52));

      hearAircraft(52, 1000, 10_000);

      const meta = store.stationMap.get(52)!;
      expect(meta.locationSource).toBe('heard');
      expect(meta.latitude).toBeCloseTo(38.2, 0);
      expect(meta.longitude).toBeCloseTo(15.6, 0);
    });

    it('ignore an estimate saved from too few positions', () => {
      store = new CoverageStore();
      store.stationMap.set(53, vdl(53));
      store.loadHeardLocations([{ stationId: 53, latitude: 38.2, longitude: 15.6, spreadKm: 90, samples: 200 }]);

      hearAircraft(53, 1, 10_000);

      expect(store.stationMap.get(53)!.locationSource).toBe('registered');
    });
  });
});

describe('restoring station coverage from a snapshot', () => {
  let store: CoverageStore;
  afterEach(() => store?.destroy());

  const saved = (stationId: number, total: number) => {
    const sectorMessageCounts = new Array(36).fill(0);
    const bearingSectors = new Array(36).fill(0);
    const sectorAvgLevels = new Array(36).fill(0);
    sectorMessageCounts[3] = Math.floor(total * 0.5);
    bearingSectors[3] = 212;
    sectorAvgLevels[3] = -30;
    sectorMessageCounts[20] = Math.floor(total * 0.25);
    bearingSectors[20] = 87;
    sectorAvgLevels[20] = -20;
    return {
      stationId, bearingSectors, sectorMessageCounts, sectorAvgLevels,
      totalMessages: total, messagesWithPosition: Math.floor(total * 0.8),
      maxDistance: 212, avgLevel: -25, errorRate: 0.1,
    };
  };

  it('brings back totals, sectors, levels and the error rate', () => {
    store = new CoverageStore();
    store.stationMap.set(60, station(60, 50, 8));

    store.loadStationSnapshot('24h', [saved(60, 1000)]);

    const coverage = store.getStationCoverage(60, '24h')!;
    expect(coverage.totalMessages).toBe(1000);
    expect(coverage.messagesWithPosition).toBe(800);
    expect(coverage.sectorMessageCounts[3]).toBe(500);
    expect(coverage.sectorMessageCounts[20]).toBe(250);
    expect(coverage.bearingSectors[3]).toBe(212);
    expect(coverage.maxDistance).toBe(212);
    expect(coverage.sectorAvgLevels[3]).toBeCloseTo(-30);
    expect(coverage.avgLevel).toBeCloseTo(-25);
    expect(coverage.errorRate).toBeCloseTo(0.1);
  });

  it('files a marine station under marine', () => {
    store = new CoverageStore();
    store.stationMap.set(61, { ...station(61, 50, 8), sourceType: 'ais' });

    store.loadStationSnapshot('24h', [saved(61, 100)]);

    expect(store.getStationCoverage(61, '24h', 'marine')!.totalMessages).toBe(100);
    expect(store.getStationCoverage(61, '24h', 'aircraft')).toBeNull();
  });

  it('does not take longer for busier stations', () => {
    store = new CoverageStore();
    const stations = [];
    for (let id = 100; id < 900; id++) stations.push(saved(id, 5_000_000));

    const started = performance.now();
    store.loadStationSnapshot('1mo', stations);

    // Four billion messages; one call per message would take minutes
    expect(performance.now() - started).toBeLessThan(500);
    expect(store.getStationCoverage(100, '1mo')!.totalMessages).toBe(5_000_000);
  });
});
